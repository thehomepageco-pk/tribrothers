const ACTION_OVERRIDE_KEYS = new Set(['canEdit', 'canDelete', 'canEmail']);
const DEFAULT_OVERRIDE_MS = 5 * 60 * 1000; // 5 minutes

function clearOverrideScope(req) {
  delete req.session.adminOverrideUntil;
  delete req.session.adminOverrideBy;
  delete req.session.adminOverrideGrantedAt;
  delete req.session.adminOverridePageKey;
  delete req.session.adminOverridePermission;
  delete req.session.adminOverridePages;
  delete req.session.adminOverrideCanEdit;
  delete req.session.adminOverrideCanDelete;
  delete req.session.adminOverrideCanEmail;
}

function clearExpiredAdminOverride(req) {
  if (!req.session || !req.session.adminOverrideUntil) return false;
  const until = Number(req.session.adminOverrideUntil);
  if (!Number.isFinite(until) || until <= Date.now()) {
    clearOverrideScope(req);
    return false;
  }
  return true;
}

function hasAdminOverride(req) {
  return clearExpiredAdminOverride(req);
}

function getAdminOverrideStatus(req) {
  if (!hasAdminOverride(req)) {
    return {
      active: false,
      expiresAt: null,
      remainingMs: 0,
      unlockedBy: null,
      pageKey: '',
      permission: '',
      pages: [],
      canEdit: false,
      canDelete: false,
      canEmail: false,
    };
  }
  const expiresAt = Number(req.session.adminOverrideUntil);
  const pages = Array.isArray(req.session.adminOverridePages)
    ? req.session.adminOverridePages
    : req.session.adminOverridePermission
      ? [req.session.adminOverridePermission]
      : [];
  return {
    active: true,
    expiresAt,
    remainingMs: Math.max(0, expiresAt - Date.now()),
    unlockedBy: req.session.adminOverrideBy || null,
    pageKey: req.session.adminOverridePageKey || '',
    permission: req.session.adminOverridePermission || '',
    pages,
    canEdit: Boolean(req.session.adminOverrideCanEdit),
    canDelete: Boolean(req.session.adminOverrideCanDelete),
    canEmail: Boolean(req.session.adminOverrideCanEmail),
  };
}

function overrideAllows(req, permKey) {
  if (!hasAdminOverride(req)) return false;
  const pages = Array.isArray(req.session.adminOverridePages)
    ? req.session.adminOverridePages
    : req.session.adminOverridePermission
      ? [req.session.adminOverridePermission]
      : [];

  if (permKey === 'canEdit') return Boolean(req.session.adminOverrideCanEdit);
  if (permKey === 'canDelete') return Boolean(req.session.adminOverrideCanDelete);
  if (permKey === 'canEmail') return Boolean(req.session.adminOverrideCanEmail);
  // Page permission: must be in the unlocked page scope
  if (permKey === 'mail') {
    return pages.includes('mail') || Boolean(req.session.adminOverrideCanEmail);
  }
  if (!pages.length) {
    // Legacy unscoped unlock (pre-scope) — keep old behaviour except adminPanel
    return permKey !== 'adminPanel';
  }
  return pages.includes(permKey);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    clearExpiredAdminOverride(req);
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAuthenticated || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function clearTempSession(req) {
  delete req.session.tempAccessUntil;
  delete req.session.tempCanEdit;
  delete req.session.tempCanEmail;
  delete req.session.tempCanDelete;
  delete req.session.tempPermission;
  delete req.session.tempPageKey;
  delete req.session.tempPages;
}

function hasTempAccess(req, permKey) {
  if (!req.session || !req.session.tempAccessUntil) return false;
  const until = Number(req.session.tempAccessUntil);
  if (!Number.isFinite(until) || until <= Date.now()) {
    clearTempSession(req);
    return false;
  }
  if (permKey === 'canEdit') return Boolean(req.session.tempCanEdit);
  if (permKey === 'canEmail') return Boolean(req.session.tempCanEmail);
  if (permKey === 'canDelete') return Boolean(req.session.tempCanDelete);
  const pages = Array.isArray(req.session.tempPages)
    ? req.session.tempPages
    : req.session.tempPermission
      ? [req.session.tempPermission]
      : [];
  if (permKey === 'mail') {
    return pages.includes('mail') || Boolean(req.session.tempCanEmail);
  }
  if (pages.includes(permKey)) return true;
  if (req.session.tempPermission && req.session.tempPermission === permKey) return true;
  return false;
}

function requirePermission(permKey) {
  return (req, res, next) => {
    if (!req.session || !req.session.isAuthenticated) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.session.role === 'admin') return next();
    const perms = req.session.permissions || {};
    if (perms[permKey]) return next();

    if (overrideAllows(req, permKey)) return next();
    if (hasTempAccess(req, permKey)) return next();

    const needsUnlock = ACTION_OVERRIDE_KEYS.has(permKey);
    return res.status(403).json({
      error: needsUnlock
        ? 'This action is locked. Ask an admin to unlock the specific page and option.'
        : 'Permission denied',
      code: needsUnlock ? 'ADMIN_UNLOCK_REQUIRED' : 'PERMISSION_DENIED',
      permission: permKey,
    });
  };
}

function requirePageAccess(pageKey) {
  return requirePermission(pageKey);
}

module.exports = {
  requireAuth,
  requireAdmin,
  requirePermission,
  requirePageAccess,
  hasAdminOverride,
  getAdminOverrideStatus,
  clearExpiredAdminOverride,
  overrideAllows,
  ACTION_OVERRIDE_KEYS,
  DEFAULT_OVERRIDE_MS,
};
