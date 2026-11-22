/**
 * Shared navigation, permissions, global search for Tri Brothers.
 * Include: <script src="toast.js"></script><script src="nav-auth.js"></script>
 */
(function () {
  var PAGE_PERMISSIONS = {
    'index.html': 'dashboard',
    'products.html': 'products',
    'supplier.html': 'suppliers',
    'clients.html': 'clients',
    'quotes.html': 'quotes',
    'sales-contract.html': 'quotes',
    'indent.html': 'quotes',
    'shipment.html': 'quotes',
    'invoices.html': 'quotes',
    'commissions.html': 'quotes',
    'sessions.html': 'sessions',
    'admin.html': 'adminPanel',
    'settings.html': 'adminPanel',
    'reports.html': 'quotes',
    'mail.html': null,
  };

  var NAV_PERMISSIONS = {
    'index.html': 'dashboard',
    'products.html': 'products',
    'supplier.html': 'suppliers',
    'clients.html': 'clients',
    'quotes.html': 'quotes',
    'sales-contract.html': 'quotes',
    'indent.html': 'quotes',
    'shipment.html': 'quotes',
    'invoices.html': 'quotes',
    'commissions.html': 'quotes',
    'sessions.html': 'sessions',
    'reports.html': 'quotes',
    'admin.html': 'adminPanel',
    'settings.html': 'adminPanel',
    'mail.html': null,
  };

  var ICON = {
    dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/>',
    products: '<path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    suppliers: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 2v5h-5z"/>',
    clients: '<path d="M16 11a4 4 0 1 0-8 0"/><path d="M2 21a8 8 0 0 1 20 0"/>',
    mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
    quotes: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>',
    contract: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    indent: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M8 13h8"/><path d="M8 17h6"/>',
    shipment: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><path d="M7 17a2 2 0 1 0 4 0"/><path d="M17 17a2 2 0 1 0 4 0"/>',
    invoice: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    commissions: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
    sessions: '<path d="M12 8v5l3 2"/><path d="M21 12a9 9 0 1 1-9-9"/>',
    reports: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 17V9"/><path d="M12 17V7"/><path d="M16 17v-4"/>',
    admin: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a8 8 0 0 0 .1-1l2-1.2-2-3.4-2.3.6a7.9 7.9 0 0 0-1.7-1L15 6h-6l-.5 2a7.9 7.9 0 0 0-1.7 1L4 8.4 2 11.8 4 13a8 8 0 0 0 .1 1L2 15.2l2 3.4 2.3-.6a7.9 7.9 0 0 0 1.7 1L9 22h6l.5-2a7.9 7.9 0 0 0 1.7-1l2.3.6 2-3.4-2.1-1.2Z"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a8 8 0 0 0 .1-1l2-1.2-2-3.4-2.3.6a7.9 7.9 0 0 0-1.7-1L15 6h-6l-.5 2a7.9 7.9 0 0 0-1.7 1L4 8.4 2 11.8 4 13a8 8 0 0 0 .1 1L2 15.2l2 3.4 2.3-.6a7.9 7.9 0 0 0 1.7 1L9 22h6l.5-2a7.9 7.9 0 0 0 1.7-1l2.3.6 2-3.4-2.1-1.2Z"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/>',
  };

  function getCurrentPage() {
    var path = window.location.pathname || '';
    return path.split('/').pop() || 'index.html';
  }

  function navLink(href, label, iconKey, extraAttrs) {
    var page = getCurrentPage();
    var active = page === href ? ' active' : '';
    var attrs = extraAttrs || '';
    return '<a href="' + href + '"' + active + (attrs ? ' ' + attrs : '') + '>' +
      '<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + (ICON[iconKey] || '') + '</svg></span>' +
      label + '</a>';
  }

  function buildGroupedNavHtml() {
    return '' +
      '<div class="nav-group"><div class="nav-group-label">Home</div>' +
        navLink('index.html', 'Dashboard', 'dashboard') +
      '</div>' +
      '<div class="nav-group"><div class="nav-group-label">Data</div>' +
        navLink('products.html', 'Products', 'products') +
        navLink('supplier.html', 'Suppliers', 'suppliers') +
        navLink('clients.html', 'Clients', 'clients') +
      '</div>' +
      '<div class="nav-group"><div class="nav-group-label">Sales</div>' +
        navLink('quotes.html', 'Quotations &amp; Offers', 'quotes') +
        navLink('sales-contract.html', 'Sales Contract', 'contract') +
        navLink('indent.html', 'Indent', 'indent') +
        navLink('shipment.html', 'Shipment', 'shipment') +
        navLink('invoices.html', 'Invoices &amp; Payments', 'invoice') +
        navLink('commissions.html', 'Commissions', 'commissions') +
      '</div>' +
      '<div class="nav-group"><div class="nav-group-label">Comms</div>' +
        navLink('mail.html', 'Mail', 'mail') +
      '</div>' +
      '<div class="nav-group"><div class="nav-group-label">System</div>' +
        navLink('reports.html', 'Reports', 'reports') +
        navLink('sessions.html', 'Sessions', 'sessions') +
        navLink('admin.html', 'Admin Panel', 'admin', 'id="adminNavLink"') +
        navLink('settings.html', 'Settings', 'settings', 'id="settingsNavLink"') +
      '</div>' +
      navLink('#', 'Logout', 'logout', 'id="logoutLink"');
  }

  function injectGroupedSidebar() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.dataset.groupedNav === '1') return;
    sidebar.dataset.groupedNav = '1';

    var closeBtn = sidebar.querySelector('.sidebar-close');
    var title = sidebar.querySelector('h2');
    var badge = sidebar.querySelector('#navUserBadge');

    Array.from(sidebar.children).forEach(function (child) {
      if (child === closeBtn || child === title || child === badge) return;
      child.remove();
    });

    // Upgrade plain <h2> into branded lockup
    if (title && !sidebar.querySelector('.sidebar-brand')) {
      var brand = document.createElement('div');
      brand.className = 'sidebar-brand';
      brand.innerHTML =
        '<span class="sidebar-brand-mark" aria-hidden="true">TB</span>' +
        '<div class="sidebar-brand-text">' +
          '<h2>Tri Brothers</h2>' +
          '<span class="sidebar-brand-tag">Trade OS</span>' +
        '</div>';
      title.replaceWith(brand);
    } else if (!title && !sidebar.querySelector('.sidebar-brand')) {
      var brandNew = document.createElement('div');
      brandNew.className = 'sidebar-brand';
      brandNew.innerHTML =
        '<span class="sidebar-brand-mark" aria-hidden="true">TB</span>' +
        '<div class="sidebar-brand-text">' +
          '<h2>Tri Brothers</h2>' +
          '<span class="sidebar-brand-tag">Trade OS</span>' +
        '</div>';
      if (closeBtn && closeBtn.nextSibling) sidebar.insertBefore(brandNew, closeBtn.nextSibling);
      else if (closeBtn) sidebar.appendChild(brandNew);
      else sidebar.insertBefore(brandNew, sidebar.firstChild);
    }

    var wrap = document.createElement('div');
    wrap.className = 'sidebar-nav';
    wrap.innerHTML = buildGroupedNavHtml();
    sidebar.appendChild(wrap);
  }

  function ensureMobileTopbar() {
    if (document.getElementById('mobileTopbar')) return;
    if (!document.body.classList.contains('app-layout')) return;
    var bar = document.createElement('div');
    bar.id = 'mobileTopbar';
    bar.className = 'mobile-topbar';
    bar.innerHTML =
      '<span class="mobile-topbar-brand">' +
        '<span class="mobile-topbar-mark" aria-hidden="true">TB</span>' +
        '<span class="mobile-topbar-title">Tri Brothers</span>' +
      '</span>';
    document.body.insertBefore(bar, document.body.firstChild);
    if (window.triMobile && window.triMobile.refresh) window.triMobile.refresh();
  }

  function applyNavVisibility(user) {
    var perms = (user && user.permissions) || {};
    var role = (user && user.role) || 'staff';
    document.querySelectorAll('.sidebar a[href]').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href === '#' || href.indexOf('logout') !== -1) return;
      var file = href.split('/').pop().split('?')[0];
      var permKey = NAV_PERMISSIONS[file];
      if (permKey === null || permKey === undefined) {
        if (file === 'mail.html') {
          link.style.display = (role === 'admin' || perms.canEmail !== false) ? '' : 'none';
        }
        return;
      }
      var allowed = role === 'admin' || !!perms[permKey];
      link.style.display = allowed ? '' : 'none';
    });

    document.querySelectorAll('.nav-group').forEach(function (group) {
      var links = group.querySelectorAll('a[href]');
      var anyVisible = Array.from(links).some(function (a) {
        return a.style.display !== 'none';
      });
      group.style.display = anyVisible ? '' : 'none';
    });

    var settingsLink = document.getElementById('settingsNavLink');
    if (settingsLink) {
      settingsLink.style.display = (role === 'admin') ? '' : 'none';
    }

    var userBadge = document.getElementById('navUserBadge');
    if (userBadge && user) {
      userBadge.textContent = (user.displayName || user.username || '') + (user.role ? ' (' + user.role + ')' : '');
      userBadge.style.display = userBadge.textContent ? 'block' : 'none';
    }
  }

  var EDIT_SELECTORS = '.edit-btn, .save-edit-btn, #toggleFormBtn, #editSelectedBtn, #editSupplierBtn, [data-action="edit"]';
  var DELETE_SELECTORS = '.delete-btn, #deleteSelectedBtn, #deleteSupplierBtn, [data-action="delete"]';
  var EMAIL_SELECTORS = '.email-btn, #emailSelectedBtn, #emailSupplierBtn, [data-action="email"]';
  var OVERRIDE_TIMER = null;
  var pendingUnlockAction = null;
  var applyingLocks = false;

  function baseCan(key) {
    var auth = window.triAuth;
    if (!auth || !auth.user) return false;
    if (auth.user.role === 'admin') return true;
    return !!(auth.permissions && auth.permissions[key]);
  }

  function overrideActive() {
    var o = window.triAuth && window.triAuth.adminOverride;
    return !!(o && o.active && o.expiresAt && o.expiresAt > Date.now());
  }

  function applyActionPermissions() {
    var auth = window.triAuth;
    if (!auth || !auth.user) return;
    applyingLocks = true;

    unlockDomPermissions();

    if (!auth.can('canEdit')) {
      lockElements(document.querySelectorAll(EDIT_SELECTORS), 'canEdit');
      document.querySelectorAll('form button[type="submit"].btn').forEach(function (el) {
        var form = el.closest('form');
        if (form && form.id !== 'loginForm') lockElement(el, 'canEdit');
      });
    }
    if (!auth.can('canDelete')) {
      lockElements(document.querySelectorAll(DELETE_SELECTORS), 'canDelete');
    }
    if (!auth.can('canEmail')) {
      lockElements(document.querySelectorAll(EMAIL_SELECTORS), 'canEmail');
    }

    ensureUnlockFab();
    renderOverrideBanner();
    applyingLocks = false;
  }

  function unlockDomPermissions() {
    document.querySelectorAll('.is-perm-locked').forEach(function (el) {
      el.classList.remove('is-perm-locked');
      el.removeAttribute('data-lock-perm');
      el.removeAttribute('aria-disabled');
      if (el.dataset.prevDisabled === '0') el.disabled = false;
      else if (el.dataset.prevDisabled === '1') el.disabled = true;
      delete el.dataset.prevDisabled;
      if (el.dataset.prevDisplay != null) {
        el.style.display = el.dataset.prevDisplay;
        delete el.dataset.prevDisplay;
      }
      var badge = el.querySelector('.perm-lock-icon');
      if (badge) badge.remove();
    });
  }

  function lockElements(nodeList, permKey) {
    Array.from(nodeList || []).forEach(function (el) {
      if (el) lockElement(el, permKey);
    });
  }

  function lockElement(el, permKey) {
    if (!el || el.classList.contains('is-perm-locked')) return;
    if (el.dataset.prevDisplay == null) el.dataset.prevDisplay = el.style.display || '';
    el.style.display = '';
    el.classList.add('is-perm-locked');
    el.setAttribute('data-lock-perm', permKey);
    el.setAttribute('aria-disabled', 'true');
    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
      el.dataset.prevDisabled = el.disabled ? '1' : '0';
      // Keep clickable so unlock modal can open; prevent native submit via capture handler
    }
    if (!el.querySelector('.perm-lock-icon')) {
      var icon = document.createElement('span');
      icon.className = 'perm-lock-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      el.appendChild(icon);
    }
  }

  function ensureUnlockFab() {
    var auth = window.triAuth;
    if (!auth || !auth.user || auth.user.role === 'admin') {
      var existing = document.getElementById('adminUnlockFab');
      if (existing) existing.remove();
      return;
    }
    var needsLock = !baseCan('canEdit') || !baseCan('canDelete') || !baseCan('canEmail');
    if (!needsLock) {
      var fab0 = document.getElementById('adminUnlockFab');
      if (fab0) fab0.remove();
      return;
    }
    var fab = document.getElementById('adminUnlockFab');
    if (!fab) {
      fab = document.createElement('button');
      fab.type = 'button';
      fab.id = 'adminUnlockFab';
      fab.className = 'admin-unlock-fab';
      document.body.appendChild(fab);
    }
    fab.onclick = null;
    if (overrideActive()) {
      fab.classList.add('is-unlocked');
      fab.innerHTML = '<span class="perm-lock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 7.5-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span> Relock';
      fab.title = 'Lock edit/delete again';
      fab.onclick = function () { clearAdminOverride(); };
    } else {
      fab.classList.remove('is-unlocked');
      fab.innerHTML = '<span class="perm-lock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span> Admin unlock';
      fab.title = 'Ask an admin to unlock edit/delete for a short time';
      fab.onclick = function () { openAdminUnlockModal(); };
    }
  }

  function renderOverrideBanner() {
    var existing = document.getElementById('adminOverrideBanner');
    if (!overrideActive()) {
      if (existing) existing.remove();
      if (OVERRIDE_TIMER) { clearInterval(OVERRIDE_TIMER); OVERRIDE_TIMER = null; }
      return;
    }
    var o = window.triAuth.adminOverride;
    var banner = existing;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'adminOverrideBanner';
      banner.className = 'admin-override-banner';
      document.body.appendChild(banner);
    }
    function tick() {
      var left = Math.max(0, (o.expiresAt || 0) - Date.now());
      if (left <= 0) {
        window.triAuth.adminOverride = { active: false };
        applyActionPermissions();
        if (window.triToast) triToast('Admin unlock expired — actions are locked again.', 'info');
        return;
      }
      var mins = Math.floor(left / 60000);
      var secs = Math.floor((left % 60000) / 1000);
      banner.innerHTML =
        '<strong>Admin unlock active</strong>' +
        '<span>Edit / delete / email unlocked' +
        (o.unlockedBy ? ' by <em>' + escapeHtml(o.unlockedBy) + '</em>' : '') +
        ' · expires in ' + mins + ':' + String(secs).padStart(2, '0') + '</span>' +
        '<button type="button" class="action-btn" id="adminOverrideRelockBtn">Lock now</button>';
      var btn = document.getElementById('adminOverrideRelockBtn');
      if (btn) btn.onclick = function () { clearAdminOverride(); };
    }
    tick();
    if (OVERRIDE_TIMER) clearInterval(OVERRIDE_TIMER);
    OVERRIDE_TIMER = setInterval(tick, 1000);
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function ensureUnlockModal() {
    if (document.getElementById('adminUnlockModal')) return;
    var modal = document.createElement('div');
    modal.id = 'adminUnlockModal';
    modal.className = 'admin-unlock-modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML =
      '<div class="admin-unlock-backdrop" data-close="1"></div>' +
      '<div class="admin-unlock-dialog" role="dialog" aria-modal="true" aria-labelledby="adminUnlockTitle">' +
        '<div class="admin-unlock-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="28" height="28"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
        '</div>' +
        '<h2 id="adminUnlockTitle">Admin unlock required</h2>' +
        '<p class="admin-unlock-copy">This action is locked for your account. An admin must enter their username and password to unlock edit, delete, and email for a short time.</p>' +
        '<form id="adminUnlockForm" autocomplete="off">' +
          '<label for="adminUnlockUser">Admin username</label>' +
          '<input type="text" id="adminUnlockUser" name="admin_username" autocomplete="off" required />' +
          '<label for="adminUnlockPass">Admin password</label>' +
          '<input type="password" id="adminUnlockPass" name="admin_password" autocomplete="current-password" required />' +
          '<label for="adminUnlockMins">Unlock duration</label>' +
          '<select id="adminUnlockMins">' +
            '<option value="5" selected>5 minutes</option>' +
            '<option value="10">10 minutes</option>' +
            '<option value="15">15 minutes</option>' +
            '<option value="30">30 minutes</option>' +
          '</select>' +
          '<p id="adminUnlockError" class="admin-unlock-error" hidden></p>' +
          '<div class="admin-unlock-actions">' +
            '<button type="button" class="action-btn" data-close="1">Cancel</button>' +
            '<button type="submit" class="btn" id="adminUnlockSubmit">Unlock</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-close') === '1') closeAdminUnlockModal();
    });
    document.getElementById('adminUnlockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submitAdminUnlock();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeAdminUnlockModal();
    });
  }

  function openAdminUnlockModal(permKey) {
    ensureUnlockModal();
    pendingUnlockAction = permKey || null;
    var modal = document.getElementById('adminUnlockModal');
    var err = document.getElementById('adminUnlockError');
    err.hidden = true;
    err.textContent = '';
    document.getElementById('adminUnlockUser').value = '';
    document.getElementById('adminUnlockPass').value = '';
    modal.removeAttribute('hidden');
    setTimeout(function () { document.getElementById('adminUnlockUser').focus(); }, 50);
  }

  function closeAdminUnlockModal() {
    var modal = document.getElementById('adminUnlockModal');
    if (modal) modal.setAttribute('hidden', '');
    pendingUnlockAction = null;
  }

  function submitAdminUnlock() {
    var username = document.getElementById('adminUnlockUser').value.trim();
    var password = document.getElementById('adminUnlockPass').value;
    var mins = document.getElementById('adminUnlockMins').value;
    var err = document.getElementById('adminUnlockError');
    var btn = document.getElementById('adminUnlockSubmit');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Unlocking…';

    fetch('/api/auth/admin-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: username, password: password, durationMinutes: Number(mins) || 5 }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = 'Unlock';
        if (!res.ok) {
          err.textContent = res.d.error || 'Unlock failed';
          err.hidden = false;
          return;
        }
        window.triAuth.adminOverride = res.d.adminOverride || { active: true };
        closeAdminUnlockModal();
        applyActionPermissions();
        if (window.triToast) triToast(res.d.message || 'Unlocked', 'success');
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Unlock';
        err.textContent = 'Could not reach the server.';
        err.hidden = false;
      });
  }

  function clearAdminOverride() {
    fetch('/api/auth/admin-override/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        window.triAuth.adminOverride = d.adminOverride || { active: false };
        applyActionPermissions();
        if (window.triToast) triToast('Actions locked again', 'info');
      })
      .catch(function () {
        window.triAuth.adminOverride = { active: false };
        applyActionPermissions();
      });
  }

  function bindLockedClickCapture() {
    if (document.documentElement.dataset.lockCapture === '1') return;
    document.documentElement.dataset.lockCapture = '1';
    document.addEventListener('click', function (e) {
      var locked = e.target && e.target.closest && e.target.closest('.is-perm-locked');
      if (!locked) return;
      e.preventDefault();
      e.stopPropagation();
      openAdminUnlockModal(locked.getAttribute('data-lock-perm'));
    }, true);
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.id === 'loginForm' || form.id === 'adminUnlockForm') return;
      if (window.triAuth && !window.triAuth.can('canEdit')) {
        e.preventDefault();
        e.stopPropagation();
        openAdminUnlockModal('canEdit');
      }
    }, true);

    // Re-apply locks when pages re-render tables/buttons
    var reapplyTimer = null;
    var observer = new MutationObserver(function () {
      if (applyingLocks) return;
      if (!window.triAuth || !window.triAuth.user) return;
      if (overrideActive()) return;
      if (baseCan('canEdit') && baseCan('canDelete') && baseCan('canEmail')) return;
      clearTimeout(reapplyTimer);
      reapplyTimer = setTimeout(function () {
        applyActionPermissions();
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function initGlobalSearch() {
    if (document.getElementById('globalSearchBar')) return;
    var main = document.querySelector('.main');
    if (!main) return;
    var wrap = document.createElement('div');
    wrap.className = 'global-search-bar';
    wrap.id = 'globalSearchBar';
    wrap.innerHTML =
      '<label class="global-search-label" for="globalSearchInput">Search</label>' +
      '<input type="search" id="globalSearchInput" placeholder="Search products, clients, suppliers, contracts…" autocomplete="off" />' +
      '<div id="globalSearchResults" class="global-search-results" style="display:none;" role="listbox"></div>';
    main.insertBefore(wrap, main.firstChild);
    var input = document.getElementById('globalSearchInput');
    var results = document.getElementById('globalSearchResults');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { results.style.display = 'none'; return; }
      timer = setTimeout(function () {
        fetch('/api/search?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var html = '';
            (data.products || []).forEach(function (p) {
              html += '<a href="products.html" class="gs-item">Product: ' + p.name + '</a>';
            });
            (data.clients || []).forEach(function (c) {
              html += '<a href="clients.html" class="gs-item">Client: ' + c.companyName + '</a>';
            });
            (data.suppliers || []).forEach(function (s) {
              html += '<a href="supplier.html" class="gs-item">Supplier: ' + s.companyName + '</a>';
            });
            (data.contracts || []).forEach(function (c) {
              html += '<a href="sales-contract.html" class="gs-item">Contract: ' + (c.contractNumber || c._id) + '</a>';
            });
            (data.indents || []).forEach(function (i) {
              html += '<a href="indent.html" class="gs-item">Indent: ' + (i.indentNumber || i._id) + '</a>';
            });
            (data.shipments || []).forEach(function (s) {
              html += '<a href="shipment.html" class="gs-item">Shipment: ' + (s.shipmentNumber || s.blNumber || s._id) + '</a>';
            });
            (data.invoices || []).forEach(function (inv) {
              html += '<a href="invoices.html" class="gs-item">Invoice: ' + (inv.invoiceNumber || inv._id) + '</a>';
            });
            results.innerHTML = html || '<div class="gs-empty">No results</div>';
            results.style.display = 'block';
          });
      }, 250);
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) results.style.display = 'none';
    });
  }

  function bindLogout() {
    var link = document.getElementById('logoutLink');
    if (!link || link.dataset.bound === '1') return;
    link.dataset.bound = '1';
    link.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/logout', { method: 'POST' }).finally(function () {
        window.location.href = '/login.html';
      });
    });
  }

  injectGroupedSidebar();
  ensureMobileTopbar();
  bindLockedClickCapture();

  window.triAuth = {
    user: null,
    permissions: {},
    adminOverride: { active: false },
    can: function (key) {
      if (!this.user) return false;
      if (this.user.role === 'admin') return true;
      if (this.permissions && this.permissions[key]) return true;
      if ((key === 'canEdit' || key === 'canDelete' || key === 'canEmail') && overrideActive()) return true;
      return false;
    },
    requestUnlock: openAdminUnlockModal,
    clearUnlock: clearAdminOverride,
    refreshPermissions: applyActionPermissions,
  };

  window.triAuthReady = fetch('/api/auth/check')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.authenticated) {
        window.location.href = '/login.html';
        return null;
      }
      window.triAuth.user = data.user;
      window.triAuth.permissions = (data.user && data.user.permissions) || {};
      window.triAuth.adminOverride = data.adminOverride || { active: false };
      applyNavVisibility(data.user);
      applyActionPermissions();
      initGlobalSearch();
      bindLogout();
      if (window.triMobile && window.triMobile.refresh) window.triMobile.refresh();

      var page = getCurrentPage();
      var requiredPerm = PAGE_PERMISSIONS[page];
      if (requiredPerm && data.user.role !== 'admin' && !window.triAuth.permissions[requiredPerm]) {
        if (window.triToast) triToast('You do not have access to this page.', 'error');
        else alert('You do not have access to this page.');
        window.location.href = '/index.html';
        return null;
      }
      return data.user;
    })
    .catch(function () {
      window.location.href = '/login.html';
      return null;
    });
})();
