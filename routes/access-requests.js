const express = require('express');
const AccessRequest = require('../models/AccessRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_DURATIONS = [15, 30, 60, 120];

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  products: 'Products',
  suppliers: 'Suppliers',
  clients: 'Clients',
  quotes: 'Quotes & Offers',
  'sales-contracts': 'Sales Contracts',
  indents: 'Indents',
  shipments: 'Shipments',
  invoices: 'Invoices',
  commissions: 'Commissions',
  reports: 'Reports',
  mail: 'Mail',
  tasks: 'Tasks',
  sessions: 'Sessions',
  admin: 'Admin panel',
  settings: 'Settings',
};

function scopeLabel(doc) {
  const page = PAGE_LABELS[doc.pageKey] || doc.pageKey || doc.permission || 'page';
  const bits = [page];
  if (doc.actions?.canEdit) bits.push('edit');
  if (doc.actions?.canDelete) bits.push('delete');
  if (doc.actions?.canEmail) bits.push('email');
  return bits.join(' · ');
}

async function notifyAdmins({ title, message, type, href, meta, accessRequestId }) {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id');
  if (!admins.length) return;
  await Notification.insertMany(
    admins.map((a) => ({
      userId: a._id,
      title,
      message,
      type: type || 'access_request',
      href: href || '/',
      accessRequestId: accessRequestId || null,
      meta: meta || null,
      read: false,
    })),
  );
}

router.post('/access-requests', async (req, res) => {
  try {
    const permission = String(req.body?.permission || '').trim() || 'quotes';
    const pageKey = String(req.body?.pageKey || permission).trim();
    const path = String(req.body?.path || '').trim();
    let durationMinutes = Number(req.body?.durationMinutes);
    if (!ALLOWED_DURATIONS.includes(durationMinutes)) durationMinutes = 30;
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const actionsIn = req.body?.actions || {};
    const actions = {
      view: true,
      canEdit: Boolean(actionsIn.canEdit),
      canDelete: Boolean(actionsIn.canDelete),
      canEmail: Boolean(actionsIn.canEmail) || permission === 'mail' || pageKey === 'mail',
    };

    const existing = await AccessRequest.findOne({
      requester: req.session.userId,
      status: 'pending',
      permission,
      pageKey,
    });
    if (existing) {
      return res.status(400).json({ error: 'You already have a pending request for this page' });
    }

    const doc = await AccessRequest.create({
      requester: req.session.userId,
      permission,
      pageKey,
      path,
      durationMinutes,
      note,
      actions,
    });

    const who = req.session.displayName || req.session.username || 'Staff';
    const label = scopeLabel(doc);
    await notifyAdmins({
      title: 'Access request',
      message: `${who} requested ${label} for ${durationMinutes} minutes${note ? `: ${note}` : ''}`,
      type: 'access_request',
      href: '/',
      accessRequestId: doc._id,
      meta: {
        status: 'pending',
        permission,
        pageKey,
        durationMinutes,
        requesterName: who,
        path,
        actions,
        scopeLabel: label,
      },
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error('❌ create access request:', err);
    res.status(500).json({ error: 'Failed to create access request' });
  }
});

router.get('/access-requests/pending', requireAdmin, async (req, res) => {
  try {
    const items = await AccessRequest.find({ status: 'pending' })
      .populate('requester', 'username displayName email role')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

router.post('/access-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const doc = await AccessRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    let mins = Number(req.body?.durationMinutes);
    if (!ALLOWED_DURATIONS.includes(mins)) mins = doc.durationMinutes || 30;
    const expiresAt = new Date(Date.now() + mins * 60 * 1000);

    doc.status = 'approved';
    doc.reviewedBy = req.session.userId;
    doc.reviewedAt = new Date();
    doc.expiresAt = expiresAt;
    doc.durationMinutes = mins;
    await doc.save();

    const pages = doc.permission ? [String(doc.permission)] : [];
    if (doc.permission === 'mail' || doc.pageKey === 'mail') pages.push('mail');

    const requester = await User.findById(doc.requester);
    if (requester) {
      requester.tempAccess = {
        until: expiresAt,
        canEdit: Boolean(doc.actions?.canEdit),
        canEmail: Boolean(doc.actions?.canEmail),
        canDelete: Boolean(doc.actions?.canDelete),
        permission: doc.permission,
        pageKey: doc.pageKey || '',
        pages: [...new Set(pages)],
        grantedBy: req.session.userId,
      };
      await requester.save();

      await Notification.create({
        userId: requester._id,
        title: 'Access granted',
        message: `Approved ${scopeLabel(doc)} for ${mins} minutes.`,
        type: 'update',
        href: doc.path || '/',
        accessRequestId: doc._id,
        meta: { status: 'approved', expiresAt, pageKey: doc.pageKey, actions: doc.actions },
      });
    }

    await Notification.updateMany(
      { accessRequestId: doc._id, type: 'access_request' },
      { $set: { 'meta.status': 'approved', read: true } },
    );

    res.json({ success: true, request: doc, expiresAt });
  } catch (err) {
    console.error('❌ approve access:', err);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

router.post('/access-requests/:id/deny', requireAdmin, async (req, res) => {
  try {
    const doc = await AccessRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Request not found' });
    if (doc.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    doc.status = 'denied';
    doc.reviewedBy = req.session.userId;
    doc.reviewedAt = new Date();
    await doc.save();

    await Notification.create({
      userId: doc.requester,
      title: 'Access denied',
      message: `Your request for ${scopeLabel(doc)} was denied.`,
      type: 'update',
      href: '/',
      accessRequestId: doc._id,
      meta: { status: 'denied' },
    });

    await Notification.updateMany(
      { accessRequestId: doc._id, type: 'access_request' },
      { $set: { 'meta.status': 'denied', read: true } },
    );

    res.json({ success: true, request: doc });
  } catch (err) {
    console.error('❌ deny access:', err);
    res.status(500).json({ error: 'Failed to deny request' });
  }
});

module.exports = router;
