/**
 * Tri Brothers — mobile shell: topbar, bottom nav, table cards, nav bindings.
 */
(function (global) {
  'use strict';

  var PAGE_TITLES = {
    'index.html': 'Dashboard',
    'products.html': 'Products',
    'supplier.html': 'Suppliers',
    'clients.html': 'Clients',
    'quotes.html': 'Quotations',
    'sales-contract.html': 'Sales Contract',
    'indent.html': 'Indent',
    'shipment.html': 'Shipment',
    'invoices.html': 'Invoices',
    'commissions.html': 'Commissions',
    'mail.html': 'Mail',
    'reports.html': 'Reports',
    'sessions.html': 'Sessions',
    'admin.html': 'Admin',
    'settings.html': 'Settings',
  };

  var BOTTOM_NAV = [
    { href: 'index.html', label: 'Home', icon: ['M3 10.5 12 3l9 7.5', 'M5 10v10h14V10'] },
    { href: 'sales-contract.html', label: 'Contracts', icon: ['M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z', 'M8 13h8', 'M8 17h5'] },
    { href: 'indent.html', label: 'Indents', icon: ['M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z', 'M8 13h8', 'M8 17h6'] },
    { href: 'invoices.html', label: 'Invoices', icon: ['M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z', 'M8 13h8', 'M8 17h5'] },
  ];

  function getCurrentPage() {
    var path = window.location.pathname || '';
    return path.split('/').pop() || 'index.html';
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function svgIcon(pathList) {
    var paths = Array.isArray(pathList) ? pathList : [pathList];
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths.map(function (d) {
      return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('') + '</svg>';
  }

  function getPageTitle() {
    var h1 = document.querySelector('.main .page-header h1, .main > h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return PAGE_TITLES[getCurrentPage()] || 'Tri Brothers';
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  function bindMobileNav() {
    if (document.body.dataset.mobileNavBound === '1') return;
    document.body.dataset.mobileNavBound = '1';

    document.querySelectorAll('.menu-toggle, #mobileTopbarMenu').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (document.body.classList.contains('sidebar-open')) closeSidebar();
        else openSidebar();
      });
    });

    document.querySelectorAll('.sidebar-close').forEach(function (btn) {
      btn.addEventListener('click', closeSidebar);
    });

    var overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);

    document.querySelectorAll('.sidebar a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href === '#' || href.indexOf('logout') !== -1) return;
      a.addEventListener('click', closeSidebar);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });
  }

  function integrateTopbar() {
    var topbar = document.getElementById('mobileTopbar');
    if (!topbar) return;

    var titleEl = topbar.querySelector('.mobile-topbar-title');
    if (titleEl) titleEl.textContent = getPageTitle();

    if (topbar.querySelector('#mobileTopbarMenu')) return;

    var pageToggle = document.querySelector('.menu-toggle');
    var menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.id = 'mobileTopbarMenu';
    menuBtn.className = 'mobile-topbar-menu';
    menuBtn.setAttribute('aria-label', 'Open menu');
    menuBtn.innerHTML = pageToggle && pageToggle.querySelector('.icon')
      ? pageToggle.querySelector('.icon').outerHTML
      : svgIcon(['M4 6h16', 'M4 12h16', 'M4 18h16']);
    topbar.insertBefore(menuBtn, topbar.firstChild);

    if (pageToggle) pageToggle.classList.add('menu-toggle-legacy');
  }

  function ensureBottomNav() {
    if (document.getElementById('mobileBottomNav')) return;
    if (!document.body.classList.contains('app-layout')) return;

    var nav = document.createElement('nav');
    nav.id = 'mobileBottomNav';
    nav.className = 'mobile-bottom-nav';
    nav.setAttribute('aria-label', 'Primary navigation');

    var page = getCurrentPage();
    var html = BOTTOM_NAV.map(function (item) {
      var active = page === item.href ? ' is-active' : '';
      return '<a href="' + item.href + '" class="mbn-item' + active + '">' +
        '<span class="mbn-icon">' + svgIcon(item.icon) + '</span>' +
        '<span class="mbn-label">' + item.label + '</span></a>';
    }).join('');

    html += '<button type="button" class="mbn-item mbn-more" id="mobileBottomNavMenu" aria-label="Open full menu">' +
      '<span class="mbn-icon">' + svgIcon(['M4 6h16', 'M4 12h16', 'M4 18h16']) + '</span>' +
      '<span class="mbn-label">Menu</span></button>';

    nav.innerHTML = html;
    document.body.appendChild(nav);

    document.getElementById('mobileBottomNavMenu').addEventListener('click', openSidebar);
  }

  function enhanceLineTables() {
    var lineLabels = {
      'inv-lines-table': ['Product', 'Description', 'Quantity', 'Unit', 'Unit price', ''],
      'ind-lines-table': ['Product line', 'Client', 'Quantity', 'NTN #', ''],
    };
    Object.keys(lineLabels).forEach(function (className) {
      document.querySelectorAll('.' + className).forEach(function (table) {
        var labels = lineLabels[className];
        table.querySelectorAll('tbody tr').forEach(function (tr) {
          tr.querySelectorAll('td').forEach(function (td, i) {
            if (!td.getAttribute('data-label') && labels[i]) td.setAttribute('data-label', labels[i]);
          });
        });
      });
    });
  }

  function enhanceTables() {
    enhanceLineTables();
    document.querySelectorAll('.table-wrap table').forEach(function (table) {
      var wrap = table.closest('.table-wrap');
      if (!wrap) return;

      var headers = [];
      table.querySelectorAll('thead th').forEach(function (th) {
        headers.push(th.textContent.replace(/\s+/g, ' ').trim());
      });

      var expandable = !!table.querySelector('.row-toggle');
      wrap.classList.toggle('table-expandable', expandable);

      table.querySelectorAll('tbody tr').forEach(function (tr) {
        if (tr.querySelector('td[colspan]')) {
          tr.classList.add('mobile-empty-row');
          return;
        }

        var cells = tr.querySelectorAll('td');
        cells.forEach(function (td, i) {
          if (td.classList.contains('checkbox-col')) return;

          if (!td.getAttribute('data-label')) {
            var label = headers[i] || '';
            if (!label && (td.classList.contains('cell-actions') || td.classList.contains('table-actions-cell'))) {
              label = 'Actions';
            }
            if (label) td.setAttribute('data-label', label);
          }

          if (!expandable && i === 0 && !td.classList.contains('cell-actions') && !td.classList.contains('table-actions-cell')) {
            td.classList.add('mobile-card-primary');
          }

          if (td.classList.contains('cell-actions') || td.classList.contains('table-actions-cell')) {
            td.classList.add('mobile-actions-cell');
          }
        });
      });

      table.dataset.mobileReady = '1';
    });
  }

  function observeTables() {
    if (window._triMobileTableObserver) return;
    var timer = null;
    window._triMobileTableObserver = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(enhanceTables, 60);
    });
    document.querySelectorAll('.table-wrap').forEach(function (wrap) {
      window._triMobileTableObserver.observe(wrap, { childList: true, subtree: true });
    });
  }

  function initMobileShell() {
    if (!document.body.classList.contains('app-layout')) return;
    integrateTopbar();
    ensureBottomNav();
    bindMobileNav();
    enhanceTables();
    observeTables();
    document.body.classList.add('mobile-shell-ready');
  }

  global.triMobile = {
    refresh: initMobileShell,
    enhanceTables: enhanceTables,
    getPageTitle: getPageTitle,
    isMobileViewport: isMobileViewport,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileShell);
  } else {
    initMobileShell();
  }
})(window);
