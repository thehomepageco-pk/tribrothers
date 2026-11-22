(function (global) {
  'use strict';

  const pageHandlers = {};
  let lastCheck = {};

  function ensureBanner() {
    let el = document.getElementById('triNewEntryBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'triNewEntryBanner';
    el.className = 'tri-new-entry-banner';
    el.innerHTML = `
      <span class="tri-new-entry-text"></span>
      <button type="button" class="action-btn tri-new-entry-dismiss">Dismiss</button>
      <button type="button" class="btn tri-new-entry-view">View new</button>`;
    document.body.appendChild(el);
    el.querySelector('.tri-new-entry-dismiss').onclick = () => dismissBanner(true);
    return el;
  }

  function currentPageType() {
    const p = (location.pathname || '').split('/').pop().toLowerCase() || '';
    if (p.includes('product')) return 'products';
    if (p.includes('supplier')) return 'suppliers';
    if (p.includes('client')) return 'clients';
    return null;
  }

  async function dismissNewFlag(type, id) {
    if (type === 'products') {
      return fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showAsNew: false }),
      });
    }
    const fd = new FormData();
    fd.append('showAsNew', 'false');
    const url = type === 'suppliers' ? `/api/suppliers/${id}` : `/api/clients/${id}`;
    return fetch(url, { method: 'PUT', body: fd });
  }

  async function dismissAllNew(info) {
    if (!info || !info.ids || !info.ids.length) return;
    await Promise.all(info.ids.map((id) => dismissNewFlag(info.type, id).catch(() => null)));
    if (info.type === 'products' && typeof global.loadProducts === 'function') global.loadProducts();
    if (info.type === 'suppliers' && typeof global.loadSuppliers === 'function') global.loadSuppliers();
    if (info.type === 'clients' && typeof global.loadClients === 'function') global.loadClients();
  }

  async function dismissBanner(clearFlags) {
    const banner = document.getElementById('triNewEntryBanner');
    if (banner) banner.classList.remove('visible');
    if (clearFlags) {
      const types = Object.keys(lastCheck);
      for (const t of types) {
        if (lastCheck[t] && lastCheck[t].count > 0) await dismissAllNew(lastCheck[t]);
      }
      lastCheck = {};
    }
  }

  async function handleViewNew(info) {
    if (!info || !info.count) return;
    const banner = document.getElementById('triNewEntryBanner');
    const onPage = currentPageType() === info.type;

    if (onPage && pageHandlers[info.type]) {
      await pageHandlers[info.type](info);
      await dismissAllNew(info);
      if (banner) banner.classList.remove('visible');
      lastCheck[info.type] = { ...info, count: 0, ids: [] };
      return;
    }

    sessionStorage.setItem('triPendingViewNew', info.type);
    if (!onPage) {
      window.location.href = info.href;
      return;
    }
    await dismissAllNew(info);
    if (banner) banner.classList.remove('visible');
  }

  function registerViewHandler(type, fn) {
    pageHandlers[type] = fn;
  }

  function consumePendingViewNew() {
    const type = sessionStorage.getItem('triPendingViewNew');
    if (!type) return;
    sessionStorage.removeItem('triPendingViewNew');
    const info = lastCheck[type];
    if (info && info.count > 0 && pageHandlers[type]) {
      setTimeout(async () => {
        await pageHandlers[type](info);
        await dismissAllNew(info);
        const banner = document.getElementById('triNewEntryBanner');
        if (banner) banner.classList.remove('visible');
        lastCheck[type] = { ...info, count: 0, ids: [] };
      }, 300);
    }
  }

  async function checkNewEntries(types) {
    const checks = [];
    if (!types || types.includes('products')) {
      checks.push(fetch('/api/products').then((r) => r.json()).then((list) => {
        const items = Array.isArray(list) ? list : (list.items || []);
        const fresh = items.filter((p) => p.showAsNew);
        return {
          type: 'products', label: 'product', count: fresh.length,
          ids: fresh.map((p) => String(p._id)),
          href: 'products.html',
        };
      }));
    }
    if (!types || types.includes('suppliers')) {
      checks.push(fetch('/api/suppliers').then((r) => r.json()).then((list) => {
        const items = Array.isArray(list) ? list : (list.items || []);
        const fresh = items.filter((s) => s.showAsNew);
        return {
          type: 'suppliers', label: 'supplier', count: fresh.length,
          ids: fresh.map((s) => String(s._id)),
          href: 'supplier.html',
        };
      }));
    }
    if (!types || types.includes('clients')) {
      checks.push(fetch('/api/clients').then((r) => r.json()).then((list) => {
        const items = Array.isArray(list) ? list : (list.items || []);
        const fresh = items.filter((c) => c.showAsNew);
        return {
          type: 'clients', label: 'client', count: fresh.length,
          ids: fresh.map((c) => String(c._id)),
          href: 'clients.html',
        };
      }));
    }
    const results = await Promise.all(checks);
    results.forEach((r) => { lastCheck[r.type] = r; });
    const total = results.reduce((n, r) => n + r.count, 0);
    if (total === 0) return;

    const banner = ensureBanner();
    const parts = results.filter((r) => r.count > 0).map((r) => `${r.count} new ${r.label}${r.count > 1 ? 's' : ''}`);
    banner.querySelector('.tri-new-entry-text').textContent = parts.join(', ') + ' since your last visit.';
    const primary = results.find((r) => r.count > 0);
    banner.querySelector('.tri-new-entry-view').onclick = () => handleViewNew(primary);
    banner.classList.add('visible');
    consumePendingViewNew();
  }

  function notifyNewEntry(label) {
    if (global.triToast) global.triToast.success('New ' + label + ' added');
    const banner = ensureBanner();
    banner.querySelector('.tri-new-entry-text').textContent = 'New ' + label + ' saved successfully.';
    banner.classList.add('visible');
  }

  global.TriNewEntry = {
    checkNewEntries,
    notifyNewEntry,
    registerViewHandler,
    consumePendingViewNew,
    dismissAllNew,
  };
})(window);
