const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination, paginatedResponse } = require('../lib/pagination');
const { requireAuth, requirePermission } = require('../middleware/auth');

test('parsePagination defaults', () => {
  const p = parsePagination({});
  assert.equal(p.page, 1);
  assert.equal(p.limit, 50);
  assert.equal(p.skip, 0);
});

test('paginatedResponse shape', () => {
  const r = paginatedResponse([1, 2], 10, 1, 5);
  assert.equal(r.items.length, 2);
  assert.equal(r.pagination.total, 10);
  assert.equal(r.pagination.pages, 2);
});

test('requireAuth rejects unauthenticated', () => {
  let status = null;
  const req = { session: {} };
  const res = { status(code) { status = code; return this; }, json() {} };
  requireAuth(req, res, () => { status = 200; });
  assert.equal(status, 401);
});

test('requirePermission allows admin', () => {
  let called = false;
  const mw = requirePermission('canDelete');
  mw({ session: { isAuthenticated: true, role: 'admin' } }, {}, () => { called = true; });
  assert.equal(called, true);
});
