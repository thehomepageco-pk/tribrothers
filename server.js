require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const Client = require('./models/Client');
const Product = require('./models/Product');
const Supplier = require('./models/Supplier');
const SupplierProduct = require('./models/SupplierProduct');
const ProductClient = require('./models/ProductClient');
const Quotation = require('./models/Quotation');
const Offer = require('./models/Offer');
const SalesContract = require('./models/SalesContract');
const Indent = require('./models/Indent');
const Shipment = require('./models/Shipment');
const Invoice = require('./models/Invoice');
const Payment = require('./models/Payment');
const Commission = require('./models/Commission');
const CommissionPayment = require('./models/CommissionPayment');
const User = require('./models/User');
const Notification = require('./models/Notification');
const SessionLog = require('./models/SessionLog');
const SavedCategory = require('./models/SavedCategory');
const Settings = require('./models/Settings');
const EmailTemplate = require('./models/EmailTemplate');
const { getTransporter, resetTransporterCache, friendlyMailError } = require('./lib/mail');
const {
  DEFAULT_TEMPLATES,
  FIELD_DEFS,
  detectRequiredFields,
  renderEmail,
} = require('./lib/email-compose');
const { parsePagination, paginatedResponse } = require('./lib/pagination');
const {
  parseReportRange,
  dateMatchFilter,
  dateFieldMatchFilter,
  timelineBucketKey,
  pickTimelineGranularity,
  buildTimelineBuckets,
  formatDateLabel,
} = require('./lib/report-range');
const {
  indentCommissionTotal,
  indentQtyInMt,
  contractTotalValue,
  invoiceSubtotal,
  amountInUsd,
} = require('./lib/report-metrics');
const {
  enrichCommission,
  syncIndentCommission,
  syncSupplierCommission,
  syncAllCommissions,
  removeIndentCommission,
  removeSupplierCommission,
  deriveIndentCommissionFields,
} = require('./lib/commission-sync');
const { computeIndentCommissionDetails } = require('./lib/commission-calc');
const CURRENCIES = require('./lib/currencies');
const { requireAuth, requireAdmin, requirePermission, getAdminOverrideStatus, DEFAULT_OVERRIDE_MS } = require('./middleware/auth');
const tasksNotificationsRouter = require('./routes/tasks-notifications');

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop.
// Needed when running behind a reverse proxy/tunnel (e.g. ngrok), so req.ip and
// express-rate-limit can use X-Forwarded-* safely.
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // SPA needs inline styles/scripts for now
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Gzip/Brotli-capable response compression for faster API + static payloads
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Session configuration
app.use(session({
  name: 'trib.sid',
  // Prefer environment secret in production
  secret: process.env.SESSION_SECRET || (isProd ? (() => { throw new Error('SESSION_SECRET required in production'); })() : 'dev-only-change-me'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,           // only send cookies over HTTPS in production
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000, // 12 hours
  },
}));

// Middleware — allow Vite dev origin + production origin
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:3001,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Uploaded files served via authenticated route (see /uploads/:filename below)

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// ✅ MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/software';
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    return ensureSearchIndexes();
  })
  .then(() => ensureEmailTemplates())
  .then(() => cleanupDuplicateCategories())
  .then(() => console.log('✅ Email templates ready'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    console.error(`❌ Tried MONGO_URI=${MONGO_URI}`);
  });

/** Indexes that speed up list/search without changing query semantics */
async function ensureSearchIndexes() {
  try {
    await Promise.all([
      Product.collection.createIndex({ name: 1 }),
      Product.collection.createIndex({ hsCode: 1 }),
      Product.collection.createIndex({ categories: 1 }),
      Product.collection.createIndex({ showAsNew: 1, updatedAt: -1 }),
      Supplier.collection.createIndex({ companyName: 1 }),
      Supplier.collection.createIndex({ country: 1 }),
      Client.collection.createIndex({ companyName: 1 }),
      Client.collection.createIndex({ country: 1 }),
      Quotation.collection.createIndex({ createdAt: -1 }),
      Offer.collection.createIndex({ createdAt: -1 }),
      SessionLog.collection.createIndex({ createdAt: -1 }),
      User.collection.createIndex({ username: 1 }, { unique: true }),
    ]);
    console.log('✅ Search indexes ready');
  } catch (err) {
    console.warn('⚠️ Index ensure skipped/partial:', err.message);
  }
}

async function ensureEmailTemplates() {
  for (const tpl of DEFAULT_TEMPLATES) {
    const existing = await EmailTemplate.findOne({ slug: tpl.slug });
    if (!existing) {
      await EmailTemplate.create(tpl);
      continue;
    }
    // Keep body/subject stable for admin-edited templates; refresh name/description/sort for known defaults
    if (tpl.slug === 'custom-email' || tpl.slug === 'general-message') {
      existing.name = tpl.name;
      existing.description = tpl.description;
      existing.subject = tpl.subject;
      existing.bodyHtml = tpl.bodyHtml;
      existing.recipientTypes = tpl.recipientTypes;
      existing.sortOrder = tpl.sortOrder;
      existing.isActive = true;
      await existing.save();
    }
  }
}

async function sendMail(mailOptions) {
  const settings = await Settings.getGlobal();
  const { transporter, from } = getTransporter(settings);
  if (!transporter) {
    throw new Error('Email not configured. Set mail credentials in Settings or environment variables.');
  }
  try {
    return await transporter.sendMail({
      from: from || settings.mailFrom || settings.companyEmail || process.env.MAIL_FROM,
      ...mailOptions,
    });
  } catch (err) {
    const wrapped = new Error(friendlyMailError(err));
    wrapped.cause = err;
    throw wrapped;
  }
}

// --- Derived helpers & audit logging ---

function currentUserFromReq(req) {
  if (!req.session || !req.session.userId) return {};
  return {
    userId: req.session.userId,
    username: req.session.username,
    role: req.session.role || 'staff',
  };
}

async function logSessionEvent(req, action, entityType, entityId, details) {
  try {
    const user = currentUserFromReq(req);
    await SessionLog.create({
      ...user,
      action,
      entityType,
      entityId,
      details: details || undefined,
      ip: req.ip,
    });
  } catch (err) {
    // Do not break main flow if logging fails
    console.error('❌ Failed to write session log:', err.message || err);
  }
}

// --- Derived: clients linked to a product (from ProductClient) ---
async function getLinkedClientIdsForProduct(productId) {
  const docs = await ProductClient.find({ productId }).distinct('clientId');
  return docs;
}

// --- Derived: suppliers linked to a product (from SupplierProduct) ---
async function getLinkedSupplierIdsForProduct(productId) {
  const docs = await SupplierProduct.find({ productId }).distinct('supplierId');
  return docs;
}

function normalizeContactPersons(raw) {
  // Accept:
  // - already-parsed array of objects: [{name,email,...}]
  // - array of strings: ["Ali", "Sara"]
  // - stringified JSON for either of the above
  if (raw == null) return [];
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value || '[]');
    } catch {
      // Non-JSON string: treat as a single name
      value = [value];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name } : null;
      }
      if (typeof item === 'object') {
        const name = item.name != null ? String(item.name).trim() : '';
        const email = item.email != null ? String(item.email).trim() : '';
        const department = item.department != null ? String(item.department).trim() : '';
        const tel = item.tel != null ? String(item.tel).trim() : '';
        const mobile = item.mobile != null ? String(item.mobile).trim() : '';
        const wechat = item.wechat != null ? String(item.wechat).trim() : '';
        const facebook = item.facebook != null ? String(item.facebook).trim() : '';
        const whatsapp = item.whatsapp != null ? String(item.whatsapp).trim() : '';
        const otherSocial = item.otherSocial != null ? String(item.otherSocial).trim() : '';
        if (!name && !email) return null;
        return { name, email, department, tel, mobile, wechat, facebook, whatsapp, otherSocial };
      }
      return null;
    })
    .filter(Boolean);
}

function firstEmailFromContactsOrCompanyEmail(contactPersons, companyEmail) {
  const contacts = Array.isArray(contactPersons) ? contactPersons : [];
  const fromContacts = contacts.map((c) => (c && c.email ? String(c.email).trim() : '')).find(Boolean);
  return fromContacts || (companyEmail ? String(companyEmail).trim() : '');
}

const canEdit = requirePermission('canEdit');
const canDelete = requirePermission('canDelete');
const canEmail = requirePermission('canEmail');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
});

function sanitizeUserForResponse(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  return { ...obj, permissions: User.resolvePermissions(obj) };
}

function validatePassword(pw) {
  const password = String(pw || '');
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (password.length < 8 || !hasLetter || !hasDigit) {
    return 'Password must be at least 8 characters and include both letters and numbers.';
  }
  return null;
}

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sanitizeSettingsForResponse(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  if (obj.mailPass) obj.mailPass = obj.mailPass ? '********' : '';
  return obj;
}

// --- Public routes (no auth) ---
app.get('/health', (req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

app.get('/api/auth/check', async (req, res) => {
  const isAuthenticated = !!(req.session && req.session.isAuthenticated);
  const override = isAuthenticated ? getAdminOverrideStatus(req) : { active: false };
  if (!isAuthenticated) {
    return res.json({ authenticated: false, adminOverride: override, user: null });
  }
  let email = req.session.email || '';
  let avatarUrl = req.session.avatarUrl || '';
  let displayName = req.session.displayName || req.session.username;
  let designation = '';
  let mobile = '';
  let whatsapp = '';
  let wechat = '';
  let tempAccess = null;
  let permissions = req.session.permissions || {};
  try {
    if (req.session.userId) {
      const fresh = await User.findById(req.session.userId).select(
        'displayName email avatarUrl role permissions username designation mobile whatsapp wechat tempAccess',
      );
      if (fresh) {
        email = fresh.email || '';
        avatarUrl = fresh.avatarUrl || '';
        displayName = fresh.displayName || fresh.username || displayName;
        designation = fresh.designation || '';
        mobile = fresh.mobile || '';
        whatsapp = fresh.whatsapp || '';
        wechat = fresh.wechat || '';
        permissions = User.resolvePermissions(fresh);
        req.session.email = email;
        req.session.avatarUrl = avatarUrl;
        req.session.displayName = displayName;
        req.session.permissions = permissions;
        if (fresh.tempAccess && fresh.tempAccess.until) {
          const until = new Date(fresh.tempAccess.until).getTime();
          if (Number.isFinite(until) && until > Date.now()) {
            const pages = Array.isArray(fresh.tempAccess.pages) && fresh.tempAccess.pages.length
              ? fresh.tempAccess.pages.map(String)
              : fresh.tempAccess.permission
                ? [String(fresh.tempAccess.permission)]
                : [];
            tempAccess = {
              active: true,
              expiresAt: until,
              remainingMs: until - Date.now(),
              canEdit: Boolean(fresh.tempAccess.canEdit),
              canEmail: Boolean(fresh.tempAccess.canEmail),
              canDelete: Boolean(fresh.tempAccess.canDelete),
              permission: fresh.tempAccess.permission || '',
              pageKey: fresh.tempAccess.pageKey || '',
              pages,
            };
            req.session.tempAccessUntil = until;
            req.session.tempCanEdit = Boolean(fresh.tempAccess.canEdit);
            req.session.tempCanEmail = Boolean(fresh.tempAccess.canEmail);
            req.session.tempCanDelete = Boolean(fresh.tempAccess.canDelete);
            req.session.tempPermission = fresh.tempAccess.permission || '';
            req.session.tempPageKey = fresh.tempAccess.pageKey || '';
            req.session.tempPages = pages;
          } else if (fresh.tempAccess.until) {
            fresh.tempAccess = undefined;
            await fresh.save();
            delete req.session.tempAccessUntil;
            delete req.session.tempCanEdit;
            delete req.session.tempCanEmail;
            delete req.session.tempCanDelete;
            delete req.session.tempPermission;
            delete req.session.tempPageKey;
            delete req.session.tempPages;
          }
        }
      }
    }
  } catch (_) { /* keep session values */ }
  res.json({
    authenticated: true,
    adminOverride: override,
    tempAccess,
    user: {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role || 'staff',
      displayName,
      email,
      avatarUrl,
      designation,
      mobile,
      whatsapp,
      wechat,
      permissions,
    },
  });
});

/** Staff: temporary unlock of edit/delete/email via admin credentials (expires). */
app.post('/api/auth/admin-override', async (req, res) => {
  try {
    if (!req.session || !req.session.isAuthenticated) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.session.role === 'admin') {
      return res.json({
        success: true,
        message: 'You are already an admin',
        adminOverride: { active: true, expiresAt: null, remainingMs: null, unlockedBy: req.session.username },
      });
    }

    const { username, password, durationMinutes, pageKey, permission, actions } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Admin username and password are required' });
    }
    const scopePermission = String(permission || pageKey || '').trim();
    if (!scopePermission) {
      return res.status(400).json({ error: 'Select which page to unlock' });
    }
    const actionFlags = {
      canEdit: Boolean(actions?.canEdit),
      canDelete: Boolean(actions?.canDelete),
      canEmail: Boolean(actions?.canEmail) || scopePermission === 'mail',
    };
    if (!actionFlags.canEdit && !actionFlags.canDelete && !actionFlags.canEmail && scopePermission !== 'adminPanel') {
      // Viewing a locked page is still a valid scope
      actionFlags.view = true;
    }

    const adminUser = await User.findOne({ username: String(username).trim() });
    const notifyUnlock = async (ok, detail) => {
      try {
        const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id');
        if (!admins.length) return;
        await Notification.insertMany(
          admins.map((a) => ({
            userId: a._id,
            title: ok ? 'Admin unlock used' : 'Failed unlock attempt',
            message: detail,
            type: 'security',
            href: '/sessions',
            read: false,
          })),
        );
      } catch (_) { /* ignore */ }
    };
    if (!adminUser || adminUser.role !== 'admin') {
      await notifyUnlock(false, `${req.session.username} tried unlock with invalid admin credentials`);
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    if (adminUser.isActive === false) {
      await notifyUnlock(false, `${req.session.username} tried unlock with a deactivated admin account`);
      return res.status(403).json({ error: 'That admin account is deactivated' });
    }

    const passwordOk = await bcrypt.compare(String(password), adminUser.password);
    if (!passwordOk) {
      await notifyUnlock(false, `${req.session.username} tried unlock with wrong password for ${adminUser.username}`);
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Same person unlocking themselves as admin is fine; block non-admins unlocking with staff creds (already checked role)

    let mins = Number(durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) mins = 5;
    mins = Math.min(30, Math.max(1, mins)); // 1–30 minutes
    const ms = mins * 60 * 1000 || DEFAULT_OVERRIDE_MS;
    const expiresAt = Date.now() + ms;

    const pageKeys = [String(pageKey || scopePermission).trim()].filter(Boolean);
    const permKeys = [scopePermission];
    if (scopePermission === 'mail') permKeys.push('mail');

    req.session.adminOverrideUntil = expiresAt;
    req.session.adminOverrideBy = adminUser.username;
    req.session.adminOverrideGrantedAt = Date.now();
    req.session.adminOverridePageKey = pageKeys[0] || '';
    req.session.adminOverridePermission = scopePermission;
    req.session.adminOverridePages = [...new Set(permKeys)];
    req.session.adminOverrideCanEdit = actionFlags.canEdit;
    req.session.adminOverrideCanDelete = actionFlags.canDelete;
    req.session.adminOverrideCanEmail = actionFlags.canEmail;

    const scopeLabel = [
      pageKeys[0] || scopePermission,
      actionFlags.canEdit ? 'edit' : null,
      actionFlags.canDelete ? 'delete' : null,
      actionFlags.canEmail ? 'email' : null,
    ]
      .filter(Boolean)
      .join(' / ');

    await logSessionEvent(req, 'ADMIN_OVERRIDE_UNLOCK', 'User', req.session.userId, {
      unlockedBy: adminUser.username,
      expiresAt: new Date(expiresAt).toISOString(),
      durationMinutes: mins,
      forUser: req.session.username,
      pageKey: pageKeys[0] || '',
      permission: scopePermission,
      actions: actionFlags,
    });

    try {
      const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id');
      if (admins.length) {
        await Notification.insertMany(
          admins.map((a) => ({
            userId: a._id,
            title: 'Admin unlock used',
            message: `${adminUser.username} unlocked ${req.session.username} for ${mins} min (${scopeLabel})`,
            type: 'security',
            href: '/sessions',
            read: false,
          })),
        );
      }
    } catch (_) { /* ignore */ }

    res.json({
      success: true,
      message: `Unlocked for ${mins} minute${mins === 1 ? '' : 's'}`,
      adminOverride: getAdminOverrideStatus(req),
    });
  } catch (err) {
    console.error('❌ Admin override error:', err);
    res.status(500).json({ error: 'Unlock failed' });
  }
});

app.post('/api/auth/admin-override/clear', async (req, res) => {
  try {
    if (!req.session || !req.session.isAuthenticated) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const wasOverride = !!req.session.adminOverrideUntil;
    const wasTemp = !!req.session.tempAccessUntil;
    delete req.session.adminOverrideUntil;
    delete req.session.adminOverrideBy;
    delete req.session.adminOverrideGrantedAt;
    delete req.session.adminOverridePageKey;
    delete req.session.adminOverridePermission;
    delete req.session.adminOverridePages;
    delete req.session.adminOverrideCanEdit;
    delete req.session.adminOverrideCanDelete;
    delete req.session.adminOverrideCanEmail;
    delete req.session.tempAccessUntil;
    delete req.session.tempCanEdit;
    delete req.session.tempCanEmail;
    delete req.session.tempCanDelete;
    delete req.session.tempPermission;
    delete req.session.tempPageKey;
    delete req.session.tempPages;

    // Also clear DB-backed approved temp access so "Work done" / End access re-locks pages.
    if (req.session.userId) {
      await User.findByIdAndUpdate(req.session.userId, { $unset: { tempAccess: 1 } });
      try {
        const AccessRequest = require('./models/AccessRequest');
        await AccessRequest.updateMany(
          { requester: req.session.userId, status: 'approved' },
          { $set: { status: 'expired' } },
        );
      } catch (_) {
        /* optional */
      }
    }

    if (wasOverride || wasTemp) {
      await logSessionEvent(req, 'ADMIN_OVERRIDE_LOCK', 'User', req.session.userId, {
        forUser: req.session.username,
        clearedTempAccess: wasTemp,
      });
    }
    res.json({
      success: true,
      adminOverride: { active: false, expiresAt: null, remainingMs: 0 },
      tempAccess: { active: false, expiresAt: null, remainingMs: 0 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    let user = await User.findOne({ username: username.trim() });
    const userCount = await User.countDocuments();
    if (!user && userCount === 0) {
      const pw = String(password);
      const hasLetter = /[A-Za-z]/.test(pw);
      const hasDigit = /\d/.test(pw);
      if (pw.length < 12 || !hasLetter || !hasDigit) {
        return res.status(400).json({
          success: false,
          error: 'Initial admin password must be at least 12 characters and include both letters and numbers.',
        });
      }
      const hash = await bcrypt.hash(pw, 10);
      user = await User.create({ username: username.trim(), password: hash, role: 'admin' });
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, error: 'Account is deactivated. Contact your administrator.' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const permissions = User.resolvePermissions(user);
    const sessionUser = {
      userId: user._id.toString(),
      username: user.username,
      displayName: user.displayName || user.username,
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      role: user.role || 'staff',
      permissions,
    };

    // Rotate session id on login to prevent fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.isAuthenticated = true;
    req.session.userId = sessionUser.userId;
    req.session.username = sessionUser.username;
    req.session.displayName = sessionUser.displayName;
    req.session.email = sessionUser.email;
    req.session.avatarUrl = sessionUser.avatarUrl;
    req.session.role = sessionUser.role;
    req.session.permissions = sessionUser.permissions;

    await logSessionEvent(req, 'LOGIN', null, null);
    res.json({ success: true, message: 'Login successful', redirect: '/' });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/logout', (req, res) => {
  const userSnapshot = currentUserFromReq(req);
  req.session.destroy(async (err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    try {
      await SessionLog.create({ ...userSnapshot, action: 'LOGOUT', ip: '' });
    } catch (_) { /* ignore */ }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Protect all other /api routes
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/check') return next();
  requireAuth(req, res, next);
});

/** Current user profile (admins can edit; others read-only). */
app.get('/api/me', async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUserForResponse(user));
  } catch (err) {
    console.error('❌ GET /api/me:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.put('/api/me', async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { displayName, email, designation, mobile, whatsapp, wechat } = req.body || {};
    // Everyone can update personal profile fields
    if (displayName !== undefined) user.displayName = String(displayName || '').trim();
    if (email !== undefined) user.email = String(email || '').trim();
    // Exhibition contact card fields: Admin & Owner only
    const role = user.role || req.session.role;
    if (role === 'admin' || role === 'owner' || role === 'user') {
      if (designation !== undefined) user.designation = String(designation || '').trim();
      if (mobile !== undefined) user.mobile = String(mobile || '').trim();
      if (whatsapp !== undefined) user.whatsapp = String(whatsapp || '').trim();
      if (wechat !== undefined) user.wechat = String(wechat || '').trim();
    }
    await user.save();
    req.session.displayName = user.displayName || user.username;
    req.session.email = user.email || '';
    res.json(sanitizeUserForResponse(user));
  } catch (err) {
    console.error('❌ PUT /api/me:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.put('/api/me/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(String(currentPassword), user.password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    user.password = await bcrypt.hash(String(newPassword), 10);
    await user.save();
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('❌ PUT /api/me/password:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Tasks + notifications (dashboard assign-work)
app.use('/api', tasksNotificationsRouter);
app.use('/api', require('./routes/access-requests'));
app.use('/api', require('./routes/import'));

// Authenticated file downloads
app.get('/uploads/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);
  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

// Email product details to client(s) — optional clientIds in body to email only selected clients
app.post('/api/products/:id/email-client', canEmail, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // New mode: explicit recipients (choose contact person email(s) in UI)
    // Body: { recipients: [{ clientId, toEmail }] }
    if (req.body && Array.isArray(req.body.recipients) && req.body.recipients.length > 0) {
      const recipients = req.body.recipients
        .map(r => ({
          clientId: r && r.clientId ? String(r.clientId) : '',
          toEmail: r && r.toEmail ? String(r.toEmail).trim() : '',
        }))
        .filter(r => r.clientId && r.toEmail);
      if (!recipients.length) {
        return res.status(400).json({ error: "No valid recipients provided" });
      }
      const clients = await Client.find({ _id: { $in: [...new Set(recipients.map(r => r.clientId))] } });
      const byId = new Map(clients.map(c => [String(c._id), c]));

      let sentCount = 0;
      let skippedCount = 0;
      const emailPromises = recipients.map(r => {
        const client = byId.get(r.clientId);
        const companyName = client?.companyName || 'Client';
        return sendMail({
          from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
          to: r.toEmail,
          subject: `Product Details: ${product.name}`,
          html: `
            <h2>📦 Product Details</h2>
            <p><strong>Product Name:</strong> ${product.name}</p>
            <p><strong>Category:</strong> ${productCategoryLabel(product)}</p>
            <p><strong>Specs:</strong> ${product.specs || "N/A"}</p>
            <p><strong>Packing:</strong> ${product.packing || "N/A"}</p>
            <p><strong>HS Code:</strong> ${product.hsCode || "N/A"}</p>
            ${product.importDuty ? `<p><strong>Import Duty:</strong> ${product.importDuty}%</p>` : ''}
            ${product.incomeTax ? `<p><strong>Income Tax:</strong> ${product.incomeTax}%</p>` : ''}
            ${product.salesTax ? `<p><strong>Sales Tax:</strong> ${product.salesTax}%</p>` : ''}
            <hr/>
            <p>Best Regards,<br>TRI Brothers Dashboard</p>
          `
        }).then(() => { sentCount++; })
          .catch((err) => { console.error(`Failed to send email to ${r.toEmail} (${companyName})`, err); skippedCount++; });
      });

      await Promise.all(emailPromises);
      if (sentCount === 0) return res.status(400).json({ error: "No emails were sent" });
      return res.json({
        message: `✅ Email(s) sent to ${sentCount} client contact(s)${skippedCount > 0 ? `. ${skippedCount} failed.` : ''}`,
      });
    }

    let clientIds = await getLinkedClientIdsForProduct(req.params.id);
    if (req.body && Array.isArray(req.body.clientIds) && req.body.clientIds.length > 0) {
      clientIds = clientIds.filter(id => req.body.clientIds.some(cid => String(cid) === String(id)));
    }
    if (!clientIds.length) {
      return res.status(400).json({ error: "No clients linked to this product (or none selected). Add client links from the product View (Links)." });
    }
    const clients = await Client.find({ _id: { $in: clientIds } });

    const emailPromises = [];
    let sentCount = 0;
    let skippedCount = 0;

    for (const client of clients) {
      const toEmail = firstEmailFromContactsOrCompanyEmail(client.contactPersons, client.email);
      if (toEmail) {
        emailPromises.push(
          sendMail({
            from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
            to: toEmail,
            subject: `Product Details: ${product.name}`,
            html: `
              <h2>📦 Product Details</h2>
              <p><strong>Product Name:</strong> ${product.name}</p>
              <p><strong>Category:</strong> ${productCategoryLabel(product)}</p>
              <p><strong>Specs:</strong> ${product.specs || "N/A"}</p>
              <p><strong>Packing:</strong> ${product.packing || "N/A"}</p>
              <p><strong>HS Code:</strong> ${product.hsCode || "N/A"}</p>
              ${product.importDuty ? `<p><strong>Import Duty:</strong> ${product.importDuty}%</p>` : ''}
              ${product.incomeTax ? `<p><strong>Income Tax:</strong> ${product.incomeTax}%</p>` : ''}
              ${product.salesTax ? `<p><strong>Sales Tax:</strong> ${product.salesTax}%</p>` : ''}
              <hr/>
              <p>Best Regards,<br>TRI Brothers Dashboard</p>
            `
          }).then(() => {
            sentCount++;
          }).catch((err) => {
            console.error(`Failed to send email to ${client.email}:`, err);
            skippedCount++;
          })
        );
      } else {
        skippedCount++;
        console.warn(`Client ${client.companyName} (${client._id}) does not have an email address`);
      }
    }

    await Promise.all(emailPromises);

    if (sentCount === 0) {
      return res.status(400).json({ error: "No valid email addresses found for clients associated with this product" });
    }

    res.json({ 
      message: `✅ Email(s) sent to ${sentCount} client(s)${skippedCount > 0 ? `. ${skippedCount} client(s) skipped (no email address)` : ''}` 
    });
  } catch (err) {
    console.error("❌ Error sending email to clients:", err);
    res.status(500).json({ error: err.message });
  }
});

// Email product details to supplier(s) — optional supplierIds in body to email only selected suppliers
app.post('/api/products/:id/email-supplier', canEmail, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // New mode: explicit recipients (choose contact person email(s) in UI)
    // Body: { recipients: [{ supplierId, toEmail }] }
    if (req.body && Array.isArray(req.body.recipients) && req.body.recipients.length > 0) {
      const recipients = req.body.recipients
        .map(r => ({
          supplierId: r && r.supplierId ? String(r.supplierId) : '',
          toEmail: r && r.toEmail ? String(r.toEmail).trim() : '',
        }))
        .filter(r => r.supplierId && r.toEmail);
      if (!recipients.length) {
        return res.status(400).json({ error: "No valid recipients provided" });
      }
      const suppliers = await Supplier.find({ _id: { $in: [...new Set(recipients.map(r => r.supplierId))] } });
      const byId = new Map(suppliers.map(s => [String(s._id), s]));

      let sentCount = 0;
      let skippedCount = 0;
      const emailPromises = recipients.map(r => {
        const supplier = byId.get(r.supplierId);
        const companyName = supplier?.companyName || 'Supplier';
        return sendMail({
          from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
          to: r.toEmail,
          subject: `Product Details: ${product.name}`,
          html: `
            <h2>📦 Product Details</h2>
            <p><strong>Product Name:</strong> ${product.name}</p>
            <p><strong>Category:</strong> ${productCategoryLabel(product)}</p>
            <p><strong>Specs:</strong> ${product.specs || "N/A"}</p>
            <p><strong>Packing:</strong> ${product.packing || "N/A"}</p>
            <p><strong>HS Code:</strong> ${product.hsCode || "N/A"}</p>
            ${product.importDuty ? `<p><strong>Import Duty:</strong> ${product.importDuty}%</p>` : ''}
            ${product.incomeTax ? `<p><strong>Income Tax:</strong> ${product.incomeTax}%</p>` : ''}
            ${product.salesTax ? `<p><strong>Sales Tax:</strong> ${product.salesTax}%</p>` : ''}
            <hr/>
            <p>Best Regards,<br>TRI Brothers Dashboard</p>
          `
        }).then(() => { sentCount++; })
          .catch((err) => { console.error(`Failed to send email to ${r.toEmail} (${companyName})`, err); skippedCount++; });
      });

      await Promise.all(emailPromises);
      if (sentCount === 0) return res.status(400).json({ error: "No emails were sent" });
      return res.json({
        message: `✅ Email(s) sent to ${sentCount} supplier contact(s)${skippedCount > 0 ? `. ${skippedCount} failed.` : ''}`,
      });
    }

    let supplierIds = await getLinkedSupplierIdsForProduct(req.params.id);
    if (req.body && Array.isArray(req.body.supplierIds) && req.body.supplierIds.length > 0) {
      supplierIds = supplierIds.filter(id => req.body.supplierIds.some(sid => String(sid) === String(id)));
    }
    if (!supplierIds.length) {
      return res.status(400).json({ error: "No suppliers associated with this product (or none selected). Add Supplier–Product links first." });
    }
    const suppliers = await Supplier.find({ _id: { $in: supplierIds } });

    const emailPromises = [];
    let sentCount = 0;
    let skippedCount = 0;

    for (const supplier of suppliers) {
      // Suppliers have contactPersons array with email in each person
      if (supplier.contactPersons && supplier.contactPersons.length > 0) {
        for (const person of supplier.contactPersons) {
          if (person.email && person.email.trim()) {
            emailPromises.push(
              sendMail({
                from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
                to: person.email,
                subject: `Product Details: ${product.name}`,
                html: `
                  <h2>📦 Product Details</h2>
                  <p><strong>Product Name:</strong> ${product.name}</p>
                  <p><strong>Category:</strong> ${productCategoryLabel(product)}</p>
                  <p><strong>Specs:</strong> ${product.specs || "N/A"}</p>
                  <p><strong>Packing:</strong> ${product.packing || "N/A"}</p>
                  <p><strong>HS Code:</strong> ${product.hsCode || "N/A"}</p>
                  ${product.importDuty ? `<p><strong>Import Duty:</strong> ${product.importDuty}%</p>` : ''}
                  ${product.incomeTax ? `<p><strong>Income Tax:</strong> ${product.incomeTax}%</p>` : ''}
                  ${product.salesTax ? `<p><strong>Sales Tax:</strong> ${product.salesTax}%</p>` : ''}
                  <hr/>
                  <p>Best Regards,<br>TRI Brothers Dashboard</p>
                `
              }).then(() => {
                sentCount++;
              }).catch((err) => {
                console.error(`Failed to send email to ${person.email}:`, err);
                skippedCount++;
              })
            );
          } else {
            skippedCount++;
          }
        }
      } else {
        skippedCount++;
        console.warn(`Supplier ${supplier.companyName} (${supplier._id}) does not have any contact persons with email addresses`);
      }
    }

    await Promise.all(emailPromises);

    if (sentCount === 0) {
      return res.status(400).json({ error: "No valid email addresses found for suppliers associated with this product" });
    }

    res.json({ 
      message: `✅ Email(s) sent to ${sentCount} supplier contact(s)${skippedCount > 0 ? `. ${skippedCount} contact(s) skipped (no email address)` : ''}` 
    });
  } catch (err) {
    console.error("❌ Error sending email to suppliers:", err);
    res.status(500).json({ error: err.message });
  }
});

// Email product details to selected suppliers. Body: { supplierIds, productIds? }.
// If productIds provided, only email about those products (for each supplier only products they're linked to).
app.post('/api/email-suppliers', canEmail, async (req, res) => {
  try {
    const { supplierIds, recipients, productIds: requestedProductIds } = req.body;

    // New mode: explicit recipients: [{ supplierId, toEmail }]
    if (Array.isArray(recipients) && recipients.length > 0) {
      const cleaned = recipients
        .map(r => ({
          supplierId: r && r.supplierId ? String(r.supplierId) : '',
          toEmail: r && r.toEmail ? String(r.toEmail).trim() : '',
        }))
        .filter(r => r.supplierId && r.toEmail);
      if (!cleaned.length) return res.status(400).json({ error: 'No valid recipients provided' });
      const ids = [...new Set(cleaned.map(r => r.supplierId))];

      const links = await SupplierProduct.find({ supplierId: { $in: ids } })
        .populate('productId')
        .populate('supplierId');

      const emailPromises = [];
      for (const r of cleaned) {
        let supplierLinks = links.filter(l => String(l.supplierId?._id) === String(r.supplierId));
        if (requestedProductIds && Array.isArray(requestedProductIds) && requestedProductIds.length > 0) {
          supplierLinks = supplierLinks.filter(l => requestedProductIds.some(pid => String(pid) === String(l.productId?._id)));
        }
        const prods = supplierLinks.map(l => l.productId).filter(Boolean);
        for (const product of prods) {
          emailPromises.push(
            sendMail({
              from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
              to: r.toEmail,
              subject: `Product Details: ${product.name}`,
              html: `<h2>📦 Product Details</h2><p><strong>Name:</strong> ${product.name}</p><p><strong>Category:</strong> ${productCategoryLabel(product)}</p><p><strong>Specs:</strong> ${product.specs || 'N/A'}</p><p><strong>Packing:</strong> ${product.packing || 'N/A'}</p><p><strong>HS Code:</strong> ${product.hsCode || 'N/A'}</p><hr/><p>Best Regards,<br>TRI Brothers Dashboard</p>`
            })
          );
        }
      }
      await Promise.all(emailPromises);
      return res.json({ message: '✅ Emails sent to selected supplier contact(s) successfully!' });
    }

    if (!supplierIds || !Array.isArray(supplierIds) || supplierIds.length === 0) {
      return res.status(400).json({ error: 'supplierIds array is required' });
    }
    const links = await SupplierProduct.find({ supplierId: { $in: supplierIds } })
      .populate('productId')
      .populate('supplierId');
    const suppliers = await Supplier.find({ _id: { $in: supplierIds } });

    const emailPromises = [];
    for (const supplier of suppliers) {
      let supplierLinks = links.filter(l => String(l.supplierId?._id) === String(supplier._id));
      if (requestedProductIds && Array.isArray(requestedProductIds) && requestedProductIds.length > 0) {
        supplierLinks = supplierLinks.filter(l => requestedProductIds.some(pid => String(pid) === String(l.productId?._id)));
      }
      const prods = supplierLinks.map(l => l.productId).filter(Boolean);
      for (const person of supplier.contactPersons || []) {
        if (person.email && person.email.trim() && prods.length > 0) {
          for (const product of prods) {
            emailPromises.push(
              sendMail({
                from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
                to: person.email,
                subject: `Product Details: ${product.name}`,
                html: `<h2>📦 Product Details</h2><p><strong>Name:</strong> ${product.name}</p><p><strong>Category:</strong> ${productCategoryLabel(product)}</p><p><strong>Specs:</strong> ${product.specs || 'N/A'}</p><p><strong>Packing:</strong> ${product.packing || 'N/A'}</p><p><strong>HS Code:</strong> ${product.hsCode || 'N/A'}</p><hr/><p>Best Regards,<br>TRI Brothers Dashboard</p>`
              })
            );
          }
        }
      }
    }
    await Promise.all(emailPromises);
    res.json({ message: '✅ Emails sent to selected suppliers successfully!' });
  } catch (err) {
    console.error('❌ Error sending emails:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`)
});

// Restrict uploads by size and type
const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type'), false);
    }
    cb(null, true);
  },
});

const productFormUpload = upload.fields([
  { name: 'packingPic', maxCount: 1 },
  { name: 'otherDocuments', maxCount: 30 },
]);
const salesContractUpload = upload.any();

app.post('/api/me/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({ error: 'Avatar must be an image' });
    }
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ext = path.extname(req.file.originalname) || '.jpg';
    const safeName = `avatar-${user._id}-${Date.now()}${ext}`;
    const oldPath = path.join(uploadsDir, req.file.filename);
    const newPath = path.join(uploadsDir, safeName);
    try {
      fs.renameSync(oldPath, newPath);
    } catch {
      fs.copyFileSync(oldPath, newPath);
      try { fs.unlinkSync(oldPath); } catch (_) { /* ignore */ }
    }
    if (user.avatarUrl) {
      const prev = path.join(uploadsDir, path.basename(user.avatarUrl));
      if (prev.startsWith(uploadsDir) && fs.existsSync(prev)) {
        try { fs.unlinkSync(prev); } catch (_) { /* ignore */ }
      }
    }
    user.avatarUrl = safeName;
    await user.save();
    req.session.avatarUrl = safeName;
    res.json(sanitizeUserForResponse(user));
  } catch (err) {
    console.error('❌ POST /api/me/avatar:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Sanitize for filename: [productName]-[supplierName].ext
function sanitizeFilenamePart(str) {
  if (!str || typeof str !== 'string') return 'file';
  return str.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
}
function renameToProductSupplier(uploadsDir, oldFilename, productName, supplierName, ext) {
  const base = sanitizeFilenamePart(productName) + '-' + sanitizeFilenamePart(supplierName);
  const newName = base + (ext || path.extname(oldFilename));
  const oldPath = path.join(uploadsDir, oldFilename);
  const newPath = path.join(uploadsDir, newName);
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    fs.renameSync(oldPath, newPath);
  }
  return newName;
}
function renameToContactSupplier(uploadsDir, oldFilename, contactName, supplierName, ext) {
  const base = sanitizeFilenamePart(contactName) + '-' + sanitizeFilenamePart(supplierName);
  const newName = base + (ext || path.extname(oldFilename));
  const oldPath = path.join(uploadsDir, oldFilename);
  const newPath = path.join(uploadsDir, newName);
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    fs.renameSync(oldPath, newPath);
  }
  return newName;
}
function renameToClientNTN(uploadsDir, oldFilename, companyName, ext) {
  const base = sanitizeFilenamePart(companyName) + '-NTN';
  const newName = base + (ext || path.extname(oldFilename));
  const oldPath = path.join(uploadsDir, oldFilename);
  const newPath = path.join(uploadsDir, newName);
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    fs.renameSync(oldPath, newPath);
  }
  return newName;
}
function renameToProductOther(uploadsDir, oldFilename, productName, index, ext) {
  const base = sanitizeFilenamePart(productName) + '-other-' + String(index + 1);
  const newName = base + (ext || path.extname(oldFilename));
  const oldPath = path.join(uploadsDir, oldFilename);
  const newPath = path.join(uploadsDir, newName);
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    fs.renameSync(oldPath, newPath);
  }
  return newName;
}

async function persistCategoryNames(categoryList) {
  const names = dedupeCategoryNamesCaseInsensitive(categoryList);
  for (const n of names) {
    const canonical = await ensureSavedCategory(n);
    if (!canonical) continue;
  }
}

function categoryKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickCanonicalCategoryName(variants) {
  const list = [...new Set((variants || []).map((v) => String(v).trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  const score = (n) => {
    const words = n.split(/\s+/);
    const title = words.every((w) => w && w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase());
    if (title) return 3;
    if (n[0] === n[0].toUpperCase()) return 2;
    return 1;
  };
  list.sort((a, b) => score(b) - score(a) || b.length - a.length || a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return list[0];
}

function buildCategoryCanonicalMap(names) {
  const byKey = new Map();
  for (const raw of names || []) {
    const t = String(raw).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = categoryKey(t);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  const canon = new Map();
  for (const [key, variants] of byKey) {
    canon.set(key, pickCanonicalCategoryName(variants));
  }
  return canon;
}

async function ensureSavedCategory(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const key = categoryKey(trimmed);
  const existing = await SavedCategory.find({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
  }).select('name').lean();
  const canonical = pickCanonicalCategoryName([trimmed, ...existing.map((e) => e.name)]);
  if (!existing.length) {
    try {
      await SavedCategory.create({ name: canonical });
    } catch (e) {
      if (e && e.code !== 11000) throw e;
    }
    return canonical;
  }
  const keep = existing.find((e) => e.name === canonical) || existing[0];
  if (keep.name !== canonical) {
    await SavedCategory.updateOne({ _id: keep._id }, { name: canonical });
  }
  for (const row of existing) {
    if (String(row._id) !== String(keep._id)) {
      await SavedCategory.deleteOne({ _id: row._id });
    }
  }
  return canonical;
}

function dedupeCategoryNamesCaseInsensitive(names) {
  const map = new Map();
  for (const raw of names || []) {
    const t = String(raw).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = categoryKey(t);
    if (!map.has(key)) map.set(key, t);
  }
  return [...map.values()];
}

function dedupeCategoryNamesWithPreferred(names, preferredByKey = new Map()) {
  const map = new Map();
  for (const raw of names || []) {
    const t = String(raw).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = categoryKey(t);
    if (map.has(key)) continue;
    map.set(key, preferredByKey.get(key) || t);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function canonicalizeCategoryNames(categoryList) {
  const deduped = dedupeCategoryNamesCaseInsensitive(categoryList);
  if (!deduped.length) return [];
  const saved = await SavedCategory.find().select('name').lean();
  const canonMap = buildCategoryCanonicalMap([
    ...saved.map((s) => s.name),
    ...deduped,
  ]);
  const out = [];
  const seen = new Set();
  for (const n of deduped) {
    const key = categoryKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonMap.get(key) || n);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function cleanupDuplicateCategories() {
  const saved = await SavedCategory.find().select('name _id').lean();
  const canonMap = buildCategoryCanonicalMap(saved.map((s) => s.name));
  const groups = new Map();
  for (const s of saved) {
    const key = categoryKey(s.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const [, rows] of groups) {
    const canonical = canonMap.get(categoryKey(rows[0].name));
    const keep = rows.find((r) => r.name === canonical) || rows[0];
    if (keep.name !== canonical) {
      await SavedCategory.updateOne({ _id: keep._id }, { name: canonical });
    }
    for (const row of rows) {
      if (String(row._id) !== String(keep._id)) {
        await SavedCategory.deleteOne({ _id: row._id });
      }
    }
  }

  const products = await Product.find().select('categories category');
  let updated = 0;
  for (const p of products) {
    const raw = p.categories?.length ? p.categories.slice() : (p.category ? [p.category] : []);
    if (!raw.length) continue;
    const allNames = [...saved.map((s) => s.name), ...raw];
    const freshCanon = buildCategoryCanonicalMap(allNames);
    const keys = new Map();
    for (const c of raw) {
      const k = categoryKey(c);
      if (!k) continue;
      if (!keys.has(k)) keys.set(k, freshCanon.get(k) || pickCanonicalCategoryName([c]));
    }
    const newCategories = [...keys.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const newCategory = newCategories[0] || '';
    const same = JSON.stringify(p.categories || []) === JSON.stringify(newCategories) && (p.category || '') === newCategory;
    if (!same) {
      p.categories = newCategories;
      p.category = newCategory;
      await p.save();
      updated++;
    }
  }
  if (updated > 0) {
    console.log(`✅ Category cleanup: normalized ${updated} product(s)`);
  }
}

function normalizeProductCategories(body) {
  let categories = [];
  if (body.categories != null) {
    if (typeof body.categories === 'string') {
      try {
        categories = JSON.parse(body.categories);
      } catch {
        categories = body.categories.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(body.categories)) {
      categories = body.categories;
    }
  }
  if (!categories.length && body.category != null && String(body.category).trim()) {
    categories = String(body.category)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  categories = dedupeCategoryNamesCaseInsensitive(categories).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const legacyCategory = categories.length ? categories[0] : (body.category || '').trim();
  return { categories, category: legacyCategory };
}

function productCategoryLabel(product) {
  if (product.categories && product.categories.length) return product.categories.join(', ');
  return product.category || 'N/A';
}

// --- SUPPLIERS ROUTES (master data only; product links via SupplierProduct) ---

app.get('/api/suppliers/field-suggestions', async (req, res) => {
  try {
    const rows = await Supplier.find().select('city postCode province').lean();
    const uniq = (arr) => [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({
      cities: uniq(rows.map((r) => r.city)),
      postCodes: uniq(rows.map((r) => r.postCode)),
      provinces: uniq(rows.map((r) => r.province)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/suppliers/check-name', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.json({ exists: false });
    const filter = {
      $expr: { $eq: [{ $toLower: '$companyName' }, name.toLowerCase()] },
    };
    if (req.query.excludeId) filter._id = { $ne: req.query.excludeId };
    const existing = await Supplier.findOne(filter).select('_id companyName').lean();
    res.json({
      exists: !!existing,
      existingId: existing?._id,
      companyName: existing?.companyName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all suppliers
app.get('/api/suppliers', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = Supplier.find().sort({ companyName: 1 });
    if (req.query.page || req.query.limit) {
      const [suppliers, total] = await Promise.all([query.skip(skip).limit(limit), Supplier.countDocuments()]);
      const normalized = suppliers.map((s) => {
        const obj = s.toObject ? s.toObject() : s;
        return { ...obj, contactPersons: normalizeContactPersons(obj.contactPersons) };
      });
      return res.json(paginatedResponse(normalized, total, page, limit));
    }
    const suppliers = await query;
    const normalized = suppliers.map((s) => {
      const obj = s.toObject ? s.toObject() : s;
      return { ...obj, contactPersons: normalizeContactPersons(obj.contactPersons) };
    });
    res.json(normalized);
  } catch (err) {
    console.error("❌ Error fetching suppliers:", err);
    res.status(500).json({ error: err.message });
  }
});

// ADD new supplier (with optional duplicate check: companyName normalized)
app.post('/api/suppliers', canEdit, upload.single('productSpecsFile'), async (req, res) => {
  try {
    const {
      companyName,
      contactPersons,
      address,
      postCode,
      city,
      province,
      country,
      web,
      skipDuplicateCheck
    } = req.body;

    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    if (!skipDuplicateCheck) {
      const normalized = companyName.trim().toLowerCase();
      const existing = await Supplier.findOne({
        $expr: { $eq: [{ $toLower: '$companyName' }, normalized] }
      });
      if (existing) {
        return res.status(409).json({
          error: 'A supplier with this company name already exists',
          existingId: existing._id
        });
      }
    }

    let contactArray = normalizeContactPersons(contactPersons);

    let visitingCardFilename = req.file ? req.file.filename : '';
    if (req.file && contactArray.length > 0 && contactArray[0].name) {
      const contactName = contactArray[0].name;
      const supplierName = companyName.trim();
      visitingCardFilename = renameToContactSupplier(uploadsDir, req.file.filename, contactName, supplierName, path.extname(req.file.originalname));
    }

    const newSupplier = new Supplier({
      companyName: companyName.trim(),
      contactPersons: contactArray,
      address,
      postCode,
      city,
      province,
      country,
      web,
      productSpecsFile: visitingCardFilename,
      showAsNew: true,
    });

    await newSupplier.save();
    await logSessionEvent(req, 'CREATE_SUPPLIER', 'Supplier', newSupplier._id, {
      companyName: newSupplier.companyName,
      city: newSupplier.city,
      country: newSupplier.country,
    });
    res.json({ message: '✅ Supplier added successfully', supplier: newSupplier });
  } catch (err) {
    console.error("❌ Error adding supplier:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE supplier
app.delete('/api/suppliers/:id', canDelete, async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (supplier) {
      await logSessionEvent(req, 'DELETE_SUPPLIER', 'Supplier', supplier._id, {
        companyName: supplier.companyName,
      });
    }
    res.json({ message: '✅ Supplier deleted successfully' });
  } catch (err) {
    console.error("❌ Error deleting supplier:", err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE supplier (no products field; manage via SupplierProduct)
app.put('/api/suppliers/:id', canEdit, upload.single('productSpecsFile'), async (req, res) => {
  try {
    const updateData = {};
    ["companyName","address","postCode","city","province","country","web"]
      .forEach(f => { if (req.body[f] !== undefined) updateData[f] = req.body[f]; });
    if (req.body.contactPersons) {
      updateData.contactPersons = normalizeContactPersons(req.body.contactPersons);
    }
    if (req.file) {
      const existing = await Supplier.findById(req.params.id);
      const contactName = (existing?.contactPersons && existing.contactPersons[0]?.name) ? existing.contactPersons[0].name : 'Contact';
      const supplierName = (updateData.companyName != null ? updateData.companyName : existing?.companyName) || 'Supplier';
      updateData.productSpecsFile = renameToContactSupplier(uploadsDir, req.file.filename, contactName, supplierName, path.extname(req.file.originalname));
    }
    if (req.body.removeProductSpecsFile === '1' || req.body.removeProductSpecsFile === 'true' || req.body.removeProductSpecsFile === true) {
      updateData.productSpecsFile = null;
    }
    if (req.body.showAsNew !== undefined) {
      updateData.showAsNew = req.body.showAsNew === true || req.body.showAsNew === 'true' || req.body.showAsNew === '1';
    }

    if (updateData.companyName !== undefined && String(updateData.companyName).trim()) {
      const dup = await Supplier.findOne({
        _id: { $ne: req.params.id },
        $expr: { $eq: [{ $toLower: '$companyName' }, String(updateData.companyName).trim().toLowerCase()] },
      });
      if (dup) {
        return res.status(409).json({ error: 'A supplier with this company name already exists', existingId: dup._id });
      }
    }

    const updatedSupplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );
    if (!updatedSupplier) return res.status(404).json({ error: 'Supplier not found' });
    await logSessionEvent(req, 'UPDATE_SUPPLIER', 'Supplier', updatedSupplier._id, {
      companyName: updatedSupplier.companyName,
      city: updatedSupplier.city,
      country: updatedSupplier.country,
    });
    res.json({ message: '✅ Supplier updated successfully', supplier: updatedSupplier });
  } catch (err) {
    console.error("❌ Error updating supplier:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET linked products for a supplier (from SupplierProduct)
app.get('/api/suppliers/:id/products', async (req, res) => {
  try {
    const links = await SupplierProduct.find({ supplierId: req.params.id })
      .populate('productId', 'name category specs packing hsCode')
      .sort({ lastUpdated: -1 });
    res.json(links);
  } catch (err) {
    console.error("❌ Error fetching supplier products:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET single supplier
app.get('/api/suppliers/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    const obj = supplier.toObject ? supplier.toObject() : supplier;
    res.json({
      ...obj,
      contactPersons: normalizeContactPersons(obj.contactPersons),
    });
  } catch (err) {
    console.error("❌ Error fetching supplier:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/suppliers/:id/bank-accounts', requirePermission('suppliers'), async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id).select('companyName bankAccounts').lean();
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json({
      supplierId: supplier._id,
      companyName: supplier.companyName,
      bankAccounts: supplier.bankAccounts || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers/:id/bank-accounts', canEdit, async (req, res) => {
  try {
    const bank = parseSupplierBankBody(req.body || {});
    if (!bank.bankName || !bank.accountNumber) {
      return res.status(400).json({ error: 'Bank name and account number are required' });
    }
    const result = await upsertSupplierBankAccount(req.params.id, bank, req.body.bankAccountId);
    const supplier = await Supplier.findById(req.params.id).select('bankAccounts').lean();
    res.status(201).json({
      message: 'Bank account saved',
      bank: result.bank,
      bankAccountId: result.bankAccountId,
      bankAccounts: supplier?.bankAccounts || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUPPLIER-PRODUCT (pivot) ROUTES ---
app.get('/api/supplier-products', async (req, res) => {
  try {
    const { productId, supplierId } = req.query;
    const filter = {};
    if (productId) filter.productId = productId;
    if (supplierId) filter.supplierId = supplierId;
    const links = await SupplierProduct.find(filter)
      .populate('productId', 'name category hsCode')
      .populate('supplierId', 'companyName')
      .sort({ lastUpdated: -1 });
    res.json(links);
  } catch (err) {
    console.error("❌ Error fetching supplier-products:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/supplier-products/:id', async (req, res) => {
  try {
    const link = await SupplierProduct.findById(req.params.id)
      .populate('productId')
      .populate('supplierId');
    if (!link) return res.status(404).json({ error: 'SupplierProduct not found' });
    res.json(link);
  } catch (err) {
    console.error("❌ Error fetching supplier-product:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/supplier-products/find-or-create', canEdit, async (req, res) => {
  try {
    const { productId, supplierId, supplierPrice, currency, MOQ, leadTime, notes } = req.body;
    if (!productId || !supplierId) {
      return res.status(400).json({ error: 'productId and supplierId are required' });
    }
    let link = await SupplierProduct.findOne({ productId, supplierId });
    if (link) {
      const update = { lastUpdated: new Date() };
      if (supplierPrice !== undefined) update.supplierPrice = supplierPrice;
      if (currency !== undefined) update.currency = currency;
      if (MOQ !== undefined) update.MOQ = MOQ;
      if (leadTime !== undefined) update.leadTime = leadTime;
      if (notes !== undefined) update.notes = notes;
      link = await SupplierProduct.findByIdAndUpdate(link._id, { $set: update }, { new: true })
        .populate('productId')
        .populate('supplierId');
    } else {
      link = new SupplierProduct({
        productId,
        supplierId,
        supplierPrice: supplierPrice ?? null,
        currency: currency || 'USD',
        MOQ: MOQ ?? null,
        leadTime: leadTime ?? null,
        notes: notes ?? null,
      });
      await link.save();
      link = await SupplierProduct.findById(link._id).populate('productId').populate('supplierId');
    }
    res.json(link);
  } catch (err) {
    console.error("❌ Error find-or-create supplier-product:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST accepts multipart with optional productInfoFile and packingImage (saved as [productName]-[supplierName].ext)
app.post('/api/supplier-products', canEdit, upload.fields([{ name: 'productInfoFile', maxCount: 1 }, { name: 'packingImage', maxCount: 1 }]), async (req, res) => {
  try {
    const body = req.body || {};
    const productId = body.productId;
    const supplierId = body.supplierId;
    if (!productId || !supplierId) {
      return res.status(400).json({ error: 'productId and supplierId are required' });
    }
    const existing = await SupplierProduct.findOne({ productId, supplierId });
    if (existing) {
      return res.status(409).json({ error: 'This supplier–product link already exists', link: existing });
    }
    const [product, supplier] = await Promise.all([
      Product.findById(productId).select('name'),
      Supplier.findById(supplierId).select('companyName'),
    ]);
    const productName = product?.name || 'product';
    const supplierName = supplier?.companyName || 'supplier';

    let productInfoFile = null;
    let packingImage = null;
    const f1 = req.files?.productInfoFile?.[0];
    const f2 = req.files?.packingImage?.[0];
    if (f1) {
      productInfoFile = renameToProductSupplier(uploadsDir, f1.filename, productName, supplierName, path.extname(f1.originalname));
    }
    if (f2) {
      packingImage = renameToProductSupplier(uploadsDir, f2.filename, productName, supplierName, path.extname(f2.originalname));
    }

    const link = new SupplierProduct({
      productId,
      supplierId,
      notes: body.notes || null,
      productInfoFile: productInfoFile || undefined,
      packingImage: packingImage || undefined,
    });
    await link.save();
    const populated = await SupplierProduct.findById(link._id).populate('productId').populate('supplierId');
    await logSessionEvent(req, 'CREATE_SUPPLIER_PRODUCT_LINK', 'SupplierProduct', link._id, {
      productName: populated.productId?.name || productName,
      supplierName: populated.supplierId?.companyName || supplierName,
    });
    res.status(201).json({ message: '✅ Supplier–Product link created', link: populated });
  } catch (err) {
    console.error("❌ Error creating supplier-product:", err);
    res.status(500).json({ error: err.message });
  }
});

// PUT accepts multipart (optional productInfoFile, packingImage; saved as [productName]-[supplierName].ext)
app.put('/api/supplier-products/:id', canEdit, upload.fields([{ name: 'productInfoFile', maxCount: 1 }, { name: 'packingImage', maxCount: 1 }]), async (req, res) => {
  try {
    const body = req.body || {};
    const update = { lastUpdated: new Date() };
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.supplierPrice !== undefined && body.supplierPrice !== '') update.supplierPrice = Number(body.supplierPrice);
    if (body.currency !== undefined) update.currency = body.currency || null;
    if (body.MOQ !== undefined) update.MOQ = body.MOQ || null;
    if (body.leadTime !== undefined) update.leadTime = body.leadTime || null;

    const link = await SupplierProduct.findById(req.params.id).populate('productId', 'name').populate('supplierId', 'companyName');
    if (!link) return res.status(404).json({ error: 'SupplierProduct not found' });

    const productName = link.productId?.name || 'product';
    const supplierName = link.supplierId?.companyName || 'supplier';

    const f1 = req.files?.productInfoFile?.[0];
    const f2 = req.files?.packingImage?.[0];
    if (f1) {
      update.productInfoFile = renameToProductSupplier(uploadsDir, f1.filename, productName, supplierName, path.extname(f1.originalname));
    }
    if (f2) {
      update.packingImage = renameToProductSupplier(uploadsDir, f2.filename, productName, supplierName, path.extname(f2.originalname));
    }

    const updated = await SupplierProduct.findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
      .populate('productId')
      .populate('supplierId');
    const logDetails = {
      productName: updated.productId?.name || productName,
      supplierName: updated.supplierId?.companyName || supplierName,
    };
    if (f1) {
      await logSessionEvent(req, 'UPDATE_SUPPLIER_PRODUCT_LINK', 'SupplierProduct', updated._id, {
        ...logDetails,
        change: 'product info document',
      });
    } else if (f2) {
      await logSessionEvent(req, 'UPDATE_SUPPLIER_PRODUCT_LINK', 'SupplierProduct', updated._id, {
        ...logDetails,
        change: 'packing image',
      });
    } else if (body.notes !== undefined) {
      await logSessionEvent(req, 'UPDATE_SUPPLIER_PRODUCT_LINK', 'SupplierProduct', updated._id, {
        ...logDetails,
        notes: body.notes || '',
      });
    }
    res.json({ message: '✅ Supplier–Product updated', link: updated });
  } catch (err) {
    console.error("❌ Error updating supplier-product:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/supplier-products/:id', canDelete, async (req, res) => {
  try {
    const deleted = await SupplierProduct.findById(req.params.id)
      .populate('productId', 'name')
      .populate('supplierId', 'companyName');
    if (!deleted) return res.status(404).json({ error: 'SupplierProduct not found' });
    await SupplierProduct.findByIdAndDelete(req.params.id);
    await logSessionEvent(req, 'DELETE_SUPPLIER_PRODUCT_LINK', 'SupplierProduct', deleted._id, {
      productName: deleted.productId?.name || 'Unknown product',
      supplierName: deleted.supplierId?.companyName || 'Unknown supplier',
    });
    res.json({ message: '✅ Supplier–Product link deleted' });
  } catch (err) {
    console.error("❌ Error deleting supplier-product:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- PRODUCT-CLIENT (pivot) ROUTES ---
app.get('/api/product-clients', async (req, res) => {
  try {
    const { productId } = req.query;
    const filter = productId ? { productId } : {};
    const links = await ProductClient.find(filter)
      .populate('productId', 'name')
      .populate('clientId', 'companyName email')
      .sort({ createdAt: -1 });
    res.json(links);
  } catch (err) {
    console.error("❌ Error fetching product-clients:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/product-clients', canEdit, async (req, res) => {
  try {
    const { productId, clientId, notes } = req.body;
    if (!productId || !clientId) {
      return res.status(400).json({ error: 'productId and clientId are required' });
    }
    const existing = await ProductClient.findOne({ productId, clientId });
    if (existing) {
      return res.status(409).json({ error: 'This product–client link already exists', link: existing });
    }
    const link = new ProductClient({ productId, clientId, notes: notes || null });
    await link.save();
    const populated = await ProductClient.findById(link._id).populate('productId', 'name').populate('clientId', 'companyName email');
    res.status(201).json({ message: '✅ Product–Client link created', link: populated });
  } catch (err) {
    console.error("❌ Error creating product-client:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/product-clients/:id', async (req, res) => {
  try {
    const link = await ProductClient.findById(req.params.id)
      .populate('productId', 'name')
      .populate('clientId', 'companyName');
    if (!link) return res.status(404).json({ error: 'Product–Client link not found' });
    res.json(link);
  } catch (err) {
    console.error("❌ Error fetching product-client:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/product-clients/:id', canEdit, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const update = {};
    if (notes !== undefined) update.notes = notes || null;
    const link = await ProductClient.findByIdAndUpdate(
      req.params.id,
      Object.keys(update).length ? { $set: update } : {},
      { new: true }
    )
      .populate('productId', 'name')
      .populate('clientId', 'companyName');
    if (!link) return res.status(404).json({ error: 'Product–Client link not found' });
    res.json({ message: '✅ Link updated', link });
  } catch (err) {
    console.error("❌ Error updating product-client:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/product-clients/:id', canDelete, async (req, res) => {
  try {
    const deleted = await ProductClient.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'ProductClient not found' });
    res.json({ message: '✅ Product–Client link deleted' });
  } catch (err) {
    console.error("❌ Error deleting product-client:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- PRODUCTS ROUTES (master catalog only) ---

app.get('/api/products/check-name', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.json({ exists: false });
    const filter = {
      $expr: { $eq: [{ $toLower: '$name' }, name.toLowerCase()] },
    };
    if (req.query.excludeId) filter._id = { $ne: req.query.excludeId };
    const existing = await Product.findOne(filter).select('_id name').lean();
    res.json({
      exists: !!existing,
      existingId: existing?._id,
      name: existing?.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD product
app.post('/api/products', canEdit, productFormUpload, async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Form data not received. Ensure enctype="multipart/form-data"' });
    }
    const { name, packing, hsCode, importDuty, incomeTax, salesTax } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Product name is required' });
    }
    const skipDuplicateCheck = req.body.skipDuplicateCheck === true
      || req.body.skipDuplicateCheck === 'true'
      || req.body.skipDuplicateCheck === '1';
    if (!skipDuplicateCheck) {
      const normalized = String(name).trim().toLowerCase();
      const existing = await Product.findOne({
        $expr: { $eq: [{ $toLower: '$name' }, normalized] },
      });
      if (existing) {
        return res.status(409).json({
          error: 'A product with this name already exists',
          existingId: existing._id,
          name: existing.name,
        });
      }
    }
    let { categories, category } = normalizeProductCategories(req.body);
    categories = await canonicalizeCategoryNames(categories);
    category = categories.length ? categories[0] : '';
    if (!categories.length) {
      return res.status(400).json({ error: 'Select at least one category' });
    }

    const packingPicFile = req.files?.packingPic?.[0];
    const otherFiles = req.files?.otherDocuments || [];
    const otherDocuments = [];
    let idx = 0;
    for (const f of otherFiles) {
      otherDocuments.push(
        renameToProductOther(uploadsDir, f.filename, name || 'product', idx, path.extname(f.originalname))
      );
      idx++;
    }

    const newProduct = new Product({
      categories,
      category,
      name,
      specs: req.body.specs || '',
      packing,
      specification: req.body.specification || '',
      packingPic: packingPicFile ? packingPicFile.filename : null,
      otherDocuments,
      productNote: (req.body.productNote || '').trim(),
      hsCode,
      importDuty: parseFloat(importDuty) || 0,
      incomeTax: parseFloat(incomeTax) || 0,
      salesTax: parseFloat(salesTax) || 0,
      showAsNew: true,
    });

    await newProduct.save();
    await persistCategoryNames(categories);
    await logSessionEvent(req, 'CREATE_PRODUCT', 'Product', newProduct._id, {
      name: newProduct.name,
      category: newProduct.category,
      hsCode: newProduct.hsCode,
    });
    res.json({ message: '✅ Product saved to DB', product: newProduct });
  } catch (err) {
    console.error('❌ Error creating product:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET distinct HS codes (for dropdown when adding/editing products)
app.get('/api/products/hs-codes/list', async (req, res) => {
  try {
    const codes = await Product.distinct('hsCode');
    res.json(codes.filter(Boolean).sort());
  } catch (err) {
    console.error('❌ Error fetching HS codes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Saved + in-use category names (alphabetical) for product forms
app.get('/api/product-categories', async (req, res) => {
  try {
    const saved = await SavedCategory.find().sort({ name: 1 }).select('name').lean();
    const products = await Product.find({}).select('categories category').lean();
    const allNames = [...saved.map((s) => s.name)];
    for (const p of products) {
      if (p.categories && p.categories.length) {
        p.categories.forEach((c) => c && allNames.push(String(c).trim()));
      } else if (p.category) {
        allNames.push(String(p.category).trim());
      }
    }
    const canonMap = buildCategoryCanonicalMap(allNames);
    const list = dedupeCategoryNamesWithPreferred(allNames, canonMap);
    res.json(list);
  } catch (err) {
    console.error('❌ Error fetching product categories:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET products (master list; linked data via separate endpoints)
app.get('/api/products', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = Product.find().sort({ name: 1 });
    if (req.query.page || req.query.limit) {
      const [items, total] = await Promise.all([query.skip(skip).limit(limit), Product.countDocuments()]);
      return res.json(paginatedResponse(items, total, page, limit));
    }
    res.json(await query);
  } catch (err) {
    console.error('❌ Error fetching products:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET linked suppliers for a product (from SupplierProduct)
app.get('/api/products/:id/linked-suppliers', async (req, res) => {
  try {
    const links = await SupplierProduct.find({ productId: req.params.id })
      .populate('supplierId', 'companyName contactPersons')
      .populate('productId', 'name hsCode')
      .sort({ lastUpdated: -1 });
    res.json(links);
  } catch (err) {
    console.error('❌ Error fetching linked suppliers:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET linked clients for a product (from ProductClient)
app.get('/api/products/:id/linked-clients', async (req, res) => {
  try {
    const links = await ProductClient.find({ productId: req.params.id })
      .populate('clientId', 'companyName contactPersons tel mobile email')
      .populate('productId', 'name')
      .sort({ createdAt: -1 });
    res.json(links);
  } catch (err) {
    console.error('❌ Error fetching linked clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single product (for detail view)
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    console.error('❌ Error fetching product:', err);
    res.status(500).json({ error: err.message });
  }
});

// Duplicate product (master row + copied files; does not copy supplier/client links)
app.post('/api/products/:id/duplicate', canEdit, async (req, res) => {
  try {
    const src = await Product.findById(req.params.id);
    if (!src) return res.status(404).json({ error: 'Product not found' });

    const baseName = `${src.name || 'Product'} (copy)`;
    let categories = [];
    if (src.categories && src.categories.length) categories = [...src.categories];
    else if (src.category) categories = [src.category];

    const copyPayload = {
      category: categories.length ? categories[0] : '',
      categories,
      name: baseName,
      specs: src.specs || '',
      packing: src.packing || '',
      specification: src.specification || '',
      hsCode: src.hsCode,
      importDuty: src.importDuty,
      incomeTax: src.incomeTax,
      salesTax: src.salesTax,
      productNote: src.productNote || '',
      showAsNew: true,
      packingPic: null,
      otherDocuments: [],
    };

    if (src.packingPic) {
      const oldP = path.join(uploadsDir, src.packingPic);
      if (fs.existsSync(oldP)) {
        const ext = path.extname(src.packingPic);
        const newPn = sanitizeFilenamePart(baseName) + '-packing-copy-' + Date.now() + ext;
        fs.copyFileSync(oldP, path.join(uploadsDir, newPn));
        copyPayload.packingPic = newPn;
      }
    }

    for (let i = 0; i < (src.otherDocuments || []).length; i++) {
      const fn = src.otherDocuments[i];
      const oldP = path.join(uploadsDir, fn);
      if (!fs.existsSync(oldP)) continue;
      const ext = path.extname(fn);
      const newFn = sanitizeFilenamePart(baseName) + '-other-dup-' + Date.now() + '-' + i + ext;
      fs.copyFileSync(oldP, path.join(uploadsDir, newFn));
      copyPayload.otherDocuments.push(newFn);
    }

    const newProduct = new Product(copyPayload);
    await newProduct.save();
    await persistCategoryNames(categories);
    await logSessionEvent(req, 'CREATE_PRODUCT', 'Product', newProduct._id, {
      name: newProduct.name,
      duplicatedFrom: String(src._id),
    });
    res.json({ message: '✅ Product duplicated', product: newProduct });
  } catch (err) {
    console.error('❌ Error duplicating product:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE product
app.delete('/api/products/:id', canDelete, async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) return res.status(404).json({ error: 'Product not found' });
    await logSessionEvent(req, 'DELETE_PRODUCT', 'Product', deletedProduct._id, {
      name: deletedProduct.name,
      category: deletedProduct.category,
    });
    res.json({ message: '✅ Product deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting product:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE product (master fields only; optional packingPic / otherDocuments or removePackingPic to clear)
app.put('/api/products/:id', canEdit, productFormUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const updateData = {};
    ['name', 'specs', 'packing', 'specification', 'hsCode', 'productNote'].forEach((f) => {
      if (body[f] !== undefined) updateData[f] = body[f];
    });
    if (body.categories !== undefined || body.category !== undefined) {
      let n = normalizeProductCategories(body);
      n.categories = await canonicalizeCategoryNames(n.categories);
      n.category = n.categories.length ? n.categories[0] : '';
      updateData.categories = n.categories;
      updateData.category = n.category;
    }
    if (body.importDuty !== undefined) updateData.importDuty = parseFloat(body.importDuty);
    if (body.incomeTax !== undefined) updateData.incomeTax = parseFloat(body.incomeTax);
    if (body.salesTax !== undefined) updateData.salesTax = parseFloat(body.salesTax);
    if (body.showAsNew !== undefined) {
      updateData.showAsNew = body.showAsNew === true || body.showAsNew === 'true' || body.showAsNew === '1';
    }

    const picFile = req.files?.packingPic?.[0];
    if (picFile) updateData.packingPic = picFile.filename;
    if (body.removePackingPic === '1' || body.removePackingPic === 'true' || body.removePackingPic === true) {
      updateData.packingPic = null;
    }

    const existingDocsRow = await Product.findById(req.params.id).select('name otherDocuments').lean();
    let otherDocsWorking = [...(existingDocsRow?.otherDocuments || [])];

    if (body.removeOtherDocuments !== undefined) {
      let toRemove = [];
      try {
        toRemove = typeof body.removeOtherDocuments === 'string'
          ? JSON.parse(body.removeOtherDocuments)
          : body.removeOtherDocuments;
      } catch (_) { /* ignore */ }
      if (Array.isArray(toRemove) && toRemove.length) {
        const removeSet = new Set(toRemove);
        otherDocsWorking = otherDocsWorking.filter((f) => !removeSet.has(f));
        updateData.otherDocuments = otherDocsWorking;
      }
    }

    const otherFiles = req.files?.otherDocuments || [];
    if (otherFiles.length) {
      const productName = (body.name != null ? body.name : existingDocsRow?.name) || 'product';
      let idx = otherDocsWorking.length;
      for (const f of otherFiles) {
        otherDocsWorking.push(
          renameToProductOther(uploadsDir, f.filename, productName, idx, path.extname(f.originalname))
        );
        idx++;
      }
      updateData.otherDocuments = otherDocsWorking;
    }

    if (body.name !== undefined && String(body.name).trim()) {
      const normalized = String(body.name).trim().toLowerCase();
      const dup = await Product.findOne({
        _id: { $ne: req.params.id },
        $expr: { $eq: [{ $toLower: '$name' }, normalized] },
      });
      if (dup) {
        return res.status(409).json({
          error: 'A product with this name already exists',
          existingId: dup._id,
          name: dup.name,
        });
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
    if (!updatedProduct) return res.status(404).json({ error: 'Product not found' });
    if (updateData.categories) await persistCategoryNames(updateData.categories);
    await logSessionEvent(req, 'UPDATE_PRODUCT', 'Product', updatedProduct._id, {
      name: updatedProduct.name,
      category: updatedProduct.category,
      hsCode: updatedProduct.hsCode,
    });
    res.json({ message: '✅ Product updated successfully', product: updatedProduct });
  } catch (err) {
    console.error('❌ Error updating product:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- CLIENTS ROUTES (master data only; products derived from Quotations) ---

app.get('/api/clients/field-suggestions', async (req, res) => {
  try {
    const rows = await Client.find().select('city postCode province').lean();
    const uniq = (arr) => [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({
      cities: uniq(rows.map((r) => r.city)),
      postCodes: uniq(rows.map((r) => r.postCode)),
      provinces: uniq(rows.map((r) => r.province)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/check-name', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.json({ exists: false });
    const filter = {
      $expr: { $eq: [{ $toLower: '$companyName' }, name.toLowerCase()] },
    };
    if (req.query.excludeId) filter._id = { $ne: req.query.excludeId };
    const existing = await Client.findOne(filter).select('_id companyName').lean();
    res.json({
      exists: !!existing,
      existingId: existing?._id,
      companyName: existing?.companyName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = Client.find().sort({ companyName: 1 });
    const normalizeList = (clients) => clients.map((c) => {
      const obj = c.toObject ? c.toObject() : c;
      return { ...obj, contactPersons: normalizeContactPersons(obj.contactPersons) };
    });
    if (req.query.page || req.query.limit) {
      const [clients, total] = await Promise.all([query.skip(skip).limit(limit), Client.countDocuments()]);
      return res.json(paginatedResponse(normalizeList(clients), total, page, limit));
    }
    res.json(normalizeList(await query));
  } catch (err) {
    console.error('❌ Error fetching clients:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const obj = client.toObject ? client.toObject() : client;
    res.json({
      ...obj,
      contactPersons: normalizeContactPersons(obj.contactPersons),
    });
  } catch (err) {
    console.error('❌ Error fetching client:', err);
    res.status(500).json({ error: err.message });
  }
});

// Inline create: optional duplicate check by companyName (skipDuplicateCheck for edit flows)
app.post('/api/clients', canEdit, upload.single('ntnFile'), async (req, res) => {
  try {
    const data = req.body;
    if (!data.companyName || !data.companyName.trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    if (!data.skipDuplicateCheck) {
      const normalized = data.companyName.trim().toLowerCase();
      const existing = await Client.findOne({
        $expr: { $eq: [{ $toLower: '$companyName' }, normalized] }
      });
      if (existing) {
        return res.status(409).json({
          error: 'A client with this company name already exists',
          existingId: existing._id
        });
      }
    }

    let ntnFilename = req.file ? req.file.filename : null;
    if (req.file) {
      ntnFilename = renameToClientNTN(uploadsDir, req.file.filename, data.companyName.trim(), path.extname(req.file.originalname));
    }
    const clientData = {
      companyName: data.companyName.trim(),
      contactPersons: normalizeContactPersons(data.contactPersons),
      address: data.address,
      postCode: data.postCode,
      city: data.city,
      province: data.province,
      country: data.country,
      tel: data.tel,
      mobile: data.mobile,
      email: data.email,
      web: data.web,
      wechat: data.wechat,
      facebook: data.facebook,
      whatsapp: data.whatsapp,
      others: data.others,
      notes: data.notes || null,
      ntnNumber: (data.ntnNumber || '').trim(),
      showAsNew: true,
    };
    if (ntnFilename) clientData.ntnFile = ntnFilename;

    const newClient = new Client(clientData);
    await newClient.save();
    await logSessionEvent(req, 'CREATE_CLIENT', 'Client', newClient._id, {
      companyName: newClient.companyName,
      city: newClient.city,
      country: newClient.country,
    });
    res.status(201).json({ message: '✅ Client added successfully', client: newClient });
  } catch (err) {
    console.error('❌ Error adding client:', err);
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/clients/:id', canEdit, upload.single('ntnFile'), async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const data = req.body;

    client.companyName = data.companyName ?? client.companyName;
    if (data.contactPersons !== undefined) {
      client.contactPersons = normalizeContactPersons(data.contactPersons);
    }
    client.address = data.address ?? client.address;
    client.postCode = data.postCode ?? client.postCode;
    client.city = data.city ?? client.city;
    client.province = data.province ?? client.province;
    client.country = data.country ?? client.country;
    client.tel = data.tel ?? client.tel;
    client.mobile = data.mobile ?? client.mobile;
    client.email = data.email ?? client.email;
    client.web = data.web ?? client.web;
    client.wechat = data.wechat ?? client.wechat;
    client.facebook = data.facebook ?? client.facebook;
    client.whatsapp = data.whatsapp ?? client.whatsapp;
    client.others = data.others ?? client.others;
    if (data.notes !== undefined) client.notes = data.notes || null;
    if (data.ntnNumber !== undefined) client.ntnNumber = String(data.ntnNumber || '').trim();
    if (req.file) {
      client.ntnFile = renameToClientNTN(uploadsDir, req.file.filename, (data.companyName || client.companyName || '').trim(), path.extname(req.file.originalname));
    }
    if (data.removeNtnFile === '1' || data.removeNtnFile === 'true' || data.removeNtnFile === true) {
      client.ntnFile = null;
    }
    if (data.showAsNew !== undefined) {
      client.showAsNew = data.showAsNew === true || data.showAsNew === 'true' || data.showAsNew === '1';
    }

    if (data.companyName !== undefined && String(data.companyName).trim()) {
      const dup = await Client.findOne({
        _id: { $ne: req.params.id },
        $expr: { $eq: [{ $toLower: '$companyName' }, String(data.companyName).trim().toLowerCase()] },
      });
      if (dup) {
        return res.status(409).json({ error: 'A client with this company name already exists', existingId: dup._id });
      }
    }

    await client.save();
    await logSessionEvent(req, 'UPDATE_CLIENT', 'Client', client._id, {
      companyName: client.companyName,
      city: client.city,
      country: client.country,
    });
    res.json({ message: '✅ Client updated successfully', client });
  } catch (err) {
    console.error('❌ Error updating client:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET products linked to client (from ProductClient)
app.get('/api/clients/:id/products', async (req, res) => {
  try {
    const links = await ProductClient.find({ clientId: req.params.id })
      .populate('productId', 'name category hsCode')
      .populate('clientId', 'companyName')
      .sort({ createdAt: -1 });
    res.json(links);
  } catch (err) {
    console.error('❌ Error fetching client products:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', canDelete, async (req, res) => {
  try {
    const deletedClient = await Client.findByIdAndDelete(req.params.id);
    if (!deletedClient) return res.status(404).json({ error: 'Client not found' });
    await logSessionEvent(req, 'DELETE_CLIENT', 'Client', deletedClient._id, {
      companyName: deletedClient.companyName,
      city: deletedClient.city,
      country: deletedClient.country,
    });
    res.json({ message: '✅ Client deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting client:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- EMAIL PRODUCT DETAILS TO SPECIFIC CLIENT ---
app.post('/api/email/send-product-details', canEmail, async (req, res) => {
  try {
    const { clientId, product, price, taxes, toEmail } = req.body;

    // Fetch client details
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const recipient = (toEmail && String(toEmail).trim())
      ? String(toEmail).trim()
      : firstEmailFromContactsOrCompanyEmail(client.contactPersons, client.email);
    if (!recipient) return res.status(400).json({ error: "Client email not found" });

    const priceStr = price != null && price !== '' ? String(price) : 'N/A';
    const taxStr = taxes && (taxes.incomeTax != null || taxes.salesTax != null || taxes.duty != null)
      ? `Income Tax: ${taxes.incomeTax ?? 0}%, Sales Tax: ${taxes.salesTax ?? 0}%, Duty: ${taxes.duty ?? 0}%`
      : 'N/A';
    const emailBody = `
      <h2>📦 Product Details</h2>
      <p><strong>Product Name:</strong> ${product.name}</p>
      <p><strong>Description:</strong> ${product.description || "N/A"}</p>
      <p><strong>Category:</strong> ${product.categories && product.categories.length ? product.categories.join(', ') : (product.category || "N/A")}</p>
      <p><strong>Specs:</strong> ${product.specs || "N/A"}</p>
      <p><strong>Packing:</strong> ${product.packing || "N/A"}</p>
      <p><strong>HS Code:</strong> ${product.hsCode || "N/A"}</p>
      <p><strong>Price:</strong> ${priceStr}</p>
      <p><strong>Taxes:</strong> ${taxStr}</p>
      <hr/>
      <p>Best Regards,<br>TRI Brothers Dashboard</p>
    `;

    // Reuse your existing Nodemailer transporter (no need to re-create)
    await sendMail({
      from: `"TRI Dashboard" <thehomepageco786@gmail.com>`,
      to: recipient,
      subject: `Product Details - ${product.name}`,
      html: emailBody
    });

    res.json({ message: "✅ Product details email sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending product email:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- QUOTATIONS ROUTES (transactional; optional supplierProduct for cost reference) ---

app.get('/api/quotations', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = Quotation.find()
      .populate('product', 'name hsCode')
      .populate('client', 'companyName email')
      .populate('supplierProduct')
      .populate({ path: 'offer', populate: [{ path: 'supplier', select: 'companyName' }, { path: 'product', select: 'name' }] })
      .sort({ createdAt: -1 });
    if (req.query.page || req.query.limit) {
      const [items, total] = await Promise.all([query.skip(skip).limit(limit), Quotation.countDocuments()]);
      return res.json(paginatedResponse(items, total, page, limit));
    }
    res.json(await query);
  } catch (err) {
    console.error('❌ Error fetching quotations:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create quotations: one per selected client. Optional email (no base cost/margin/supplier in email).
// Body: productId, clientIds (array), supplierProductId, offerId, baseCost, margin, duties, hsCode, finalPrice, notes, sendEmail (boolean)
app.post('/api/quotations', canEdit, async (req, res) => {
  try {
    const { productId, clientIds, clientId, supplierProductId, offerId, baseCost, margin, duties, hsCode, finalPrice, price, notes, sendEmail } = req.body;
    const finalPriceNum = finalPrice != null ? Number(finalPrice) : (price != null ? Number(price) : null);
    if (!productId || (finalPriceNum === null || finalPriceNum === undefined || isNaN(finalPriceNum))) {
      return res.status(400).json({ error: 'Product and final price are required' });
    }
    const ids = Array.isArray(clientIds) ? clientIds : (clientId ? [clientId] : []);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one client' });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const clients = await Client.find({ _id: { $in: ids } });
    if (clients.length !== ids.length) {
      return res.status(400).json({ error: 'One or more clients not found' });
    }

    const doSendEmail = sendEmail === true || sendEmail === 'true';
    const hsCodeVal = hsCode || product.hsCode;
    const emailBodyNoRef = `
      <h2>📄 Quotation</h2>
      <p><strong>Product:</strong> ${product.name}</p>
      <p><strong>HS Code:</strong> ${hsCodeVal || 'N/A'}</p>
      <p><strong>Final Price:</strong> ${finalPriceNum}</p>
      <p><strong>Duties:</strong> ${duties || 'N/A'}</p>
      <hr/>
      <p>Best Regards,<br>TRI Brothers Dashboard</p>
    `;

    const created = [];
    for (const client of clients) {
      const quotation = new Quotation({
        product: productId,
        client: client._id,
        supplierProduct: supplierProductId || undefined,
        offer: offerId || undefined,
        baseCost: baseCost != null && baseCost !== '' ? Number(baseCost) : undefined,
        margin: margin != null && margin !== '' ? Number(margin) : undefined,
        duties: duties || undefined,
        hsCode: hsCodeVal,
        finalPrice: finalPriceNum,
        notes: notes || undefined,
      });
      await quotation.save();

      if (doSendEmail && client.email && client.email.trim()) {
        try {
          await sendMail({
            from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
            to: client.email,
            subject: `Quotation for ${product.name}`,
            html: emailBodyNoRef,
          });
        } catch (emailErr) {
          console.error('Quotation email failed for', client.companyName, emailErr);
        }
      }

      const populated = await Quotation.findById(quotation._id)
        .populate('product', 'name hsCode')
        .populate('client', 'companyName email')
        .populate('supplierProduct')
        .populate({ path: 'offer', populate: [{ path: 'supplier', select: 'companyName' }, { path: 'product', select: 'name' }] });
      created.push(populated);
    }

    const emailMsg = doSendEmail ? ` Emailed ${clients.filter(c => c.email).length} client(s).` : ' (not emailed).';
    res.status(201).json({
      message: `✅ ${created.length} quotation(s) created.${emailMsg}`,
      quotations: created,
    });
  } catch (err) {
    console.error('❌ Error creating quotation:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update quotation
app.put('/api/quotations/:id', canEdit, async (req, res) => {
  try {
    const { productId, clientId, supplierProductId, offerId, baseCost, margin, duties, hsCode, finalPrice, price, notes } = req.body;
    const updateData = {};
    if (productId) updateData.product = productId;
    if (clientId) updateData.client = clientId;
    if (supplierProductId !== undefined) updateData.supplierProduct = supplierProductId || null;
    if (offerId !== undefined) updateData.offer = offerId || null;
    if (baseCost !== undefined) updateData.baseCost = baseCost != null && baseCost !== '' ? Number(baseCost) : null;
    if (margin !== undefined) updateData.margin = margin != null && margin !== '' ? Number(margin) : null;
    if (duties !== undefined) updateData.duties = duties;
    if (hsCode !== undefined) updateData.hsCode = hsCode;
    const fp = finalPrice != null ? finalPrice : price;
    if (fp !== undefined) updateData.finalPrice = Number(fp);
    if (notes !== undefined) updateData.notes = notes;

    const updated = await Quotation.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    )
      .populate('product', 'name hsCode')
      .populate('client', 'companyName email')
      .populate('supplierProduct')
      .populate({ path: 'offer', populate: [{ path: 'supplier', select: 'companyName' }, { path: 'product', select: 'name' }] });

    if (!updated) return res.status(404).json({ error: 'Quotation not found' });
    res.json({ message: '✅ Quotation updated successfully', quotation: updated });
  } catch (err) {
    console.error('❌ Error updating quotation:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete quotation
app.delete('/api/quotations/:id', canDelete, async (req, res) => {
  try {
    const deleted = await Quotation.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Quotation not found' });
    res.json({ message: '✅ Quotation deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting quotation:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- SALES CONTRACT ROUTES ---

const VALID_CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

/** Resolve a product/supplier ref without losing the ObjectId when populate failed. */
function refId(value) {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return value._id;
  return value;
}

function refPopulated(value) {
  if (!value || typeof value !== 'object') return null;
  // Populated docs have a name/companyName; bare ObjectIds do not.
  if (value.name || value.companyName) return value;
  return null;
}

function getContractLinesFromDoc(doc) {
  if (!doc) return [];
  const obj = doc.toObject ? doc.toObject() : doc;
  if (Array.isArray(obj.productLines) && obj.productLines.length) {
    return obj.productLines.map((l) => ({
      _id: l._id,
      product: refId(l.product),
      productPopulated: refPopulated(l.product) || l.productPopulated || null,
      quantity: Number(l.quantity) || 0,
      quantityUnit: l.quantityUnit || 'MT',
      price: Number(l.price) || 0,
      itemSpecsNote: l.itemSpecsNote || '',
      packing: l.packing || '',
      itemSpecsFile: l.itemSpecsFile || null,
    }));
  }
  if (obj.product) {
    return [{
      _id: null,
      product: refId(obj.product),
      productPopulated: refPopulated(obj.product) || null,
      quantity: Number(obj.quantity) || 0,
      quantityUnit: obj.quantityUnit || 'MT',
      price: Number(obj.price) || 0,
      itemSpecsNote: '',
      packing: '',
      itemSpecsFile: null,
    }];
  }
  return [];
}

function parseProductLinesJson(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => ({
    _id: l._id || l.lineId || undefined,
    productId: l.productId || l.product,
    quantity: Number(l.quantity),
    quantityUnit: l.quantityUnit || 'MT',
    price: Number(l.price),
    itemSpecsNote: String(l.itemSpecsNote || '').trim(),
    packing: String(l.packing || '').trim(),
    itemSpecsFile: l.itemSpecsFile || null,
    keepSpecsFile: l.keepSpecsFile !== false && l.keepSpecsFile !== 'false',
  })).filter((l) => l.productId && !Number.isNaN(l.quantity) && l.quantity > 0 && !Number.isNaN(l.price) && l.price >= 0);
}

function attachLineSpecFiles(lines, files) {
  // Specs are notes now; ignore file uploads for new lines but keep legacy files if present
  return (lines || []).map((l) => ({
    ...l,
    itemSpecsFile: l.keepSpecsFile ? l.itemSpecsFile : (l.itemSpecsFile || null),
  }));
}

function parseSupplierBankBody(body = {}) {
  return {
    bankName: String(body.bankName || body.supplierBankName || '').trim(),
    swiftCode: String(body.swiftCode || body.supplierSwiftCode || '').trim(),
    accountNumber: String(body.accountNumber || body.supplierAccountNumber || '').trim(),
    bankAddress: String(body.bankAddress || body.supplierBankAddress || '').trim(),
  };
}

async function upsertSupplierBankAccount(supplierId, bank, bankAccountId) {
  if (!supplierId || !bank) return { bank, bankAccountId: bankAccountId || null };
  if (!bank.bankName && !bank.accountNumber) {
    return { bank: { bankName: '', swiftCode: '', accountNumber: '', bankAddress: '' }, bankAccountId: null };
  }
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) return { bank, bankAccountId: null };

  let account = null;
  if (bankAccountId) {
    account = (supplier.bankAccounts || []).id(bankAccountId);
  }
  if (!account && bank.accountNumber) {
    account = (supplier.bankAccounts || []).find(
      (a) => String(a.accountNumber) === String(bank.accountNumber)
        && String(a.bankName || '').toLowerCase() === String(bank.bankName || '').toLowerCase()
    );
  }

  if (account) {
    account.bankName = bank.bankName || account.bankName;
    account.swiftCode = bank.swiftCode || account.swiftCode;
    account.accountNumber = bank.accountNumber || account.accountNumber;
    account.bankAddress = bank.bankAddress || account.bankAddress;
  } else {
    supplier.bankAccounts.push({
      bankName: bank.bankName,
      swiftCode: bank.swiftCode,
      accountNumber: bank.accountNumber,
      bankAddress: bank.bankAddress,
      isDefault: !(supplier.bankAccounts || []).length,
    });
    account = supplier.bankAccounts[supplier.bankAccounts.length - 1];
  }
  await supplier.save();
  return {
    bank: {
      bankName: account.bankName || '',
      swiftCode: account.swiftCode || '',
      accountNumber: account.accountNumber || '',
      bankAddress: account.bankAddress || '',
    },
    bankAccountId: account._id,
  };
}

function resolveContractFileUpload(body, files, existingDoc = null) {
  const uploaded = (files || []).find((f) => f.fieldname === 'contractFile');
  if (uploaded) return uploaded.filename;
  const keep = body.keepContractFile !== 'false' && body.keepContractFile !== false;
  if (existingDoc && keep && existingDoc.contractFile) return existingDoc.contractFile;
  return null;
}

function formatPaymentTermsLabel(doc) {
  const pt = doc.paymentTerms;
  if (!pt) return '';
  if (pt === 'Custom') return doc.paymentTermsCustom || 'Custom';
  if (pt === 'CAD' && doc.cadDays) return `CAD (${doc.cadDays} days)`;
  if (pt === 'DA' && doc.daDays) return `DA (${doc.daDays} days)`;
  return pt;
}

function formatContractTermsLabel(doc) {
  if (doc.contractTerms === 'Custom') return doc.contractTermsCustom || 'Custom';
  return doc.contractTerms || '';
}

function validateSalesContractBody(body, parsedLines, isUpdate = false) {
  const errors = [];
  const supplierId = body.supplierId || body.supplier;
  if (!isUpdate || supplierId !== undefined) {
    if (!supplierId) errors.push('Supplier is required');
  }
  if (!isUpdate || body.originCountry !== undefined) {
    if (!String(body.originCountry || '').trim()) errors.push('Origin country is required');
  }
  if (!isUpdate || parsedLines !== undefined) {
    if (!parsedLines || !parsedLines.length) errors.push('Add at least one product line');
    else {
      parsedLines.forEach((l, i) => {
        if (!l.productId) errors.push(`Product is required on line ${i + 1}`);
        if (Number.isNaN(l.quantity) || l.quantity <= 0) errors.push(`Quantity must be greater than zero on line ${i + 1}`);
        if (!SalesContract.QUANTITY_UNITS.includes(l.quantityUnit)) errors.push(`Invalid unit on line ${i + 1}`);
        if (Number.isNaN(l.price) || l.price < 0) errors.push(`Price is required on line ${i + 1}`);
      });
    }
  }
  if (!isUpdate || body.contractTerms !== undefined) {
    const ct = body.contractTerms;
    if (!ct || !SalesContract.CONTRACT_TERMS.includes(ct)) {
      errors.push('Invalid contract terms');
    } else if (ct === 'Custom' && !String(body.contractTermsCustom || '').trim()) {
      errors.push('Enter custom sales contract terms');
    }
  }
  if (!isUpdate || body.paymentTerms !== undefined) {
    const pt = body.paymentTerms;
    if (!pt || !SalesContract.PAYMENT_TERMS.includes(pt)) {
      errors.push('Invalid payment terms');
    } else if (pt === 'Custom' && !String(body.paymentTermsCustom || '').trim()) {
      errors.push('Enter custom payment terms');
    }
    if (pt === 'CAD') {
      const cadDays = Number(body.cadDays);
      if (!body.cadDays || Number.isNaN(cadDays) || cadDays < 1) {
        errors.push('Number of days is required when payment terms is CAD');
      }
    }
  }
  if (!isUpdate || body.shipmentType !== undefined) {
    if (!body.shipmentType || !SalesContract.SHIPMENT_TYPES.includes(body.shipmentType)) {
      errors.push('Shipment type must be FCL, LCL, or Bulk');
    }
  }
  if (!isUpdate || body.priceCurrency !== undefined) {
    const cur = String(body.priceCurrency || 'USD').trim().toUpperCase();
    if (!VALID_CURRENCY_CODES.has(cur)) errors.push('Invalid price currency');
  }
  if (!isUpdate || body.contractNumber !== undefined) {
    if (!String(body.contractNumber || '').trim()) errors.push('Contract number is required');
  }
  if (!isUpdate || body.contractDate !== undefined) {
    if (!body.contractDate) errors.push('Contract date is required');
  }
  if (!isUpdate || body.deliveryTime !== undefined) {
    if (!String(body.deliveryTime || '').trim()) errors.push('Delivery time is required');
  }
  return errors;
}

async function sumAllocatedQtyForContractLine(contractId, contractLineId, productId, excludeIndentId = null) {
  const indents = await Indent.find({ salesContract: contractId }).select('lines').lean();
  let total = 0;
  for (const ind of indents) {
    if (excludeIndentId && String(ind._id) === String(excludeIndentId)) continue;
    for (const line of ind.lines || []) {
      const qty = Number(line.quantity) || 0;
      if (contractLineId && line.contractLineId && String(line.contractLineId) === String(contractLineId)) {
        total += qty;
      } else if (productId && String(line.product) === String(productId)) {
        total += qty;
      }
    }
  }
  return total;
}

async function sumAllocatedQtyForContract(contractId, excludeIndentId = null) {
  const indents = await Indent.find({ salesContract: contractId }).select('lines').lean();
  let total = 0;
  for (const ind of indents) {
    if (excludeIndentId && String(ind._id) === String(excludeIndentId)) continue;
    for (const line of ind.lines || []) {
      total += Number(line.quantity) || 0;
    }
  }
  return total;
}

async function enrichSalesContractWithBalance(doc) {
  // Always re-read lean (unpopulated) so missing Product/Supplier refs do not
  // wipe ObjectIds the way mongoose populate(null) does.
  const raw = doc && doc._id
    ? await SalesContract.findById(doc._id).lean()
    : (doc && doc.toObject ? doc.toObject() : { ...doc });
  if (!raw) return doc && doc.toObject ? doc.toObject() : { ...doc };
  const obj = { ...raw };

  const supplierId = refId(obj.supplier);
  if (supplierId) {
    const supplier = await Supplier.findById(supplierId)
      .select('companyName city country contactPersons')
      .lean();
    obj.supplier = supplier || supplierId;
  }

  const lines = getContractLinesFromDoc(obj);
  const productIds = [...new Set(lines.map((l) => l.product).filter(Boolean).map(String))];
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
      .select('name hsCode packing categories category')
      .lean()
    : [];
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  let totalQty = 0;
  let totalAllocated = 0;
  obj.productLinesEnriched = await Promise.all(lines.map(async (line) => {
    const allocated = await sumAllocatedQtyForContractLine(obj._id, line._id, line.product);
    const remaining = Math.max(0, line.quantity - allocated);
    totalQty += line.quantity;
    totalAllocated += allocated;
    const populated = line.product ? productMap.get(String(line.product)) || null : null;
    return {
      ...line,
      product: line.product,
      productPopulated: populated,
      allocatedQuantity: allocated,
      remainingQuantity: remaining,
    };
  }));
  obj.allocatedQuantity = totalAllocated;
  obj.remainingQuantity = Math.max(0, totalQty - totalAllocated);
  obj.totalQuantity = totalQty;
  if (lines.length === 1) {
    obj.product = obj.productLinesEnriched[0].productPopulated || lines[0].product;
    obj.quantity = lines[0].quantity;
    obj.price = lines[0].price;
    obj.quantityUnit = lines[0].quantityUnit;
  }
  return obj;
}

async function buildProductLinesPayload(parsedLines, existingDoc = null) {
  const productIds = [...new Set(parsedLines.map((l) => String(l.productId)))];
  const products = await Product.find({ _id: { $in: productIds } }).select('name').lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  for (const id of productIds) {
    if (!productMap.has(id)) throw new Error('One or more products were not found');
  }
  const existingLines = existingDoc ? getContractLinesFromDoc(existingDoc) : [];
  return parsedLines.map((l) => {
    const existing = l._id
      ? existingLines.find((x) => x._id && String(x._id) === String(l._id))
      : null;
    const payload = {
      product: l.productId,
      quantity: l.quantity,
      quantityUnit: l.quantityUnit,
      price: l.price,
      itemSpecsNote: l.itemSpecsNote || '',
      packing: l.packing || '',
      itemSpecsFile: l.itemSpecsFile || (existing && l.keepSpecsFile ? existing.itemSpecsFile : null),
    };
    if (l._id) payload._id = l._id;
    return payload;
  });
}

async function validateLineQtyNotBelowAllocated(contractId, parsedLines, existingDoc) {
  const existingLines = getContractLinesFromDoc(existingDoc);
  for (const l of parsedLines) {
    const prev = l._id
      ? existingLines.find((x) => x._id && String(x._id) === String(l._id))
      : existingLines.find((x) => String(x.product) === String(l.productId));
    if (!prev) continue;
    const allocated = await sumAllocatedQtyForContractLine(contractId, prev._id, prev.product);
    if (l.quantity < allocated) {
      const prod = await Product.findById(l.productId).select('name').lean();
      return {
        ok: false,
        error: `Quantity for ${prod?.name || 'product'} cannot be less than allocated (${allocated}). Update or delete indents first.`,
      };
    }
  }
  return { ok: true };
}

function salesContractPopulateQuery() {
  // Do NOT populate productLines.product / supplier here.
  // Missing refs are set to null by mongoose and wipe the stored ObjectId,
  // which breaks indent saves and empties product/supplier labels.
  // Names are resolved safely in enrichSalesContractWithBalance.
  return [];
}

app.get('/api/currencies', requirePermission('quotes'), (req, res) => {
  res.json(CURRENCIES);
});

async function nextIndentNumber() {
  const year = new Date().getFullYear();
  const prefix = `IND-${year}-`;
  const last = await Indent.findOne({ indentNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .sort({ indentNumber: -1 })
    .select('indentNumber')
    .lean();
  let seq = 1;
  if (last && last.indentNumber) {
    const m = String(last.indentNumber).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function sumIndentLineQty(lines) {
  return (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

function normalizeIndentLines(rawLines, contractLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) return [];
  const lines = contractLines || [];
  return rawLines.map((l) => {
    const client = l.clientId || l.client;
    const quantity = Number(l.quantity);
    let contractLineId = l.contractLineId || l.lineId;
    let product = l.productId || l.product;
    let quantityUnit = l.quantityUnit;

    if (contractLineId) {
      const cl = lines.find((x) => x._id && String(x._id) === String(contractLineId));
      if (cl) {
        product = cl.product;
        quantityUnit = quantityUnit || cl.quantityUnit;
      }
    } else if (product) {
      const matches = lines.filter((x) => String(x.product) === String(product));
      if (matches.length === 1) {
        contractLineId = matches[0]._id;
        quantityUnit = quantityUnit || matches[0].quantityUnit;
      }
    } else if (lines.length === 1) {
      contractLineId = lines[0]._id;
      product = lines[0].product;
      quantityUnit = quantityUnit || lines[0].quantityUnit;
    }

    return {
      client,
      product,
      contractLineId: contractLineId || undefined,
      quantity,
      quantityUnit: quantityUnit || 'MT',
      ntnNumber: String(l.ntnNumber || '').trim(),
    };
  }).filter((l) => l.client && l.product && l.quantity > 0);
}

app.get('/api/sales-contracts', requirePermission('quotes'), async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = SalesContract.find()
      .populate(salesContractPopulateQuery())
      .sort({ contractDate: -1, createdAt: -1 });
    if (req.query.page || req.query.limit) {
      const [items, total] = await Promise.all([query.skip(skip).limit(limit), SalesContract.countDocuments()]);
      const enriched = await Promise.all(items.map((i) => enrichSalesContractWithBalance(i)));
      return res.json(paginatedResponse(enriched, total, page, limit));
    }
    const items = await query;
    const enriched = await Promise.all(items.map((i) => enrichSalesContractWithBalance(i)));
    res.json(enriched);
  } catch (err) {
    console.error('❌ Error fetching sales contracts:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales-contracts/:id', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await SalesContract.findById(req.params.id).populate(salesContractPopulateQuery());
    if (!doc) return res.status(404).json({ error: 'Sales contract not found' });
    res.json(await enrichSalesContractWithBalance(doc));
  } catch (err) {
    console.error('❌ Error fetching sales contract:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales-contracts', requirePermission('quotes'), canEdit, salesContractUpload, async (req, res) => {
  try {
    const body = req.body || {};
    let parsedLines = parseProductLinesJson(body.productLines);
    parsedLines = attachLineSpecFiles(parsedLines, req.files);
    const errors = validateSalesContractBody(body, parsedLines);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    const supplierId = body.supplierId || body.supplier;
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const paymentTerms = body.paymentTerms;
    const productLines = await buildProductLinesPayload(parsedLines);
    const bankInput = parseSupplierBankBody(body);
    const bankResult = await upsertSupplierBankAccount(
      supplierId,
      bankInput,
      body.supplierBankAccountId || body.bankAccountId
    );
    const payload = {
      supplier: supplierId,
      originCountry: String(body.originCountry).trim(),
      productLines,
      contractTerms: body.contractTerms,
      contractTermsCustom: body.contractTerms === 'Custom' ? String(body.contractTermsCustom || '').trim() : '',
      paymentTerms,
      paymentTermsCustom: paymentTerms === 'Custom' ? String(body.paymentTermsCustom || '').trim() : '',
      cadDays: paymentTerms === 'CAD' ? Number(body.cadDays) : undefined,
      shipmentType: body.shipmentType,
      priceCurrency: String(body.priceCurrency || 'USD').trim().toUpperCase(),
      contractDate: new Date(body.contractDate),
      contractNumber: String(body.contractNumber).trim(),
      deliveryTime: String(body.deliveryTime).trim(),
      specialInstructions: String(body.specialInstructions || '').trim(),
      contractFile: resolveContractFileUpload(body, req.files),
      brandName: String(body.brandName || '').trim(),
      portOfShipment: String(body.portOfShipment || '').trim(),
      portOfDischarge: String(body.portOfDischarge || '').trim(),
      supplierCommissionPerMt: Math.max(0, Number(body.supplierCommissionPerMt) || 0),
      supplierCommissionCurrency: String(body.supplierCommissionCurrency || body.priceCurrency || 'USD').trim().toUpperCase(),
      supplierBank: bankResult.bank,
      supplierBankAccountId: bankResult.bankAccountId || undefined,
    };

    const contract = await SalesContract.create(payload);
    const populated = await SalesContract.findById(contract._id).populate(salesContractPopulateQuery());

    await syncSupplierCommission(contract._id);

    await logSessionEvent(req, 'CREATE_SALES_CONTRACT', 'SalesContract', contract._id, {
      contractNumber: contract.contractNumber,
      supplierName: supplier.companyName,
      productCount: productLines.length,
      originCountry: contract.originCountry,
    });

    res.status(201).json({ message: '✅ Sales contract saved', contract: await enrichSalesContractWithBalance(populated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'A contract with this contract number already exists' });
    }
    console.error('❌ Error creating sales contract:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sales-contracts/:id', requirePermission('quotes'), canEdit, salesContractUpload, async (req, res) => {
  try {
    const existing = await SalesContract.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sales contract not found' });

    const body = req.body || {};
    let parsedLines = body.productLines !== undefined
      ? attachLineSpecFiles(parseProductLinesJson(body.productLines), req.files)
      : undefined;
    const errors = validateSalesContractBody(body, parsedLines, true);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });

    const update = {};
    if (body.supplierId || body.supplier) update.supplier = body.supplierId || body.supplier;
    if (body.originCountry !== undefined) update.originCountry = String(body.originCountry).trim();
    if (parsedLines) {
      const qtyCheck = await validateLineQtyNotBelowAllocated(req.params.id, parsedLines, existing);
      if (!qtyCheck.ok) return res.status(400).json({ error: qtyCheck.error });
      update.productLines = await buildProductLinesPayload(parsedLines, existing);
    }
    if (body.contractTerms !== undefined) {
      update.contractTerms = body.contractTerms;
      update.contractTermsCustom = body.contractTerms === 'Custom' ? String(body.contractTermsCustom || '').trim() : '';
    }
    if (body.paymentTerms !== undefined) {
      update.paymentTerms = body.paymentTerms;
      update.cadDays = body.paymentTerms === 'CAD' ? Number(body.cadDays) : null;
      update.paymentTermsCustom = body.paymentTerms === 'Custom' ? String(body.paymentTermsCustom || '').trim() : '';
    } else if (body.cadDays !== undefined && existing.paymentTerms === 'CAD') {
      update.cadDays = Number(body.cadDays);
    }
    if (body.shipmentType !== undefined) update.shipmentType = body.shipmentType;
    if (body.priceCurrency !== undefined) update.priceCurrency = String(body.priceCurrency).trim().toUpperCase();
    if (body.contractDate !== undefined) update.contractDate = new Date(body.contractDate);
    if (body.contractNumber !== undefined) update.contractNumber = String(body.contractNumber).trim();
    if (body.deliveryTime !== undefined) update.deliveryTime = String(body.deliveryTime).trim();
    if (body.specialInstructions !== undefined) update.specialInstructions = String(body.specialInstructions || '').trim();
    if (body.brandName !== undefined) update.brandName = String(body.brandName || '').trim();
    if (body.portOfShipment !== undefined) update.portOfShipment = String(body.portOfShipment || '').trim();
    if (body.portOfDischarge !== undefined) update.portOfDischarge = String(body.portOfDischarge || '').trim();
    if (body.supplierCommissionPerMt !== undefined) {
      update.supplierCommissionPerMt = Math.max(0, Number(body.supplierCommissionPerMt) || 0);
    }
    if (body.supplierCommissionCurrency !== undefined) {
      update.supplierCommissionCurrency = String(body.supplierCommissionCurrency || 'USD').trim().toUpperCase();
    }
    if (
      body.bankName !== undefined || body.supplierBankName !== undefined
      || body.accountNumber !== undefined || body.supplierAccountNumber !== undefined
      || body.swiftCode !== undefined || body.bankAddress !== undefined
      || body.supplierBankAccountId !== undefined
    ) {
      const bankInput = parseSupplierBankBody(body);
      const supplierForBank = update.supplier || existing.supplier;
      const bankResult = await upsertSupplierBankAccount(
        supplierForBank,
        bankInput,
        body.supplierBankAccountId || body.bankAccountId
      );
      update.supplierBank = bankResult.bank;
      update.supplierBankAccountId = bankResult.bankAccountId || null;
    }
    if (req.files?.length || body.keepContractFile !== undefined) {
      update.contractFile = resolveContractFileUpload(body, req.files, existing);
    }

    if (update.supplier) {
      const supplier = await Supplier.findById(update.supplier);
      if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    }

    const updated = await SalesContract.findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
      .populate(salesContractPopulateQuery());
    if (!updated) return res.status(404).json({ error: 'Sales contract not found' });

    await syncSupplierCommission(updated._id);

    await logSessionEvent(req, 'UPDATE_SALES_CONTRACT', 'SalesContract', updated._id, {
      contractNumber: updated.contractNumber,
      supplierName: updated.supplier?.companyName,
    });

    res.json({ message: '✅ Sales contract updated', contract: await enrichSalesContractWithBalance(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'A contract with this contract number already exists' });
    }
    console.error('❌ Error updating sales contract:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales-contracts/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    const allocated = await sumAllocatedQtyForContract(req.params.id);
    if (allocated > 0) {
      return res.status(400).json({ error: 'Cannot delete a sales contract that has indents. Delete indents first.' });
    }
    const deleted = await SalesContract.findById(req.params.id).populate(salesContractPopulateQuery());
    if (!deleted) return res.status(404).json({ error: 'Sales contract not found' });
    await SalesContract.findByIdAndDelete(req.params.id);
    await removeSupplierCommission(deleted._id);
    await logSessionEvent(req, 'DELETE_SALES_CONTRACT', 'SalesContract', deleted._id, {
      contractNumber: deleted.contractNumber,
      supplierName: deleted.supplier?.companyName,
    });
    res.json({ message: '✅ Sales contract deleted' });
  } catch (err) {
    console.error('❌ Error deleting sales contract:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- INDENT ROUTES ---

async function enrichIndentWithBalance(doc) {
  const obj = doc && doc.toObject ? doc.toObject() : { ...doc };
  const contractId = obj.salesContract?._id || obj.salesContract;
  if (contractId) {
    let contract = obj.salesContract;
    if (!contract || !contract.contractNumber) {
      contract = await SalesContract.findById(contractId).populate(salesContractPopulateQuery()).lean();
    }
    if (contract) {
      const enriched = await enrichSalesContractWithBalance(contract);
      obj.salesContract = enriched;
      obj.contractRemainingQuantity = enriched.remainingQuantity;
      obj.contractTotalQuantity = enriched.totalQuantity;
      obj.contractAllocatedQuantity = enriched.allocatedQuantity;
      obj.contractProductLines = enriched.productLinesEnriched || [];
    }
  }
  obj.indentTotalQuantity = sumIndentLineQty(obj.lines);
  obj.indentQtyMt = indentQtyInMt(obj);
  obj.commissionTotal = indentCommissionTotal(obj, obj.salesContract);
  return obj;
}

async function validateIndentAllocation(contractId, lines, excludeIndentId = null) {
  // Load without populate so product ObjectIds stay intact even if Product was deleted.
  const contract = await SalesContract.findById(contractId);
  if (!contract) return { ok: false, error: 'Sales contract not found' };
  const contractLines = getContractLinesFromDoc(contract);
  if (!contractLines.length) return { ok: false, error: 'Sales contract has no product lines' };

  const productIds = [...new Set(contractLines.map((l) => l.product).filter(Boolean).map(String))];
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).select('name').lean()
    : [];
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  for (const cl of contractLines) {
    cl.productPopulated = cl.product ? productMap.get(String(cl.product)) || null : null;
  }

  const normalized = normalizeIndentLines(lines, contractLines);
  if (!normalized.length) {
    return {
      ok: false,
      error: 'Add at least one client with quantity (check product line is selected)',
    };
  }

  const usageByLine = {};
  for (const line of normalized) {
    const key = line.contractLineId ? String(line.contractLineId) : String(line.product);
    usageByLine[key] = (usageByLine[key] || 0) + line.quantity;
  }

  for (const [key, newQty] of Object.entries(usageByLine)) {
    const cl = contractLines.find((l) =>
      (l._id && String(l._id) === key) || String(l.product) === key
    );
    if (!cl) return { ok: false, error: 'Invalid product line selected' };
    if (!cl.product) {
      return {
        ok: false,
        error: 'This contract product line has no product linked. Edit the sales contract and re-select the product.',
      };
    }
    const allocated = await sumAllocatedQtyForContractLine(contractId, cl._id, cl.product, excludeIndentId);
    const remaining = cl.quantity - allocated;
    if (newQty > remaining + 0.0001) {
      const prodName = cl.productPopulated?.name || 'Product';
      return {
        ok: false,
        error: `Quantity for ${prodName} (${newQty}) exceeds remaining (${Math.max(0, remaining)}).`,
      };
    }
  }

  return { ok: true, contract, normalized, contractLines };
}

async function buildIndentPrintHtml(indent, options = {}) {
  const settings = await Settings.getGlobal();
  const contract = indent.salesContract;
  const supplierName = contract?.supplier?.companyName || '—';
  const contractLines = getContractLinesFromDoc(contract);
  const productLabel = contractLines.length > 1
    ? contractLines.map((l) => {
      const name = l.productPopulated?.name || 'Product';
      return `${name} (${l.quantity} ${l.quantityUnit || 'MT'})`;
    }).join('; ')
    : (contractLines[0]?.productPopulated?.name || contract?.product?.name || '—');

  const lineRows = (indent.lines || []).map((line) => {
    const clientName = line.client?.companyName || '—';
    const ntn = line.ntnNumber || line.client?.ntnNumber || '—';
    const prodDoc = line.product?.name
      ? line.product
      : contractLines.find((cl) => String(cl.product) === String(line.product))?.productPopulated;
    const prod = prodDoc?.name || '—';
    const hs = prodDoc?.hsCode || '—';
    const unit = line.quantityUnit || 'MT';
    return `<tr>
      <td>${clientName}</td>
      <td>${prod}</td>
      <td>${hs}</td>
      <td>${ntn}</td>
      <td>${line.quantity} ${unit}</td>
    </tr>`;
  }).join('');

  const onlyLineId = options.lineId;
  let filteredRows = lineRows;
  let titleClient = '';
  if (onlyLineId) {
    const one = (indent.lines || []).find((l) => String(l._id) === String(onlyLineId));
    if (one) {
      titleClient = one.client?.companyName || '';
      const prod = one.product?.name || '—';
      const hs = one.product?.hsCode || '—';
      const unit = one.quantityUnit || 'MT';
      filteredRows = `<tr>
        <td>${one.client?.companyName || '—'}</td>
        <td>${prod}</td>
        <td>${hs}</td>
        <td>${one.ntnNumber || one.client?.ntnNumber || '—'}</td>
        <td>${one.quantity} ${unit}</td>
      </tr>`;
    }
  }

  const paymentLabel = formatPaymentTermsLabel(contract || {});
  const termsLabel = formatContractTermsLabel(contract || {});
  const bank = contract?.supplierBank || {};
  const clientCommCalc = computeIndentCommissionDetails(indent, contract);
  const clientCur = clientCommCalc.currency || 'USD';
  const sellPrice = Number(indent.sellingPricePerMt) || 0;
  const sellCur = indent.sellingPriceCurrency || clientCur;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Indent ${indent.indentNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#222;max-width:900px;margin:0 auto}
      h1{color:#1a56db;font-size:1.5rem;margin-bottom:4px}
      .meta{margin:16px 0 24px;line-height:1.6}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td,th{border:1px solid #ddd;padding:10px;text-align:left}
      th{background:#f3f4f6}
      .footer{margin-top:40px;color:#666;font-size:0.9em;white-space:pre-line}
      @media print{body{padding:16px}}
    </style></head><body>
    <h1>${settings.companyName || 'Tri Brothers'}</h1>
    <p>${settings.companyAddress || ''}<br>${settings.companyPhone || ''} ${settings.companyEmail || ''}</p>
    <h2>Indent${titleClient ? ` — ${titleClient}` : ''}</h2>
    <div class="meta">
      <strong>Indent #:</strong> ${indent.indentNumber}<br>
      <strong>Date:</strong> ${new Date(indent.indentDate).toLocaleDateString()}<br>
      <strong>Sales contract:</strong> ${contract?.contractNumber || '—'}<br>
      <strong>Supplier:</strong> ${supplierName}<br>
      <strong>Origin:</strong> ${contract?.originCountry || '—'}<br>
      ${contract?.brandName ? `<strong>Brand:</strong> ${contract.brandName}<br>` : ''}
      <strong>Product(s):</strong> ${productLabel}<br>
      ${termsLabel ? `<strong>Terms:</strong> ${termsLabel}<br>` : ''}
      ${paymentLabel ? `<strong>Payment:</strong> ${paymentLabel}<br>` : ''}
      ${contract?.shipmentType ? `<strong>Shipment:</strong> ${contract.shipmentType}<br>` : ''}
      ${indent.portOfShipment || contract?.portOfShipment ? `<strong>Port of shipment:</strong> ${indent.portOfShipment || contract.portOfShipment}<br>` : ''}
      ${indent.portOfDischarge || contract?.portOfDischarge ? `<strong>Port of discharge:</strong> ${indent.portOfDischarge || contract.portOfDischarge}<br>` : ''}
      ${indent.lastDateOfShipment ? `<strong>Last date of shipment:</strong> ${new Date(indent.lastDateOfShipment).toLocaleDateString()}<br>` : ''}
      ${sellPrice ? `<strong>Selling price:</strong> ${sellCur} ${sellPrice.toFixed(2)} / MT<br>` : ''}
      ${clientCommCalc.amount > 0 ? `<strong>Estimated margin:</strong> ${clientCur} ${clientCommCalc.amount.toFixed(2)} (${clientCommCalc.quantityMt.toFixed(3)} MT)<br>` : ''}
      ${contract?.supplierCommissionPerMt ? `<strong>Supplier commission:</strong> ${contract.supplierCommissionCurrency || 'USD'} ${Number(contract.supplierCommissionPerMt).toFixed(2)} / MT<br>` : ''}
      ${bank.bankName ? `<strong>Supplier bank:</strong> ${bank.bankName}<br>` : ''}
      ${bank.accountNumber ? `<strong>Account #:</strong> ${bank.accountNumber}<br>` : ''}
      ${bank.swiftCode ? `<strong>SWIFT:</strong> ${bank.swiftCode}<br>` : ''}
      ${bank.bankAddress ? `<strong>Bank address:</strong> ${bank.bankAddress}<br>` : ''}
      ${indent.remarks ? `<strong>Remarks:</strong> ${indent.remarks}<br>` : ''}
      ${indent.notes ? `<strong>Notes:</strong> ${indent.notes}<br>` : ''}
    </div>
    <table>
      <thead><tr><th>Client</th><th>Product</th><th>HS Code</th><th>NTN #</th><th>Quantity</th></tr></thead>
      <tbody>${filteredRows}</tbody>
    </table>
    <div class="footer">${settings.emailSignature || ''}</div>
    ${options.autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
    </body></html>`;
}

function indentPopulateSpec() {
  return {
    path: 'salesContract',
    populate: salesContractPopulateQuery(),
  };
}

app.get('/api/indents', requirePermission('quotes'), async (req, res) => {
  try {
    const items = await Indent.find()
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber email contactPersons')
      .populate('lines.product', 'name hsCode')
      .sort({ indentDate: -1, createdAt: -1 });
    const enriched = await Promise.all(items.map((i) => enrichIndentWithBalance(i)));
    res.json(enriched);
  } catch (err) {
    console.error('❌ Error fetching indents:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indents/:id', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Indent.findById(req.params.id)
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber email contactPersons')
      .populate('lines.product', 'name hsCode');
    if (!doc) return res.status(404).json({ error: 'Indent not found' });
    res.json(await enrichIndentWithBalance(doc));
  } catch (err) {
    console.error('❌ Error fetching indent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indents/:id/print', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Indent.findById(req.params.id)
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber')
      .populate('lines.product', 'name hsCode');
    if (!doc) return res.status(404).json({ error: 'Indent not found' });
    const html = await buildIndentPrintHtml(doc, { lineId: req.query.lineId, autoPrint: true });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('❌ Error printing indent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/indents', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const body = req.body || {};
    const contractId = body.salesContractId || body.salesContract;
    if (!contractId) return res.status(400).json({ error: 'Sales contract is required' });

    const check = await validateIndentAllocation(contractId, body.lines);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const indentNumber = String(body.indentNumber || '').trim() || await nextIndentNumber();
    const indentDate = body.indentDate ? new Date(body.indentDate) : new Date();
    if (Number.isNaN(indentDate.getTime())) return res.status(400).json({ error: 'Invalid indent date' });

    const sellingPricePerMt = Math.max(0, Number(body.sellingPricePerMt) || 0);
    const sellingPriceCurrency = String(body.sellingPriceCurrency || check.contract.priceCurrency || 'USD').trim().toUpperCase();
    const commFields = deriveIndentCommissionFields(
      { sellingPricePerMt, sellingPriceCurrency, lines: check.normalized },
      check.contract
    );
    const indent = await Indent.create({
      salesContract: contractId,
      indentNumber,
      indentDate,
      lines: check.normalized,
      notes: String(body.notes || '').trim(),
      remarks: String(body.remarks || '').trim(),
      lastDateOfShipment: body.lastDateOfShipment ? new Date(body.lastDateOfShipment) : undefined,
      portOfShipment: String(body.portOfShipment || check.contract.portOfShipment || '').trim(),
      portOfDischarge: String(body.portOfDischarge || check.contract.portOfDischarge || '').trim(),
      sellingPricePerMt,
      sellingPriceCurrency,
      ...commFields,
    });

    await syncIndentCommission(indent._id);

    const populated = await Indent.findById(indent._id)
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber')
      .populate('lines.product', 'name hsCode');

    await logSessionEvent(req, 'CREATE_INDENT', 'Indent', indent._id, {
      indentNumber: indent.indentNumber,
      contractNumber: check.contract.contractNumber,
      quantity: sumIndentLineQty(check.normalized),
    });

    res.status(201).json({ message: '✅ Indent saved', indent: await enrichIndentWithBalance(populated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'An indent with this number already exists' });
    }
    console.error('❌ Error creating indent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/indents/:id', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const existing = await Indent.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Indent not found' });
    const body = req.body || {};
    const contractId = body.salesContractId || body.salesContract || existing.salesContract;

    const update = {};
    if (body.salesContractId || body.salesContract) update.salesContract = contractId;
    if (body.indentNumber !== undefined) update.indentNumber = String(body.indentNumber).trim();
    if (body.indentDate !== undefined) update.indentDate = new Date(body.indentDate);
    if (body.notes !== undefined) update.notes = String(body.notes || '').trim();
    if (body.remarks !== undefined) update.remarks = String(body.remarks || '').trim();
    if (body.lastDateOfShipment !== undefined) {
      update.lastDateOfShipment = body.lastDateOfShipment ? new Date(body.lastDateOfShipment) : null;
    }
    if (body.portOfShipment !== undefined) update.portOfShipment = String(body.portOfShipment || '').trim();
    if (body.portOfDischarge !== undefined) update.portOfDischarge = String(body.portOfDischarge || '').trim();
    if (body.sellingPricePerMt !== undefined) update.sellingPricePerMt = Math.max(0, Number(body.sellingPricePerMt) || 0);
    if (body.sellingPriceCurrency !== undefined) {
      update.sellingPriceCurrency = String(body.sellingPriceCurrency || 'USD').trim().toUpperCase();
    }
    if (body.lines !== undefined) {
      const check = await validateIndentAllocation(contractId, body.lines, req.params.id);
      if (!check.ok) return res.status(400).json({ error: check.error });
      update.lines = check.normalized;
    }

    const mergedForComm = {
      ...existing.toObject(),
      ...update,
      lines: update.lines || existing.lines,
      salesContract: contractId,
    };
    const contractDoc = await SalesContract.findById(contractId);
    Object.assign(update, deriveIndentCommissionFields(mergedForComm, contractDoc));

    const updated = await Indent.findByIdAndUpdate(req.params.id, { $set: update }, { new: true })
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber')
      .populate('lines.product', 'name hsCode');

    await logSessionEvent(req, 'UPDATE_INDENT', 'Indent', updated._id, {
      indentNumber: updated.indentNumber,
    });

    await syncIndentCommission(updated._id);

    res.json({ message: '✅ Indent updated', indent: await enrichIndentWithBalance(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'An indent with this number already exists' });
    }
    console.error('❌ Error updating indent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/indents/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    const deleted = await Indent.findById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Indent not found' });
    await Indent.findByIdAndDelete(req.params.id);
    await removeIndentCommission(deleted._id);
    await logSessionEvent(req, 'DELETE_INDENT', 'Indent', deleted._id, {
      indentNumber: deleted.indentNumber,
    });
    res.json({ message: '✅ Indent deleted' });
  } catch (err) {
    console.error('❌ Error deleting indent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/indents/:id/email', requirePermission('quotes'), canEmail, async (req, res) => {
  try {
    const { lineId, toEmail } = req.body || {};
    if (!lineId) return res.status(400).json({ error: 'lineId is required' });

    const indent = await Indent.findById(req.params.id)
      .populate(indentPopulateSpec())
      .populate('lines.client', 'companyName ntnNumber email contactPersons')
      .populate('lines.product', 'name hsCode');
    if (!indent) return res.status(404).json({ error: 'Indent not found' });

    const line = (indent.lines || []).find((l) => String(l._id) === String(lineId));
    if (!line) return res.status(404).json({ error: 'Client line not found' });

    let resolvedEmail = (toEmail || '').trim();
    if (!resolvedEmail && line.client) {
      const cps = normalizeContactPersons(line.client.contactPersons);
      resolvedEmail = cps.map((c) => (c.email || '').trim()).find(Boolean) || '';
      if (!resolvedEmail && line.client.email) resolvedEmail = String(line.client.email).trim();
    }
    if (!resolvedEmail) return res.status(400).json({ error: 'No email address for this client' });

    const html = await buildIndentPrintHtml(indent, { lineId });
    const contract = indent.salesContract;
    const prodName = line.product?.name || contract?.product?.name || 'Product';
    const subject = `Indent ${indent.indentNumber} — ${line.client?.companyName || 'Client'} — ${prodName}`;

    await sendMail({ to: resolvedEmail, subject, html });
    await logSessionEvent(req, 'EMAIL_INDENT', 'Indent', indent._id, {
      indentNumber: indent.indentNumber,
      clientName: line.client?.companyName,
      toEmail: resolvedEmail,
    });

    res.json({ message: `Indent emailed to ${resolvedEmail}` });
  } catch (err) {
    console.error('❌ Error emailing indent:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- SHIPMENTS ---
function shipmentPopulate() {
  return [
    { path: 'salesContract', populate: [{ path: 'supplier', select: 'companyName' }, { path: 'productLines.product', select: 'name hsCode' }] },
    { path: 'indent', select: 'indentNumber indentDate sellingPricePerMt sellingPriceCurrency' },
    { path: 'lines.client', select: 'companyName' },
    { path: 'lines.product', select: 'name hsCode' },
  ];
}

async function nextShipmentNumber() {
  const year = new Date().getFullYear();
  const prefix = `SH-${year}-`;
  const last = await Shipment.findOne({ shipmentNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .sort({ shipmentNumber: -1 })
    .select('shipmentNumber')
    .lean();
  let seq = 1;
  if (last && last.shipmentNumber) {
    const m = String(last.shipmentNumber).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function parseShipmentLines(raw) {
  let lines = raw;
  if (typeof lines === 'string') {
    try { lines = JSON.parse(lines || '[]'); } catch { lines = []; }
  }
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => ({
    indent: l.indent || undefined,
    indentLineId: l.indentLineId || undefined,
    client: l.client || undefined,
    product: l.product || undefined,
    quantity: l.quantity != null ? Number(l.quantity) : undefined,
    quantityUnit: l.quantityUnit === 'KGS' ? 'KGS' : 'MT',
  })).filter((l) => l.product || l.client || l.quantity);
}

function resolveShipmentFile(files, field) {
  const list = Array.isArray(files) ? files : [];
  const f = list.find((x) => x.fieldname === field);
  return f ? f.filename : undefined;
}

function applyShipmentFields(target, body, contract, files, existing = null) {
  const shipmentDateRaw = body.shipmentDate !== undefined ? body.shipmentDate : (body.etd !== undefined ? body.etd : null);
  if (shipmentDateRaw !== null) {
    target.shipmentDate = shipmentDateRaw ? new Date(shipmentDateRaw) : undefined;
    target.etd = target.shipmentDate;
  } else if (!existing) {
    target.shipmentDate = undefined;
    target.etd = undefined;
  }

  if (body.status !== undefined || !existing) target.status = body.status || existing?.status || 'Draft';
  if (body.vesselName !== undefined || !existing) target.vesselName = String(body.vesselName || existing?.vesselName || '').trim();
  if (body.blNumber !== undefined || !existing) target.blNumber = String(body.blNumber || existing?.blNumber || '').trim();
  if (body.eta !== undefined) target.eta = body.eta ? new Date(body.eta) : undefined;
  if (body.shipmentType !== undefined || !existing) {
    target.shipmentType = body.shipmentType || contract?.shipmentType || existing?.shipmentType || '';
  }
  if (body.portOfLoading !== undefined || !existing) {
    target.portOfLoading = String(body.portOfLoading || existing?.portOfLoading || contract?.portOfShipment || '').trim();
  }
  if (body.portOfDischarge !== undefined || !existing) {
    target.portOfDischarge = String(body.portOfDischarge || existing?.portOfDischarge || contract?.portOfDischarge || '').trim();
  }
  if (body.shippedQuantity !== undefined || !existing) {
    if (body.shippedQuantity !== undefined && body.shippedQuantity !== '') {
      target.shippedQuantity = Number(body.shippedQuantity);
    } else if (!existing) {
      const lines = getContractLinesFromDoc(contract);
      target.shippedQuantity = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    }
  }
  if (body.shippedQuantityUnit !== undefined || !existing) {
    target.shippedQuantityUnit = body.shippedQuantityUnit
      || existing?.shippedQuantityUnit
      || getContractLinesFromDoc(contract)[0]?.quantityUnit
      || 'MT';
  }
  if (body.freeDays !== undefined) {
    target.freeDays = body.freeDays === '' || body.freeDays == null ? undefined : Number(body.freeDays);
  }
  if (body.notes !== undefined || !existing) target.notes = String(body.notes || existing?.notes || '').trim();
  if (body.lines !== undefined) target.lines = parseShipmentLines(body.lines);

  const bl = resolveShipmentFile(files, 'blFile');
  const shippingDocs = resolveShipmentFile(files, 'shippingDocsFile') || resolveShipmentFile(files, 'packingListFile');
  if (bl) target.blFile = bl;
  if (shippingDocs) {
    target.shippingDocsFile = shippingDocs;
    target.packingListFile = shippingDocs;
  }
  return target;
}

app.get('/api/shipments', requirePermission('quotes'), async (req, res) => {
  try {
    const items = await Shipment.find().populate(shipmentPopulate()).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shipments/:id', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Shipment.findById(req.params.id).populate(shipmentPopulate());
    if (!doc) return res.status(404).json({ error: 'Shipment not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shipments', requirePermission('quotes'), canEdit, salesContractUpload, async (req, res) => {
  try {
    const body = req.body || {};
    const indentId = body.indent || body.indentId;
    let salesContract = body.salesContract || body.salesContractId;
    let indentDoc = null;

    if (indentId) {
      indentDoc = await Indent.findById(indentId).populate(indentPopulateSpec());
      if (!indentDoc) return res.status(404).json({ error: 'Indent not found' });
      salesContract = indentDoc.salesContract?._id || indentDoc.salesContract;

      // One shipment per indent — do not create duplicates from Actions / save prompt.
      const existingForIndent = await Shipment.findOne({ indent: indentId })
        .select('_id shipmentNumber')
        .lean();
      if (existingForIndent) {
        return res.status(409).json({
          error: `A shipment already exists for this indent (${existingForIndent.shipmentNumber || existingForIndent._id}). Open that shipment instead of creating another.`,
          shipmentId: existingForIndent._id,
        });
      }
    }
    if (!salesContract) return res.status(400).json({ error: 'Indent is required' });
    const contract = await SalesContract.findById(salesContract);
    if (!contract) return res.status(404).json({ error: 'Sales contract not found' });

    const shipmentNumber = String(body.shipmentNumber || '').trim() || await nextShipmentNumber();
    const payload = applyShipmentFields({
      salesContract,
      indent: indentId || undefined,
      shipmentNumber,
    }, body, contract, req.files, null);

    const doc = await Shipment.create(payload);
    await logSessionEvent(req, 'CREATE_SHIPMENT', 'Shipment', doc._id, { shipmentNumber: doc.shipmentNumber, status: doc.status });
    const populated = await Shipment.findById(doc._id).populate(shipmentPopulate());
    res.status(201).json(populated);
  } catch (err) {
    console.error('❌ Create shipment error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/shipments/:id', requirePermission('quotes'), canEdit, salesContractUpload, async (req, res) => {
  try {
    const existing = await Shipment.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Shipment not found' });
    const body = req.body || {};
    const indentId = body.indent || body.indentId;
    if (indentId) {
      const indentDoc = await Indent.findById(indentId);
      if (!indentDoc) return res.status(404).json({ error: 'Indent not found' });
      existing.indent = indentId;
      existing.salesContract = indentDoc.salesContract;
    } else if (body.salesContract || body.salesContractId) {
      existing.salesContract = body.salesContract || body.salesContractId;
    }
    if (body.shipmentNumber !== undefined) existing.shipmentNumber = String(body.shipmentNumber).trim();

    const contract = await SalesContract.findById(existing.salesContract);
    applyShipmentFields(existing, body, contract, req.files, existing);
    await existing.save();
    await logSessionEvent(req, 'UPDATE_SHIPMENT', 'Shipment', existing._id, {
      shipmentNumber: existing.shipmentNumber,
      status: existing.status,
    });
    const populated = await Shipment.findById(existing._id).populate(shipmentPopulate());
    res.json(populated);
  } catch (err) {
    console.error('❌ Update shipment error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/shipments/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    const linked = await Invoice.countDocuments({ shipment: req.params.id });
    if (linked > 0) return res.status(400).json({ error: 'Cannot delete a shipment that has invoices. Delete invoices first.' });
    const deleted = await Shipment.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Shipment not found' });
    await logSessionEvent(req, 'DELETE_SHIPMENT', 'Shipment', deleted._id, { shipmentNumber: deleted.shipmentNumber });
    res.json({ message: 'Shipment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INVOICES & PAYMENTS ---
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ invoiceNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .sort({ invoiceNumber: -1 })
    .select('invoiceNumber')
    .lean();
  let seq = 1;
  if (last && last.invoiceNumber) {
    const m = String(last.invoiceNumber).match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function parseInvoiceLines(raw) {
  let lines = raw;
  if (typeof lines === 'string') {
    try { lines = JSON.parse(lines || '[]'); } catch { lines = []; }
  }
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => ({
    product: l.product || l.productId || undefined,
    description: String(l.description || '').trim(),
    quantity: Number(l.quantity),
    quantityUnit: l.quantityUnit === 'KGS' ? 'KGS' : 'MT',
    unitPrice: Number(l.unitPrice),
  })).filter((l) => l.quantity > 0 && l.unitPrice >= 0);
}

function invoiceLinesSubtotal(lines) {
  return (lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

async function enrichInvoice(doc) {
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
  const payments = await Payment.find({ invoice: obj._id }).sort({ paymentDate: -1 });
  const paidAmount = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const subtotal = invoiceLinesSubtotal(obj.lines);
  const balance = Math.max(0, subtotal - paidAmount);
  let status = obj.status;
  if (status !== 'Cancelled' && status !== 'Draft') {
    if (paidAmount <= 0) status = 'Sent';
    else if (balance <= 0.0001) status = 'Paid';
    else status = 'Partially paid';
  }
  return { ...obj, subtotal, paidAmount, balance, payments, status };
}

async function buildInvoicePrintHtml(invoice, options = {}) {
  const settings = await Settings.getGlobal();
  const client = invoice.client || {};
  const cur = invoice.currency || 'USD';
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(Number(n) || 0);
    } catch (_) {
      return `${cur} ${(Number(n) || 0).toFixed(2)}`;
    }
  };
  const subtotal = invoiceLinesSubtotal(invoice.lines);
  const paidAmount = (invoice.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, subtotal - paidAmount);

  const lineRows = (invoice.lines || []).map((line) => {
    const prod = line.product?.name || '—';
    const desc = line.description || '';
    const qty = line.quantity;
    const unit = line.quantityUnit || 'MT';
    const price = Number(line.unitPrice) || 0;
    const lineTotal = (Number(qty) || 0) * price;
    return `<tr>
      <td>${prod}${desc ? `<br><small>${desc}</small>` : ''}</td>
      <td>${qty} ${unit}</td>
      <td>${fmt(price)}</td>
      <td>${fmt(lineTotal)}</td>
    </tr>`;
  }).join('');

  const paymentRows = (invoice.payments || []).length
    ? (invoice.payments || []).map((p) => `<tr>
        <td>${p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '—'}</td>
        <td>${p.method || '—'}</td>
        <td>${p.reference || '—'}</td>
        <td>${fmt(p.amount)}</td>
      </tr>`).join('')
    : '';

  const contractNum = invoice.salesContract?.contractNumber || '';
  const shipmentNum = invoice.shipment?.shipmentNumber || '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${invoice.invoiceNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#222;max-width:900px;margin:0 auto}
      h1{color:#1a56db;font-size:1.5rem;margin-bottom:4px}
      .meta{margin:16px 0 24px;line-height:1.6}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td,th{border:1px solid #ddd;padding:10px;text-align:left}
      th{background:#f3f4f6}
      .totals{margin-top:16px;text-align:right;line-height:1.8}
      .footer{margin-top:40px;color:#666;font-size:0.9em;white-space:pre-line}
      @media print{body{padding:16px}}
    </style></head><body>
    <h1>${settings.companyName || 'Tri Brothers'}</h1>
    <p>${settings.companyAddress || ''}<br>${settings.companyPhone || ''} ${settings.companyEmail || ''}</p>
    <h2>Invoice</h2>
    <div class="meta">
      <strong>Invoice #:</strong> ${invoice.invoiceNumber}<br>
      <strong>Date:</strong> ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '—'}<br>
      ${invoice.dueDate ? `<strong>Due date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}<br>` : ''}
      <strong>Status:</strong> ${invoice.status || 'Draft'}<br>
      <strong>Bill to:</strong> ${client.companyName || '—'}<br>
      ${contractNum ? `<strong>Contract:</strong> ${contractNum}<br>` : ''}
      ${shipmentNum ? `<strong>Shipment:</strong> ${shipmentNum}<br>` : ''}
    </div>
    <table>
      <thead><tr><th>Product / Description</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <div class="totals">
      <strong>Subtotal:</strong> ${fmt(subtotal)}<br>
      ${paidAmount > 0 ? `<strong>Paid:</strong> ${fmt(paidAmount)}<br>` : ''}
      ${balance > 0 ? `<strong>Balance due:</strong> ${fmt(balance)}<br>` : ''}
    </div>
    ${paymentRows ? `<h3>Payments</h3><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>` : ''}
    ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
    <div class="footer">${settings.emailSignature || ''}</div>
    ${options.autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
    </body></html>`;
}

app.get('/api/invoices', requirePermission('quotes'), async (req, res) => {
  try {
    const items = await Invoice.find()
      .populate('client', 'companyName')
      .populate('salesContract', 'contractNumber')
      .populate('shipment', 'shipmentNumber blNumber')
      .populate('lines.product', 'name')
      .sort({ invoiceDate: -1, createdAt: -1 });
    const enriched = await Promise.all(items.map((i) => enrichInvoice(i)));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/print', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Invoice.findById(req.params.id)
      .populate('client', 'companyName contactPersons email')
      .populate('salesContract', 'contractNumber')
      .populate('shipment', 'shipmentNumber blNumber')
      .populate('lines.product', 'name hsCode');
    if (!doc) return res.status(404).json({ error: 'Invoice not found' });
    const enriched = await enrichInvoice(doc);
    const html = await buildInvoicePrintHtml(enriched, { autoPrint: true });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('❌ Error printing invoice:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Invoice.findById(req.params.id)
      .populate('client', 'companyName contactPersons email')
      .populate('salesContract', 'contractNumber')
      .populate('shipment', 'shipmentNumber blNumber')
      .populate('lines.product', 'name hsCode');
    if (!doc) return res.status(404).json({ error: 'Invoice not found' });
    res.json(await enrichInvoice(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const body = req.body || {};
    const client = body.client || body.clientId;
    if (!client) return res.status(400).json({ error: 'Client is required' });
    const lines = parseInvoiceLines(body.lines);
    if (!lines.length) return res.status(400).json({ error: 'At least one invoice line is required' });
    const invoiceNumber = String(body.invoiceNumber || '').trim() || await nextInvoiceNumber();
    const doc = await Invoice.create({
      invoiceNumber,
      client,
      salesContract: body.salesContract || body.salesContractId || undefined,
      shipment: body.shipment || body.shipmentId || undefined,
      indent: body.indent || body.indentId || undefined,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : new Date(),
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      currency: String(body.currency || 'USD').trim().toUpperCase(),
      status: body.status || 'Draft',
      lines,
      notes: String(body.notes || '').trim(),
    });
    await logSessionEvent(req, 'CREATE_INVOICE', 'Invoice', doc._id, { invoiceNumber: doc.invoiceNumber });
    const populated = await Invoice.findById(doc._id)
      .populate('client', 'companyName')
      .populate('salesContract', 'contractNumber')
      .populate('shipment', 'shipmentNumber')
      .populate('lines.product', 'name hsCode');
    res.status(201).json(await enrichInvoice(populated));
  } catch (err) {
    console.error('❌ Create invoice error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/invoices/:id', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const existing = await Invoice.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    const body = req.body || {};
    if (body.client || body.clientId) existing.client = body.client || body.clientId;
    if (body.invoiceNumber !== undefined) existing.invoiceNumber = String(body.invoiceNumber).trim();
    if (body.salesContract !== undefined || body.salesContractId !== undefined) {
      existing.salesContract = body.salesContract || body.salesContractId || undefined;
    }
    if (body.shipment !== undefined || body.shipmentId !== undefined) {
      existing.shipment = body.shipment || body.shipmentId || undefined;
    }
    if (body.indent !== undefined || body.indentId !== undefined) {
      existing.indent = body.indent || body.indentId || undefined;
    }
    if (body.invoiceDate !== undefined) existing.invoiceDate = new Date(body.invoiceDate);
    if (body.dueDate !== undefined) existing.dueDate = body.dueDate ? new Date(body.dueDate) : undefined;
    if (body.currency !== undefined) existing.currency = String(body.currency || 'USD').trim().toUpperCase();
    if (body.status !== undefined) existing.status = body.status;
    if (body.notes !== undefined) existing.notes = String(body.notes || '').trim();
    if (body.lines !== undefined) {
      const lines = parseInvoiceLines(body.lines);
      if (!lines.length) return res.status(400).json({ error: 'At least one invoice line is required' });
      existing.lines = lines;
    }
    await existing.save();
    await logSessionEvent(req, 'UPDATE_INVOICE', 'Invoice', existing._id, { invoiceNumber: existing.invoiceNumber });
    const populated = await Invoice.findById(existing._id)
      .populate('client', 'companyName')
      .populate('salesContract', 'contractNumber')
      .populate('shipment', 'shipmentNumber')
      .populate('lines.product', 'name hsCode');
    res.json(await enrichInvoice(populated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/invoices/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    await Payment.deleteMany({ invoice: req.params.id });
    const deleted = await Invoice.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Invoice not found' });
    await logSessionEvent(req, 'DELETE_INVOICE', 'Invoice', deleted._id, { invoiceNumber: deleted.invoiceNumber });
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices/:id/payments', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Payment amount must be greater than 0' });
    const payment = await Payment.create({
      invoice: invoice._id,
      amount,
      currency: String(body.currency || invoice.currency || 'USD').trim().toUpperCase(),
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      method: body.method || 'TT',
      reference: String(body.reference || '').trim(),
      notes: String(body.notes || '').trim(),
    });
    if (invoice.status === 'Draft') invoice.status = 'Sent';
    await invoice.save();
    await logSessionEvent(req, 'RECORD_PAYMENT', 'Payment', payment._id, {
      invoiceNumber: invoice.invoiceNumber,
      amount,
    });
    const enriched = await enrichInvoice(invoice);
    res.status(201).json({ payment, invoice: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/payments/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    const deleted = await Payment.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Payment not found' });
    res.json({ message: 'Payment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- COMMISSIONS ---
function commissionPopulate() {
  return [
    { path: 'salesContract', select: 'contractNumber' },
    { path: 'indent', select: 'indentNumber indentDate sellingPricePerMt sellingPriceCurrency' },
    { path: 'client', select: 'companyName' },
    { path: 'supplier', select: 'companyName' },
  ];
}

app.post('/api/commissions/sync', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const result = await syncAllCommissions();
    res.json({ message: 'Commissions synced', ...result });
  } catch (err) {
    console.error('❌ Sync commissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commissions/summary', requirePermission('quotes'), async (req, res) => {
  try {
    const items = await Commission.find({ status: { $ne: 'Cancelled' } });
    const enriched = await Promise.all(items.map((c) => enrichCommission(c)));
    const byCurrency = {};
    enriched.forEach((c) => {
      const cur = c.currency || 'USD';
      if (!byCurrency[cur]) {
        byCurrency[cur] = { currency: cur, total: 0, paid: 0, balance: 0, count: 0, unpaid: 0, partial: 0, paidCount: 0 };
      }
      byCurrency[cur].total += Number(c.amount) || 0;
      byCurrency[cur].paid += Number(c.paidAmount) || 0;
      byCurrency[cur].balance += Number(c.balance) || 0;
      byCurrency[cur].count += 1;
      if (c.status === 'Unpaid') byCurrency[cur].unpaid += 1;
      else if (c.status === 'Partially paid') byCurrency[cur].partial += 1;
      else if (c.status === 'Paid') byCurrency[cur].paidCount += 1;
    });
    res.json({ currencies: Object.values(byCurrency), totalRecords: enriched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commissions', requirePermission('quotes'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.type === 'client' || req.query.type === 'supplier') filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const items = await Commission.find(filter)
      .populate(commissionPopulate())
      .sort({ earnedDate: -1, createdAt: -1 });
    const enriched = await Promise.all(items.map((c) => enrichCommission(c)));
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q
      ? enriched.filter((c) => {
        const parts = [
          c.commissionNumber,
          c.partyLabel,
          c.description,
          c.salesContract?.contractNumber,
          c.indent?.indentNumber,
        ].filter(Boolean).join(' ').toLowerCase();
        return parts.includes(q);
      })
      : enriched;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/commissions/:id', requirePermission('quotes'), async (req, res) => {
  try {
    const doc = await Commission.findById(req.params.id).populate(commissionPopulate());
    if (!doc) return res.status(404).json({ error: 'Commission not found' });
    res.json(await enrichCommission(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/commissions/:id', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const existing = await Commission.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Commission not found' });
    const body = req.body || {};
    if (body.dueDate !== undefined) existing.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.notes !== undefined) existing.notes = String(body.notes || '').trim();
    if (body.status === 'Cancelled') existing.status = 'Cancelled';
    else if (body.status && body.status !== 'Cancelled') {
      const derived = await enrichCommission(existing);
      existing.status = derived.status;
    }
    await existing.save();
    const populated = await Commission.findById(existing._id).populate(commissionPopulate());
    res.json(await enrichCommission(populated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/commissions/:id/payments', requirePermission('quotes'), canEdit, async (req, res) => {
  try {
    const commission = await Commission.findById(req.params.id);
    if (!commission) return res.status(404).json({ error: 'Commission not found' });
    if (commission.status === 'Cancelled') return res.status(400).json({ error: 'Cannot pay a cancelled commission' });
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'Payment amount must be greater than 0' });
    const payment = await CommissionPayment.create({
      commission: commission._id,
      amount,
      currency: String(body.currency || commission.currency || 'USD').trim().toUpperCase(),
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      method: body.method || 'TT',
      reference: String(body.reference || '').trim(),
      notes: String(body.notes || '').trim(),
    });
    const enriched = await enrichCommission(commission);
    commission.status = enriched.status;
    await commission.save();
    await logSessionEvent(req, 'RECORD_COMMISSION_PAYMENT', 'CommissionPayment', payment._id, {
      commissionNumber: commission.commissionNumber,
      amount,
    });
    res.status(201).json({ payment, commission: await enrichCommission(commission) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/commission-payments/:id', requirePermission('quotes'), canDelete, async (req, res) => {
  try {
    const deleted = await CommissionPayment.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Payment not found' });
    const commission = await Commission.findById(deleted.commission);
    if (commission) {
      const enriched = await enrichCommission(commission);
      commission.status = enriched.status;
      await commission.save();
    }
    res.json({ message: 'Payment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- OFFERS ROUTES (create/use SupplierProduct, then save Offer and email supplier) ---

app.get('/api/offers', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const query = Offer.find()
      .populate('product', 'name hsCode')
      .populate('supplier', 'companyName contactPersons')
      .populate('supplierProduct')
      .sort({ createdAt: -1 });
    if (req.query.page || req.query.limit) {
      const [items, total] = await Promise.all([query.skip(skip).limit(limit), Offer.countDocuments()]);
      return res.json(paginatedResponse(items, total, page, limit));
    }
    res.json(await query);
  } catch (err) {
    console.error('❌ Error fetching offers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create offer: create or use SupplierProduct, then save Offer and email supplier
app.post('/api/offers', canEdit, async (req, res) => {
  try {
    const { productId, supplierId, supplierProductId, supplierPrice, currency, MOQ, leadTime, notes } = req.body;

    if (!productId || !supplierId) {
      return res.status(400).json({ error: 'Product and supplier are required' });
    }

    const product = await Product.findById(productId);
    const supplier = await Supplier.findById(supplierId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!supplier || !supplier.contactPersons || supplier.contactPersons.length === 0) {
      return res.status(404).json({ error: 'Supplier or supplier contacts not found' });
    }

    let spId = supplierProductId;
    if (!spId) {
      const spRes = await SupplierProduct.findOne({ productId, supplierId });
      if (spRes) {
        spId = spRes._id;
        if (supplierPrice !== undefined || notes !== undefined) {
          await SupplierProduct.findByIdAndUpdate(spId, {
            $set: {
              ...(supplierPrice !== undefined && { supplierPrice: Number(supplierPrice) }),
              ...(notes !== undefined && { notes }),
              lastUpdated: new Date(),
            },
          });
        }
      } else {
        const newSp = new SupplierProduct({
          productId,
          supplierId,
          supplierPrice: supplierPrice != null ? Number(supplierPrice) : null,
          currency: currency || 'USD',
          MOQ: MOQ || null,
          leadTime: leadTime || null,
          notes: notes || null,
        });
        await newSp.save();
        spId = newSp._id;
      }
    }

    const offer = new Offer({
      product: productId,
      supplier: supplierId,
      supplierProduct: spId,
      notes,
    });
    await offer.save();

    const contact = supplier.contactPersons.find(cp => cp.email && cp.email.trim());
    if (!contact) {
      return res.status(400).json({ error: 'No supplier contact with email found' });
    }

    const emailBody = `
      <h2>📄 Offer Request</h2>
      <p>Dear ${contact.name || supplier.companyName},</p>
      <p>We would like to request an offer for the following product:</p>
      <p><strong>Product:</strong> ${product.name}</p>
      <p><strong>HS Code:</strong> ${product.hsCode || 'N/A'}</p>
      ${notes ? `<p><strong>Additional Notes:</strong> ${notes}</p>` : ''}
      <hr/>
      <p>Best Regards,<br>TRI Brothers Dashboard</p>
    `;

    await sendMail({
      from: '"TRI Dashboard" <thehomepageco786@gmail.com>',
      to: contact.email,
      subject: `Offer Request for ${product.name}`,
      html: emailBody,
    });

    const populatedOffer = await Offer.findById(offer._id)
      .populate('product', 'name hsCode')
      .populate('supplier', 'companyName contactPersons')
      .populate('supplierProduct');

    res.status(201).json({ message: '✅ Offer request created and emailed successfully', offer: populatedOffer });
  } catch (err) {
    console.error('❌ Error creating offer:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update offer (including received price from supplier)
app.put('/api/offers/:id', canEdit, async (req, res) => {
  try {
    const { productId, supplierId, supplierProductId, notes, receivedPrice } = req.body;
    const updateData = {};
    if (productId) updateData.product = productId;
    if (supplierId) updateData.supplier = supplierId;
    if (supplierProductId !== undefined) updateData.supplierProduct = supplierProductId || null;
    if (notes !== undefined) updateData.notes = notes;
    if (receivedPrice !== undefined) updateData.receivedPrice = receivedPrice === '' || receivedPrice == null ? null : Number(receivedPrice);

    const updated = await Offer.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    )
      .populate('product', 'name hsCode')
      .populate('supplier', 'companyName contactPersons')
      .populate('supplierProduct');

    if (!updated) return res.status(404).json({ error: 'Offer not found' });
    res.json({ message: '✅ Offer updated successfully', offer: updated });
  } catch (err) {
    console.error('❌ Error updating offer:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete offer
app.delete('/api/offers/:id', canDelete, async (req, res) => {
  try {
    const deleted = await Offer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Offer not found' });
    res.json({ message: '✅ Offer deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting offer:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- DASHBOARD ---
app.get('/api/dashboard/stats', requirePermission('dashboard'), async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      productCount,
      clientCount,
      supplierCount,
      quotationCount,
      offerCount,
      contractCount,
      indentCount,
      shipmentCount,
      invoiceCount,
      recentQuotations,
      recentOffers,
      recentActivity,
      quotationSum,
      recentQuotationSum,
      contractsWithRemaining,
      pendingOffers,
      unpaidInvoices,
      shipmentsByStatus,
      recentShipments,
    ] = await Promise.all([
      Product.countDocuments(),
      Client.countDocuments(),
      Supplier.countDocuments(),
      Quotation.countDocuments(),
      Offer.countDocuments(),
      SalesContract.countDocuments(),
      Indent.countDocuments(),
      Shipment.countDocuments(),
      Invoice.countDocuments(),
      Quotation.find().sort({ createdAt: -1 }).limit(5).populate('product', 'name').populate('client', 'companyName'),
      Offer.find().sort({ createdAt: -1 }).limit(5).populate('product', 'name').populate('supplier', 'companyName'),
      SessionLog.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'username'),
      Quotation.aggregate([{ $group: { _id: null, total: { $sum: '$finalPrice' }, avgMargin: { $avg: '$margin' } } }]),
      Quotation.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$finalPrice' }, count: { $sum: 1 } } },
      ]),
      SalesContract.find().sort({ contractDate: -1 }).limit(20).populate('supplier', 'companyName').lean(),
      Offer.find({ $or: [{ receivedPrice: null }, { receivedPrice: { $exists: false } }, { receivedPrice: 0 }] })
        .sort({ createdAt: -1 }).limit(5).populate('product', 'name').populate('supplier', 'companyName').lean(),
      Invoice.find({ status: { $in: ['Sent', 'Partially paid', 'Draft'] } })
        .sort({ dueDate: 1 }).limit(8).populate('client', 'companyName').lean(),
      Shipment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Shipment.find().sort({ updatedAt: -1 }).limit(8)
        .populate('salesContract', 'contractNumber portOfShipment')
        .lean(),
    ]);

    const STATUS_ORDER = ['Draft', 'Booked', 'In transit', 'Arrived', 'Delivered'];
    const statusMap = Object.fromEntries((shipmentsByStatus || []).map((s) => [s._id || 'Draft', s.count]));
    const shipmentPipeline = STATUS_ORDER.map((status, index) => ({
      status,
      count: statusMap[status] || 0,
      progress: Math.round(((index + 1) / STATUS_ORDER.length) * 100),
    }));
    const recentShipmentCards = (recentShipments || []).map((s) => {
      const idx = Math.max(0, STATUS_ORDER.indexOf(s.status || 'Draft'));
      return {
        _id: s._id,
        shipmentNumber: s.shipmentNumber,
        status: s.status || 'Draft',
        blNumber: s.blNumber || '',
        shipmentDate: s.shipmentDate || s.etd || null,
        contractNumber: s.salesContract?.contractNumber || '',
        portOfLoading: s.portOfLoading || s.salesContract?.portOfShipment || '',
        progressPct: Math.round(((idx + 1) / STATUS_ORDER.length) * 100),
        stepIndex: idx,
        steps: STATUS_ORDER.length,
      };
    });
    const attention = [];
    for (const offer of pendingOffers || []) {
      attention.push({
        title: `Follow up offer — ${offer.product?.name || 'Product'}`,
        meta: offer.supplier?.companyName || 'Supplier',
        href: 'quotes.html',
      });
    }
    for (const inv of unpaidInvoices || []) {
      attention.push({
        title: `Invoice ${inv.invoiceNumber} awaiting payment`,
        meta: inv.client?.companyName || 'Client',
        href: 'invoices.html',
      });
    }
    for (const c of (contractsWithRemaining || []).slice(0, 5)) {
      attention.push({
        title: `Contract ${c.contractNumber}`,
        meta: `${c.supplier?.companyName || 'Supplier'} — create indent or shipment`,
        href: `indent.html?contract=${c._id}`,
      });
    }

    const totals = quotationSum[0] || { total: 0, avgMargin: 0 };
    const recent = recentQuotationSum[0] || { total: 0, count: 0 };
    res.json({
      counts: {
        products: productCount,
        clients: clientCount,
        suppliers: supplierCount,
        quotations: quotationCount,
        offers: offerCount,
        contracts: contractCount,
        indents: indentCount,
        shipments: shipmentCount,
        invoices: invoiceCount,
      },
      revenue: { totalQuoted: totals.total || 0, avgMargin: totals.avgMargin || 0, last7Days: recent.total || 0, last7DaysCount: recent.count || 0 },
      shipmentPipeline,
      recentShipments: recentShipmentCards,
      recentQuotations,
      recentOffers,
      recentActivity,
      attention: attention.slice(0, 8),
    });
  } catch (err) {
    console.error('❌ Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// --- SETTINGS ---
// --- EMAIL TEMPLATES & MAIL COMPOSE ---

app.get('/api/email-templates', async (req, res) => {
  try {
    await ensureEmailTemplates();
    const templates = await EmailTemplate.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    const enriched = templates.map((t) => ({
      ...t,
      requiredFields: detectRequiredFields(t),
      fieldDefs: FIELD_DEFS,
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/email-templates/all', requireAdmin, async (req, res) => {
  try {
    await ensureEmailTemplates();
    const templates = await EmailTemplate.find().sort({ sortOrder: 1 }).lean();
    res.json(templates.map((t) => ({ ...t, requiredFields: detectRequiredFields(t) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/email-templates/:id', requireAdmin, async (req, res) => {
  try {
    const tpl = await EmailTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    ['name', 'description', 'subject', 'bodyHtml', 'recipientTypes', 'sortOrder', 'isActive'].forEach((k) => {
      if (req.body[k] !== undefined) tpl[k] = req.body[k];
    });
    await tpl.save();
    res.json({ message: 'Template updated', template: tpl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveMailSendPayload(body) {
  const {
    templateId,
    templateSlug,
    recipientType,
    recipientId,
    toEmail,
    productId,
    productIds,
    fields = {},
  } = body;

  if (!recipientType || !['supplier', 'client'].includes(recipientType)) {
    return { error: 'recipientType must be supplier or client', status: 400 };
  }
  if (!recipientId || !mongoose.Types.ObjectId.isValid(String(recipientId))) {
    return { error: 'A valid recipient is required', status: 400 };
  }

  let template = null;
  if (templateId) {
    if (!mongoose.Types.ObjectId.isValid(String(templateId))) {
      return { error: 'Invalid template id', status: 400 };
    }
    template = await EmailTemplate.findById(templateId);
  } else {
    template = await EmailTemplate.findOne({ slug: templateSlug || 'general-message' });
  }
  if (!template || !template.isActive) {
    return { error: 'Email template not found', status: 404 };
  }

  let recipient = null;
  if (recipientType === 'supplier') {
    recipient = await Supplier.findById(recipientId);
  } else if (recipientType === 'client') {
    recipient = await Client.findById(recipientId);
  }
  if (!recipient) return { error: 'Recipient not found', status: 404 };

  const rawIds = Array.isArray(productIds) && productIds.length
    ? productIds
    : (productId ? [productId] : []);
  const ids = rawIds
    .map((id) => String(id).trim())
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
  let products = [];
  if (ids.length) {
    products = await Product.find({ _id: { $in: ids } });
    if (!products.length) return { error: 'Product not found', status: 404 };
    const order = new Map(ids.map((id, i) => [id, i]));
    products.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  }

  const settings = await Settings.getGlobal();
  const { subject, html } = renderEmail(template, {
    template,
    settings,
    recipient: recipient.toObject ? recipient.toObject() : recipient,
    product: products[0] || null,
    products: products.map((p) => (p.toObject ? p.toObject() : p)),
    fields,
    recipientType,
  });

  let resolvedEmail = (toEmail || '').trim();
  if (!resolvedEmail) {
    const cps = normalizeContactPersons(recipient.contactPersons);
    resolvedEmail = cps.map((c) => (c.email || '').trim()).find(Boolean) || '';
    if (!resolvedEmail && recipient.email) resolvedEmail = String(recipient.email).trim();
  }
  if (!resolvedEmail) return { error: 'No email address for this recipient', status: 400 };

  return {
    template,
    recipient,
    product: products[0] || null,
    products,
    settings,
    subject,
    html,
    resolvedEmail,
    recipientType,
    recipientId,
    productId: products[0] ? products[0]._id : null,
    productIds: products.map((p) => p._id),
  };
}

app.post('/api/mail/preview', async (req, res) => {
  try {
    const result = await resolveMailSendPayload(req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    return res.type('application/json').json({ subject: result.subject, html: result.html });
  } catch (err) {
    console.error('❌ Mail preview error:', err);
    return res.status(500).json({ error: err.message || 'Preview failed' });
  }
});

app.post('/api/mail/send-batch', canEmail, async (req, res) => {
  try {
    const { templateId, templateSlug, sends } = req.body || {};
    if (!Array.isArray(sends) || !sends.length) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }

    const results = [];
    const errors = [];

    for (const item of sends) {
      const payload = {
        templateId,
        templateSlug,
        recipientType: item.recipientType,
        recipientId: item.recipientId,
        toEmail: item.toEmail,
        productId: item.productId,
        productIds: item.productIds,
        fields: item.fields || {},
      };
      const result = await resolveMailSendPayload(payload);
      if (result.error) {
        errors.push(result.error);
        continue;
      }
      try {
        await sendMail({ to: result.resolvedEmail, subject: result.subject, html: result.html });
        await logSessionEvent(req, 'SEND_MAIL', 'EmailTemplate', result.template._id, {
          template: result.template.slug,
          recipientType: result.recipientType,
          recipientId: result.recipientId,
          productId: result.productId,
          toEmail: result.resolvedEmail,
        });
        results.push(result.resolvedEmail);
      } catch (e) {
        errors.push(e.message);
      }
    }

    if (!results.length) {
      return res.status(400).json({ error: errors.join('. ') || 'No emails sent' });
    }

    const msg = results.length === 1
      ? `Email sent to ${results[0]}`
      : `Sent ${results.length} email(s)`;
    res.json({ message: msg, sent: results.length, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error('❌ Mail batch send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mail/context', async (req, res) => {
  try {
    const { productId, recipientType, recipientId } = req.query;
    const settings = await Settings.getGlobal();
    const out = { settings: {
      defaultCurrency: settings.defaultCurrency,
      defaultImportDuty: settings.defaultImportDuty,
      defaultIncomeTax: settings.defaultIncomeTax,
      defaultSalesTax: settings.defaultSalesTax,
    }, product: null, recipients: [] };

    if (productId) {
      const product = await Product.findById(productId).lean();
      if (!product) return res.status(404).json({ error: 'Product not found' });
      out.product = product;

      if (recipientType === 'supplier' || !recipientType) {
        const links = await SupplierProduct.find({ productId }).populate('supplierId').lean();
        links.forEach((l) => {
          const sup = l.supplierId;
          if (!sup) return;
          out.recipients.push({
            recipientType: 'supplier',
            recipientId: sup._id,
            companyName: sup.companyName,
            contactPersons: sup.contactPersons || [],
            email: sup.email,
          });
        });
      }
      if (recipientType === 'client' || !recipientType) {
        const links = await ProductClient.find({ productId }).populate('clientId').lean();
        links.forEach((l) => {
          const cl = l.clientId;
          if (!cl) return;
          out.recipients.push({
            recipientType: 'client',
            recipientId: cl._id,
            companyName: cl.companyName,
            contactPersons: cl.contactPersons || [],
            email: cl.email,
          });
        });
      }
    } else if (recipientId && recipientType === 'supplier') {
      const sup = await Supplier.findById(recipientId).lean();
      if (sup) {
        out.recipients.push({
          recipientType: 'supplier',
          recipientId: sup._id,
          companyName: sup.companyName,
          contactPersons: sup.contactPersons || [],
          email: sup.email,
        });
        const links = await SupplierProduct.find({ supplierId: recipientId }).populate('productId').lean();
        out.linkedProducts = links.map((l) => l.productId).filter(Boolean);
      }
    } else if (recipientId && recipientType === 'client') {
      const cl = await Client.findById(recipientId).lean();
      if (cl) {
        out.recipients.push({
          recipientType: 'client',
          recipientId: cl._id,
          companyName: cl.companyName,
          contactPersons: cl.contactPersons || [],
          email: cl.email,
        });
        const links = await ProductClient.find({ clientId: recipientId }).populate('productId').lean();
        out.linkedProducts = links.map((l) => l.productId).filter(Boolean);
      }
    }

    res.json(out);
  } catch (err) {
    console.error('❌ Mail context error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Legacy single send — kept for backward compatibility
app.post('/api/mail/send', canEmail, async (req, res) => {
  try {
    const result = await resolveMailSendPayload(req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    await sendMail({ to: result.resolvedEmail, subject: result.subject, html: result.html });
    await logSessionEvent(req, 'SEND_MAIL', 'EmailTemplate', result.template._id, {
      template: result.template.slug,
      recipientType: result.recipientType,
      recipientId: result.recipientId,
      productId: result.productId,
      toEmail: result.resolvedEmail,
    });
    res.json({ message: `Email sent to ${result.resolvedEmail}` });
  } catch (err) {
    console.error('❌ Mail send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    res.json(sanitizeSettingsForResponse(settings));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await Settings.getGlobal();
    const allowed = [
      'companyName', 'companyAddress', 'companyPhone', 'companyEmail', 'defaultCurrency', 'usdToPkrRate',
      'defaultMargin', 'defaultImportDuty', 'defaultIncomeTax', 'defaultSalesTax',
      'mailService', 'mailHost', 'mailPort', 'mailUser', 'mailPass', 'mailFrom', 'emailSignature',
    ];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'mailPass' && req.body[key] === '********') return;
        settings[key] = req.body[key];
      }
    });
    await settings.save();
    resetTransporterCache();
    res.json({ message: 'Settings saved', settings: sanitizeSettingsForResponse(settings) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GLOBAL SEARCH ---
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ products: [], clients: [], suppliers: [], contracts: [], indents: [], shipments: [], invoices: [] });
    }
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [products, clients, suppliers, contracts, indents, shipments, invoices] = await Promise.all([
      Product.find({ $or: [{ name: regex }, { category: regex }, { hsCode: regex }] }).limit(10).select('name category hsCode'),
      Client.find({ $or: [{ companyName: regex }, { city: regex }, { country: regex }] }).limit(10).select('companyName city country'),
      Supplier.find({ $or: [{ companyName: regex }, { city: regex }, { country: regex }] }).limit(10).select('companyName city country'),
      SalesContract.find({ contractNumber: regex }).limit(8).select('contractNumber'),
      Indent.find({ indentNumber: regex }).limit(8).select('indentNumber'),
      Shipment.find({ $or: [{ shipmentNumber: regex }, { blNumber: regex }] }).limit(8).select('shipmentNumber blNumber'),
      Invoice.find({ invoiceNumber: regex }).limit(8).select('invoiceNumber'),
    ]);
    res.json({ products, clients, suppliers, contracts, indents, shipments, invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CSV EXPORT ---
app.get('/api/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    let rows = [];
    let filename = 'export.csv';
    if (type === 'clients') {
      const items = await Client.find().sort({ companyName: 1 });
      rows = [['Company', 'City', 'Country', 'Email', 'Tel', 'Mobile']];
      items.forEach((c) => {
        const emails = (c.contactPersons || []).map((p) => p.email).filter(Boolean).join('; ');
        rows.push([c.companyName, c.city, c.country, c.email || emails, c.tel, c.mobile]);
      });
      filename = 'clients.csv';
    } else if (type === 'suppliers') {
      const items = await Supplier.find().sort({ companyName: 1 });
      rows = [['Company', 'City', 'Country', 'Contacts', 'Emails']];
      items.forEach((s) => {
        const names = (s.contactPersons || []).map((p) => p.name).filter(Boolean).join('; ');
        const emails = (s.contactPersons || []).map((p) => p.email).filter(Boolean).join('; ');
        rows.push([s.companyName, s.city, s.country, names, emails]);
      });
      filename = 'suppliers.csv';
    } else if (type === 'products') {
      const items = await Product.find().sort({ name: 1 });
      rows = [['Name', 'Category', 'HS Code', 'Import Duty', 'Income Tax', 'Sales Tax']];
      items.forEach((p) => rows.push([p.name, p.category, p.hsCode, p.importDuty, p.incomeTax, p.salesTax]));
      filename = 'products.csv';
    } else if (type === 'quotations') {
      const items = await Quotation.find().sort({ createdAt: -1 }).populate('product', 'name').populate('client', 'companyName');
      rows = [['Product', 'Client', 'Final Price', 'Margin', 'HS Code', 'Created']];
      items.forEach((q) => rows.push([
        q.product?.name, q.client?.companyName, q.finalPrice, q.margin, q.hsCode,
        q.createdAt ? new Date(q.createdAt).toISOString() : '',
      ]));
      filename = 'quotations.csv';
    } else if (type === 'contracts') {
      const items = await SalesContract.find().sort({ contractDate: -1 }).populate('supplier', 'companyName');
      rows = [['Contract #', 'Supplier', 'Origin', 'Shipment', 'Payment', 'Date']];
      items.forEach((c) => rows.push([
        c.contractNumber, c.supplier?.companyName, c.originCountry, c.shipmentType, c.paymentTerms,
        c.contractDate ? new Date(c.contractDate).toISOString().slice(0, 10) : '',
      ]));
      filename = 'contracts.csv';
    } else if (type === 'indents') {
      const items = await Indent.find().sort({ indentDate: -1 }).populate('salesContract', 'contractNumber');
      rows = [['Indent #', 'Contract #', 'Date', 'Lines']];
      items.forEach((i) => rows.push([
        i.indentNumber, i.salesContract?.contractNumber, i.indentDate ? new Date(i.indentDate).toISOString().slice(0, 10) : '',
        (i.lines || []).length,
      ]));
      filename = 'indents.csv';
    } else if (type === 'shipments') {
      const items = await Shipment.find().sort({ createdAt: -1 }).populate('salesContract', 'contractNumber');
      rows = [['Shipment #', 'Contract #', 'Status', 'Vessel', 'BL', 'ETD', 'ETA']];
      items.forEach((s) => rows.push([
        s.shipmentNumber, s.salesContract?.contractNumber, s.status, s.vesselName, s.blNumber,
        s.etd ? new Date(s.etd).toISOString().slice(0, 10) : '',
        s.eta ? new Date(s.eta).toISOString().slice(0, 10) : '',
      ]));
      filename = 'shipments.csv';
    } else if (type === 'invoices') {
      const items = await Invoice.find().sort({ invoiceDate: -1 }).populate('client', 'companyName');
      rows = [['Invoice #', 'Client', 'Date', 'Status', 'Currency']];
      items.forEach((i) => rows.push([
        i.invoiceNumber, i.client?.companyName,
        i.invoiceDate ? new Date(i.invoiceDate).toISOString().slice(0, 10) : '',
        i.status, i.currency,
      ]));
      filename = 'invoices.csv';
    } else {
      return res.status(400).json({ error: 'Invalid export type' });
    }
    const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- QUOTATION PDF (printable HTML) ---
app.get('/api/quotations/:id/pdf', async (req, res) => {
  try {
    const q = await Quotation.findById(req.params.id)
      .populate('product', 'name category specs hsCode')
      .populate('client', 'companyName address city country contactPersons email tel');
    if (!q) return res.status(404).json({ error: 'Quotation not found' });
    const settings = await Settings.getGlobal();
    const clientName = q.client?.companyName || 'Client';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation - ${clientName}</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#222}h1{color:#1a56db}
      table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border:1px solid #ddd;padding:10px;text-align:left}
      th{background:#f3f4f6}.footer{margin-top:40px;color:#666;font-size:0.9em;white-space:pre-line}</style></head><body>
      <h1>${settings.companyName || 'Tri Brothers'}</h1>
      <p>${settings.companyAddress || ''}<br>${settings.companyPhone || ''} ${settings.companyEmail || ''}</p>
      <h2>Quotation</h2>
      <p><strong>Client:</strong> ${clientName}<br><strong>Date:</strong> ${new Date(q.createdAt).toLocaleDateString()}</p>
      <table><thead><tr><th>Product</th><th>HS Code</th><th>Final Price</th><th>Margin</th><th>Notes</th></tr></thead>
      <tbody><tr><td>${q.product?.name || ''}</td><td>${q.hsCode || q.product?.hsCode || ''}</td>
      <td>${settings.defaultCurrency || 'USD'} ${q.finalPrice}</td><td>${q.margin != null ? q.margin + '%' : '—'}</td><td>${q.notes || ''}</td></tr></tbody></table>
      <div class="footer">${settings.emailSignature || ''}</div>
      <script>window.onload=function(){window.print()}</script></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- REPORTS ---
function reportRangeFromQuery(req) {
  return parseReportRange(req.query);
}

async function loadReportCurrencySettings() {
  const settings = await Settings.getGlobal();
  return {
    defaultCurrency: settings.defaultCurrency || 'USD',
    usdToPkrRate: Number(settings.usdToPkrRate) > 0 ? Number(settings.usdToPkrRate) : 278,
  };
}

function sumIndentsCommissionUsd(indents, usdToPkrRate) {
  return (indents || []).reduce(
    (sum, ind) => sum + amountInUsd(indentCommissionTotal(ind), ind.commissionCurrency, usdToPkrRate),
    0
  );
}

function sumContractsValueUsd(contracts, usdToPkrRate) {
  return (contracts || []).reduce(
    (sum, c) => sum + amountInUsd(contractTotalValue(c), c.priceCurrency, usdToPkrRate),
    0
  );
}

function sumInvoicesUsd(invoices, usdToPkrRate) {
  return (invoices || []).reduce(
    (sum, inv) => sum + amountInUsd(invoiceSubtotal(inv), inv.currency, usdToPkrRate),
    0
  );
}

function sumPaymentsUsd(payments, usdToPkrRate) {
  return (payments || []).reduce(
    (sum, p) => sum + amountInUsd(p.amount, p.currency, usdToPkrRate),
    0
  );
}

app.get('/api/reports/summary', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const quoteMatch = dateMatchFilter(range.start, range.end);
    const contractMatch = dateFieldMatchFilter('contractDate', range.start, range.end);
    const indentMatch = dateFieldMatchFilter('indentDate', range.start, range.end);
    const invoiceMatch = dateFieldMatchFilter('invoiceDate', range.start, range.end);
    const paymentMatch = dateFieldMatchFilter('paymentDate', range.start, range.end);
    const shipmentMatch = dateMatchFilter(range.start, range.end);

    const periodMs = range.end - range.start;
    const prevEnd = new Date(range.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    const prevQuoteMatch = dateMatchFilter(prevStart, prevEnd);
    const prevContractMatch = dateFieldMatchFilter('contractDate', prevStart, prevEnd);
    const prevIndentMatch = dateFieldMatchFilter('indentDate', prevStart, prevEnd);
    const prevInvoiceMatch = dateFieldMatchFilter('invoiceDate', prevStart, prevEnd);
    const prevPaymentMatch = dateFieldMatchFilter('paymentDate', prevStart, prevEnd);

    const currencySettings = await loadReportCurrencySettings();
    const { usdToPkrRate } = currencySettings;

    const [
      quotationStats,
      prevQuotationStats,
      offerCount,
      prevOfferCount,
      productCount,
      clientCount,
      supplierCount,
      topClients,
      topProducts,
      contracts,
      prevContracts,
      indents,
      prevIndents,
      invoices,
      prevInvoices,
      payments,
      prevPayments,
      shipmentCount,
      prevShipmentCount,
      contractCount,
      prevContractCount,
      indentCount,
      prevIndentCount,
      invoiceCount,
      prevInvoiceCount,
    ] = await Promise.all([
      Quotation.aggregate([
        { $match: quoteMatch },
        { $group: { _id: null, count: { $sum: 1 }, totalQuoted: { $sum: '$finalPrice' }, avgMargin: { $avg: '$margin' }, avgPrice: { $avg: '$finalPrice' } } },
      ]),
      Quotation.aggregate([
        { $match: prevQuoteMatch },
        { $group: { _id: null, count: { $sum: 1 }, totalQuoted: { $sum: '$finalPrice' } } },
      ]),
      Offer.countDocuments(quoteMatch),
      Offer.countDocuments(prevQuoteMatch),
      Product.countDocuments(),
      Client.countDocuments(),
      Supplier.countDocuments(),
      Quotation.aggregate([
        { $match: quoteMatch },
        { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientDoc' } },
        { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$client', clientName: { $first: '$clientDoc.companyName' }, count: { $sum: 1 }, totalQuoted: { $sum: '$finalPrice' } } },
        { $sort: { totalQuoted: -1 } },
        { $limit: 8 },
      ]),
      Quotation.aggregate([
        { $match: quoteMatch },
        { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$product', productName: { $first: '$productDoc.name' }, count: { $sum: 1 }, totalQuoted: { $sum: '$finalPrice' } } },
        { $sort: { totalQuoted: -1 } },
        { $limit: 8 },
      ]),
      SalesContract.find(contractMatch).lean(),
      SalesContract.find(prevContractMatch).lean(),
      Indent.find(indentMatch).lean(),
      Indent.find(prevIndentMatch).lean(),
      Invoice.find(invoiceMatch).lean(),
      Invoice.find(prevInvoiceMatch).lean(),
      Payment.find(paymentMatch).lean(),
      Payment.find(prevPaymentMatch).lean(),
      Shipment.countDocuments(shipmentMatch),
      Shipment.countDocuments(dateMatchFilter(prevStart, prevEnd)),
      SalesContract.countDocuments(contractMatch),
      SalesContract.countDocuments(prevContractMatch),
      Indent.countDocuments(indentMatch),
      Indent.countDocuments(prevIndentMatch),
      Invoice.countDocuments(invoiceMatch),
      Invoice.countDocuments(prevInvoiceMatch),
    ]);

    const cur = quotationStats[0] || { count: 0, totalQuoted: 0, avgMargin: 0, avgPrice: 0 };
    const prev = prevQuotationStats[0] || { count: 0, totalQuoted: 0 };

    const contractValue = sumContractsValueUsd(contracts, usdToPkrRate);
    const prevContractValue = sumContractsValueUsd(prevContracts, usdToPkrRate);
    const commissionTotal = sumIndentsCommissionUsd(indents, usdToPkrRate);
    const prevCommissionTotal = sumIndentsCommissionUsd(prevIndents, usdToPkrRate);
    const invoicedTotal = sumInvoicesUsd(invoices, usdToPkrRate);
    const prevInvoicedTotal = sumInvoicesUsd(prevInvoices, usdToPkrRate);
    const paymentsTotal = sumPaymentsUsd(payments, usdToPkrRate);
    const prevPaymentsTotal = sumPaymentsUsd(prevPayments, usdToPkrRate);
    const indentQtyMt = indents.reduce((s, i) => s + indentQtyInMt(i), 0);
    const businessRevenue = invoicedTotal + commissionTotal;

    res.json({
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        mode: range.mode,
        label: range.label,
      },
      currency: currencySettings,
      stats: {
        quotations: cur.count,
        offers: offerCount,
        totalQuoted: cur.totalQuoted || 0,
        avgMargin: cur.avgMargin || 0,
        avgPrice: cur.avgPrice || 0,
        products: productCount,
        clients: clientCount,
        suppliers: supplierCount,
        prevQuotations: prev.count,
        prevTotalQuoted: prev.totalQuoted || 0,
        prevOffers: prevOfferCount,
        contracts: contractCount,
        contractValue,
        prevContracts: prevContractCount,
        prevContractValue,
        indents: indentCount,
        indentQtyMt,
        commissionTotal,
        prevIndents: prevIndentCount,
        prevCommissionTotal,
        shipments: shipmentCount,
        prevShipments: prevShipmentCount,
        invoices: invoiceCount,
        invoicedTotal,
        prevInvoices: prevInvoiceCount,
        prevInvoicedTotal,
        paymentsTotal,
        prevPaymentsTotal,
        businessRevenue,
        prevBusinessRevenue: prevInvoicedTotal + prevCommissionTotal,
      },
      topClients,
      topProducts,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reports/timeline', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const quoteMatch = dateMatchFilter(range.start, range.end);
    const granularity = pickTimelineGranularity(range);
    const buckets = buildTimelineBuckets(range, granularity);
    const currencySettings = await loadReportCurrencySettings();
    const { usdToPkrRate } = currencySettings;

    const emptyBucket = () => ({
      quotations: 0,
      offers: 0,
      quoteRevenue: 0,
      contracts: 0,
      contractValue: 0,
      indents: 0,
      commission: 0,
      invoices: 0,
      invoiceRevenue: 0,
      payments: 0,
      revenue: 0,
      marginSum: 0,
    });

    const seriesMap = Object.fromEntries(buckets.map((b) => [b.key, emptyBucket()]));

    const [quotations, offers, contracts, indents, invoices, payments] = await Promise.all([
      Quotation.find(quoteMatch).select('finalPrice margin createdAt').lean(),
      Offer.find(quoteMatch).select('createdAt').lean(),
      SalesContract.find(dateFieldMatchFilter('contractDate', range.start, range.end)).lean(),
      Indent.find(dateFieldMatchFilter('indentDate', range.start, range.end)).lean(),
      Invoice.find(dateFieldMatchFilter('invoiceDate', range.start, range.end)).lean(),
      Payment.find(dateFieldMatchFilter('paymentDate', range.start, range.end)).lean(),
    ]);

    quotations.forEach((q) => {
      const key = timelineBucketKey(q.createdAt, granularity);
      if (!seriesMap[key]) return;
      seriesMap[key].quotations += 1;
      seriesMap[key].quoteRevenue += q.finalPrice || 0;
      if (q.margin != null) seriesMap[key].marginSum += q.margin;
    });

    offers.forEach((o) => {
      const key = timelineBucketKey(o.createdAt, granularity);
      if (seriesMap[key]) seriesMap[key].offers += 1;
    });

    contracts.forEach((c) => {
      const key = timelineBucketKey(c.contractDate, granularity);
      if (!seriesMap[key]) return;
      seriesMap[key].contracts += 1;
      seriesMap[key].contractValue += amountInUsd(contractTotalValue(c), c.priceCurrency, usdToPkrRate);
    });

    indents.forEach((ind) => {
      const key = timelineBucketKey(ind.indentDate, granularity);
      if (!seriesMap[key]) return;
      seriesMap[key].indents += 1;
      seriesMap[key].commission += amountInUsd(
        indentCommissionTotal(ind),
        ind.commissionCurrency,
        usdToPkrRate
      );
    });

    invoices.forEach((inv) => {
      const key = timelineBucketKey(inv.invoiceDate, granularity);
      if (!seriesMap[key]) return;
      seriesMap[key].invoices += 1;
      seriesMap[key].invoiceRevenue += amountInUsd(invoiceSubtotal(inv), inv.currency, usdToPkrRate);
    });

    payments.forEach((p) => {
      const key = timelineBucketKey(p.paymentDate, granularity);
      if (seriesMap[key]) seriesMap[key].payments += amountInUsd(p.amount, p.currency, usdToPkrRate);
    });

    res.json({
      range: { label: range.label, mode: range.mode, granularity },
      currency: currencySettings,
      series: buckets.map((b) => {
        const row = seriesMap[b.key] || emptyBucket();
        const revenue = row.invoiceRevenue + row.commission;
        return {
          key: b.key,
          label: b.label,
          quotations: row.quotations,
          offers: row.offers,
          quoteRevenue: row.quoteRevenue,
          revenue,
          invoiceRevenue: row.invoiceRevenue,
          commission: row.commission,
          contractValue: row.contractValue,
          contracts: row.contracts,
          indents: row.indents,
          invoices: row.invoices,
          payments: row.payments,
          avgMargin: row.quotations ? row.marginSum / row.quotations : 0,
        };
      }),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reports/margins', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const match = dateMatchFilter(range.start, range.end);
    const data = await Quotation.aggregate([
      { $match: match },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: '$product',
        productName: { $first: '$productDoc.name' },
        count: { $sum: 1 },
        avgMargin: { $avg: '$margin' },
        totalRevenue: { $sum: '$finalPrice' },
        avgPrice: { $avg: '$finalPrice' },
      }},
      { $sort: { totalRevenue: -1 } },
    ]);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reports/quotations-by-client', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const match = dateMatchFilter(range.start, range.end);
    const data = await Quotation.aggregate([
      { $match: match },
      { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientDoc' } },
      { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: '$client',
        clientName: { $first: '$clientDoc.companyName' },
        count: { $sum: 1 },
        totalQuoted: { $sum: '$finalPrice' },
        avgMargin: { $avg: '$margin' },
      }},
      { $sort: { totalQuoted: -1 } },
    ]);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reports/supplier-prices', requirePermission('quotes'), async (req, res) => {
  try {
    const links = await SupplierProduct.find()
      .populate('productId', 'name category')
      .populate('supplierId', 'companyName')
      .sort({ productId: 1, supplierPrice: 1 });
    const byProduct = {};
    links.forEach((l) => {
      const pid = String(l.productId?._id || l.productId);
      if (!byProduct[pid]) {
        byProduct[pid] = { productName: l.productId?.name || '', category: l.productId?.category || '', suppliers: [] };
      }
      byProduct[pid].suppliers.push({
        supplierName: l.supplierId?.companyName || '',
        price: l.supplierPrice,
        currency: l.currency || 'USD',
        moq: l.MOQ,
        leadTime: l.leadTime,
      });
    });
    res.json(Object.values(byProduct));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/operations', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const currencySettings = await loadReportCurrencySettings();
    const { usdToPkrRate } = currencySettings;

    const [indents, contracts, invoices, payments, shipments] = await Promise.all([
      Indent.find(dateFieldMatchFilter('indentDate', range.start, range.end))
        .populate({ path: 'salesContract', select: 'contractNumber priceCurrency supplier', populate: { path: 'supplier', select: 'companyName' } })
        .populate('lines.client', 'companyName')
        .populate('lines.product', 'name')
        .sort({ indentDate: -1 })
        .lean(),
      SalesContract.find(dateFieldMatchFilter('contractDate', range.start, range.end))
        .populate('supplier', 'companyName')
        .populate('productLines.product', 'name')
        .sort({ contractDate: -1 })
        .lean(),
      Invoice.find(dateFieldMatchFilter('invoiceDate', range.start, range.end))
        .populate('client', 'companyName')
        .sort({ invoiceDate: -1 })
        .lean(),
      Payment.find(dateFieldMatchFilter('paymentDate', range.start, range.end))
        .populate({ path: 'invoice', select: 'invoiceNumber client', populate: { path: 'client', select: 'companyName' } })
        .sort({ paymentDate: -1 })
        .lean(),
      Shipment.find(dateMatchFilter(range.start, range.end))
        .populate('salesContract', 'contractNumber')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const indentRows = indents.map((ind) => ({
      _id: ind._id,
      indentNumber: ind.indentNumber,
      indentDate: ind.indentDate,
      contractNumber: ind.salesContract?.contractNumber || '',
      supplierName: ind.salesContract?.supplier?.companyName || '',
      qtyMt: indentQtyInMt(ind),
      commissionPerMt: ind.commissionPerMt || 0,
      commissionCurrency: ind.commissionCurrency || 'USD',
      commissionTotal: indentCommissionTotal(ind),
      commissionUsd: amountInUsd(indentCommissionTotal(ind), ind.commissionCurrency, usdToPkrRate),
      clients: (ind.lines || []).map((l) => l.client?.companyName).filter(Boolean).join(', '),
    }));

    const contractRows = contracts.map((c) => ({
      contractNumber: c.contractNumber,
      contractDate: c.contractDate,
      supplierName: c.supplier?.companyName || '',
      value: contractTotalValue(c),
      valueUsd: amountInUsd(contractTotalValue(c), c.priceCurrency, usdToPkrRate),
      currency: c.priceCurrency || 'USD',
    }));

    const invoiceRows = invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      clientName: inv.client?.companyName || '',
      status: inv.status,
      subtotal: invoiceSubtotal(inv),
      subtotalUsd: amountInUsd(invoiceSubtotal(inv), inv.currency, usdToPkrRate),
      currency: inv.currency || 'USD',
    }));

    const paymentRows = payments.map((p) => ({
      paymentDate: p.paymentDate,
      invoiceNumber: p.invoice?.invoiceNumber || '',
      clientName: p.invoice?.client?.companyName || '',
      amount: p.amount,
      amountUsd: amountInUsd(p.amount, p.currency, usdToPkrRate),
      currency: p.currency || 'USD',
      method: p.method,
    }));

    res.json({
      range: { label: range.label, mode: range.mode },
      currency: currencySettings,
      indents: indentRows,
      contracts: contractRows,
      invoices: invoiceRows,
      payments: paymentRows,
      shipments: shipments.map((s) => ({
        shipmentNumber: s.shipmentNumber,
        status: s.status,
        contractNumber: s.salesContract?.contractNumber || '',
        blNumber: s.blNumber || '',
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reports/download', requirePermission('quotes'), async (req, res) => {
  try {
    const range = reportRangeFromQuery(req);
    const match = dateMatchFilter(range.start, range.end);
    const format = (req.query.format || 'csv').toLowerCase();
    const reportType = req.query.type || 'full';

    const [quotations, offers, marginRows, clientRows, settings] = await Promise.all([
      Quotation.find(match)
        .sort({ createdAt: -1 })
        .populate('product', 'name category hsCode')
        .populate('client', 'companyName city country')
        .lean(),
      Offer.find(match)
        .sort({ createdAt: -1 })
        .populate('product', 'name')
        .populate('supplier', 'companyName')
        .lean(),
      Quotation.aggregate([
        { $match: match },
        { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: '$product',
          productName: { $first: '$productDoc.name' },
          count: { $sum: 1 },
          avgMargin: { $avg: '$margin' },
          totalRevenue: { $sum: '$finalPrice' },
        }},
        { $sort: { totalRevenue: -1 } },
      ]),
      Quotation.aggregate([
        { $match: match },
        { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'clientDoc' } },
        { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: '$client',
          clientName: { $first: '$clientDoc.companyName' },
          count: { $sum: 1 },
          totalQuoted: { $sum: '$finalPrice' },
          avgMargin: { $avg: '$margin' },
        }},
        { $sort: { totalQuoted: -1 } },
      ]),
      Settings.getGlobal(),
    ]);

    const totalQuoted = quotations.reduce((s, q) => s + (q.finalPrice || 0), 0);
    const avgMargin = quotations.length
      ? quotations.reduce((s, q) => s + (q.margin || 0), 0) / quotations.length
      : 0;
    const currency = settings.defaultCurrency || 'USD';
    const safeLabel = range.label.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

    if (format === 'html' || format === 'pdf') {
      const quoteRows = quotations.map((q) => `
        <tr>
          <td>${new Date(q.createdAt).toLocaleDateString()}</td>
          <td>${q.product?.name || ''}</td>
          <td>${q.client?.companyName || ''}</td>
          <td>${currency} ${Number(q.finalPrice || 0).toFixed(2)}</td>
          <td>${q.margin != null ? Number(q.margin).toFixed(1) + '%' : '—'}</td>
        </tr>`).join('');
      const marginTable = marginRows.map((r) => `
        <tr><td>${r.productName || '—'}</td><td>${r.count}</td><td>${r.avgMargin != null ? Number(r.avgMargin).toFixed(1) + '%' : '—'}</td><td>${currency} ${Number(r.totalRevenue || 0).toFixed(2)}</td></tr>`).join('');
      const clientTable = clientRows.map((r) => `
        <tr><td>${r.clientName || '—'}</td><td>${r.count}</td><td>${currency} ${Number(r.totalQuoted || 0).toFixed(2)}</td><td>${r.avgMargin != null ? Number(r.avgMargin).toFixed(1) + '%' : '—'}</td></tr>`).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report — ${range.label}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:32px;color:#1e293b;line-height:1.5}
          h1{color:#1a56db;margin-bottom:4px} .meta{color:#64748b;margin-bottom:24px}
          .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}
          .stat{border:1px solid #e2e8f0;border-radius:8px;padding:14px;background:#f8fafc}
          .stat label{display:block;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
          .stat strong{font-size:20px}
          table{width:100%;border-collapse:collapse;margin:16px 0 28px}
          th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;font-size:13px}
          th{background:#f1f5f9} h2{font-size:16px;margin:24px 0 8px}
          @media print{body{padding:16px}}
        </style></head><body>
        <h1>${settings.companyName || 'Tri Brothers'} — Statistical Report</h1>
        <p class="meta">Period: <strong>${range.label}</strong> (${formatDateLabel(range.start)} – ${formatDateLabel(range.end)})<br>
        Generated: ${new Date().toLocaleString()}</p>
        <div class="stats">
          <div class="stat"><label>Quotations</label><strong>${quotations.length}</strong></div>
          <div class="stat"><label>Offers</label><strong>${offers.length}</strong></div>
          <div class="stat"><label>Total quoted</label><strong>${currency} ${totalQuoted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          <div class="stat"><label>Avg margin</label><strong>${avgMargin.toFixed(1)}%</strong></div>
        </div>
        <h2>Quotations by client</h2>
        <table><thead><tr><th>Client</th><th>Count</th><th>Total quoted</th><th>Avg margin</th></tr></thead><tbody>${clientTable || '<tr><td colspan="4">No data</td></tr>'}</tbody></table>
        <h2>Margin analysis by product</h2>
        <table><thead><tr><th>Product</th><th>Quotations</th><th>Avg margin</th><th>Total revenue</th></tr></thead><tbody>${marginTable || '<tr><td colspan="4">No data</td></tr>'}</tbody></table>
        ${reportType !== 'summary' ? `<h2>All quotations in period</h2>
        <table><thead><tr><th>Date</th><th>Product</th><th>Client</th><th>Final price</th><th>Margin</th></tr></thead><tbody>${quoteRows || '<tr><td colspan="5">No data</td></tr>'}</tbody></table>` : ''}
        <script>window.onload=function(){window.print()}</script>
        </body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    const rows = [];
    rows.push(['Tri Brothers Statistical Report']);
    rows.push(['Period', range.label]);
    rows.push(['From', formatDateLabel(range.start)]);
    rows.push(['To', formatDateLabel(range.end)]);
    rows.push(['Generated', new Date().toISOString()]);
    rows.push([]);
    rows.push(['Summary']);
    rows.push(['Quotations', quotations.length]);
    rows.push(['Offers', offers.length]);
    rows.push(['Total quoted', totalQuoted]);
    rows.push(['Average margin %', avgMargin.toFixed(2)]);
    rows.push([]);
    rows.push(['Quotations by client']);
    rows.push(['Client', 'Count', 'Total quoted', 'Avg margin %']);
    clientRows.forEach((r) => {
      rows.push([r.clientName || '—', r.count, r.totalQuoted, r.avgMargin != null ? r.avgMargin.toFixed(2) : '']);
    });
    rows.push([]);
    rows.push(['Margin analysis by product']);
    rows.push(['Product', 'Quotations', 'Avg margin %', 'Total revenue']);
    marginRows.forEach((r) => {
      rows.push([r.productName || '—', r.count, r.avgMargin != null ? r.avgMargin.toFixed(2) : '', r.totalRevenue]);
    });
    if (reportType !== 'summary') {
      rows.push([]);
      rows.push(['Quotation detail']);
      rows.push(['Date', 'Product', 'Client', 'Final price', 'Margin %', 'HS Code', 'Notes']);
      quotations.forEach((q) => {
        rows.push([
          q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : '',
          q.product?.name || '',
          q.client?.companyName || '',
          q.finalPrice,
          q.margin != null ? q.margin : '',
          q.hsCode || q.product?.hsCode || '',
          q.notes || '',
        ]);
      });
      rows.push([]);
      rows.push(['Offers detail']);
      rows.push(['Date', 'Product', 'Supplier', 'Received price', 'Notes']);
      offers.forEach((o) => {
        rows.push([
          o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : '',
          o.product?.name || '',
          o.supplier?.companyName || '',
          o.receivedPrice != null ? o.receivedPrice : '',
          o.notes || '',
        ]);
      });
    }

    const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${safeLabel}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- USER MANAGEMENT (admin only) ---
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).select('-password');
    res.json(users.map((u) => sanitizeUserForResponse(u)));
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, displayName, email, role, permissions, isActive } = req.body || {};
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const trimmedUsername = String(username).trim();
    const existing = await User.findOne({ username: trimmedUsername });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const userRole = ['admin', 'owner', 'staff'].includes(role) ? role : 'staff';
    const defaultPerms = User.defaultPermissionsForRole(userRole);
    const mergedPermissions = { ...defaultPerms, ...(permissions || {}) };

    const hash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      username: trimmedUsername,
      password: hash,
      displayName: displayName ? String(displayName).trim() : trimmedUsername,
      email: email ? String(email).trim() : '',
      role: userRole,
      isActive: isActive !== false,
      permissions: mergedPermissions,
      createdBy: req.session.userId,
    });

    await logSessionEvent(req, 'CREATE_USER', 'User', user._id, {
      username: user.username,
      role: user.role,
    });

    res.status(201).json({ message: 'User created successfully', user: sanitizeUserForResponse(user) });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ error: err.message || 'Failed to create user' });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { username, password, displayName, email, role, permissions, isActive } = req.body || {};

    if (username && String(username).trim() !== user.username) {
      const trimmed = String(username).trim();
      const dup = await User.findOne({ username: trimmed, _id: { $ne: user._id } });
      if (dup) return res.status(409).json({ error: 'Username already exists' });
      user.username = trimmed;
    }

    if (displayName !== undefined) user.displayName = String(displayName).trim();
    if (email !== undefined) user.email = String(email).trim();

    if (role && ['admin', 'owner', 'staff'].includes(role)) {
      user.role = role;
    }

    if (permissions && typeof permissions === 'object') {
      const defaults = User.defaultPermissionsForRole(user.role);
      user.permissions = { ...defaults, ...permissions };
    } else if (role) {
      user.permissions = User.defaultPermissionsForRole(user.role);
    }

    if (isActive !== undefined) user.isActive = !!isActive;

    if (password) {
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ error: pwError });
      user.password = await bcrypt.hash(String(password), 10);
    }

    // Prevent deactivating the last active admin
    if (user.role === 'admin' && user.isActive === false) {
      const activeAdmins = await User.countDocuments({
        role: 'admin',
        isActive: { $ne: false },
        _id: { $ne: user._id },
      });
      if (activeAdmins === 0) {
        return res.status(400).json({ error: 'Cannot deactivate the last active admin account' });
      }
    }

    await user.save();
    await logSessionEvent(req, 'UPDATE_USER', 'User', user._id, {
      username: user.username,
      role: user.role,
      isActive: user.isActive,
    });

    res.json({ message: 'User updated successfully', user: sanitizeUserForResponse(user) });
  } catch (err) {
    console.error('❌ Error updating user:', err);
    res.status(500).json({ error: err.message || 'Failed to update user' });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.session.userId)) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin account' });
      }
    }

    await User.findByIdAndDelete(req.params.id);
    await logSessionEvent(req, 'DELETE_USER', 'User', user._id, { username: user.username });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// List recent session/audit events for admin dashboard
app.get('/api/sessions', requirePermission('sessions'), async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const events = await SessionLog.find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500))
      .lean()
      .populate('userId', 'username role');
    res.json(events);
  } catch (err) {
    console.error('❌ Error fetching session logs:', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

const clientDist = path.join(__dirname, 'client', 'dist');
const spaReady = fs.existsSync(path.join(clientDist, 'index.html'));

// Legacy multi-page HTML (kept for print/PDF helpers & fallback)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const fileName = path.basename(req.path);
    if (fileName === 'login.html') {
      if (req.session && req.session.isAuthenticated) {
        return res.redirect(spaReady ? '/' : '/index.html');
      }
      return next();
    }
    if (req.session && req.session.isAuthenticated) return next();
    return res.redirect(spaReady ? '/login' : '/login.html');
  }
  next();
});

app.use(express.static('public', {
  index: false,
  maxAge: isProd ? '1d' : 0,
  etag: true,
}));

if (spaReady) {
  app.use(express.static(clientDist, {
    index: false,
    maxAge: isProd ? '7d' : 0,
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
}

// SPA entry + client-side routes (API / uploads / legacy assets already handled above)
app.get(['/', '/login', '/products', '/suppliers', '/clients', '/quotes', '/sales-contracts', '/indents', '/shipments', '/invoices', '/commissions', '/mail', '/reports', '/sessions', '/admin', '/settings', '/tasks'], (req, res) => {
  if (spaReady) {
    const isLogin = req.path === '/login';
    const authed = !!(req.session && req.session.isAuthenticated);
    if (!isLogin && !authed) {
      return res.redirect('/login');
    }
    if (isLogin && authed) {
      return res.redirect('/');
    }
    return res.sendFile(path.join(clientDist, 'index.html'));
  }
  if (req.path === '/login' || req.path === '/') {
    return res.redirect(req.session && req.session.isAuthenticated ? '/index.html' : '/login.html');
  }
  return res.redirect('/login.html');
});

app.get('*path', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/health') ||
    req.path.includes('.')
  ) {
    return next();
  }
  if (spaReady) {
    if (!(req.session && req.session.isAuthenticated)) {
      return res.redirect('/login');
    }
    return res.sendFile(path.join(clientDist, 'index.html'));
  }
  return res.status(404).json({ error: 'Not found' });
});

// ✅ Server Start
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  if (spaReady) {
    console.log('⚡ Serving React SPA from client/dist');
  } else {
    console.log('ℹ️  client/dist missing — run `npm run build:client` (legacy HTML still available)');
  }
});
