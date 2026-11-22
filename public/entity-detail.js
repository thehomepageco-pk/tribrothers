(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function val(v) {
    if (v == null || v === '') return '—';
    return esc(v);
  }

  function row(label, value) {
    return `<tr><th>${esc(label)}</th><td>${value == null || value === '' ? '—' : value}</td></tr>`;
  }

  function linkRow(label, url, text) {
    if (!url && !text) return row(label, '—');
    const href = url || text;
    const display = text || url;
    return row(label, `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(display)}</a>`);
  }

  function fileLink(fn) {
    if (!fn) return '—';
    return `<a href="/uploads/${esc(fn)}" target="_blank" rel="noopener">${esc(fn)}</a>`;
  }

  function docsLinks(arr) {
    if (!arr || !arr.length) return '—';
    return arr.map((fn) => fileLink(fn)).join('<br/>');
  }

  function contactsFullHtml(list) {
    const cps = Array.isArray(list) ? list : [];
    if (!cps.length) return '—';
    return cps.map((cp, i) => {
      if (typeof cp === 'string') return `<div class="detail-contact-block">${esc(cp)}</div>`;
      const rows = [
        ['Name', cp.name],
        ['Department', cp.department],
        ['Email', cp.email],
        ['Tel', cp.tel],
        ['Mobile', cp.mobile],
        ['WeChat', cp.wechat],
        ['Facebook', cp.facebook],
        ['Whatsapp', cp.whatsapp],
        ['Other social', cp.otherSocial],
      ].filter(([, v]) => v != null && v !== '');
      if (!rows.length) return `<div class="detail-contact-block"><em>Contact ${i + 1}</em></div>`;
      return `<div class="detail-contact-block"><strong>Contact ${i + 1}</strong><table class="entity-detail-subtable">${rows.map(([l, v]) => row(l, val(v))).join('')}</table></div>`;
    }).join('');
  }

  function section(title, body) {
    return `<h3 class="entity-detail-section">${esc(title)}</h3><table class="entity-detail-table">${body}</table>`;
  }

  function openDetailModal(title, bodyHtml) {
    let overlay = document.getElementById('entityDetailOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'entityDetailOverlay';
      overlay.className = 'view-modal-overlay';
      overlay.innerHTML = `
        <div class="view-modal-box entity-detail-box">
          <div class="view-modal-header">
            <h2 id="entityDetailTitle"></h2>
            <button type="button" class="action-btn" id="entityDetailClose" aria-label="Close">×</button>
          </div>
          <div class="view-modal-body" id="entityDetailBody"></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
      document.getElementById('entityDetailClose').onclick = () => { overlay.style.display = 'none'; };
    }
    document.getElementById('entityDetailTitle').textContent = title;
    document.getElementById('entityDetailBody').innerHTML = bodyHtml;
    overlay.style.display = 'flex';
  }

  async function viewProduct(id) {
    const [res, supRes, cliRes] = await Promise.all([
      fetch(`/api/products/${id}`),
      fetch(`/api/products/${id}/linked-suppliers`),
      fetch(`/api/products/${id}/linked-clients`),
    ]);
    const p = await res.json();
    if (!res.ok) { alert(p.error || 'Failed to load'); return; }
    const supplierLinks = supRes.ok ? await supRes.json() : [];
    const clientLinks = cliRes.ok ? await cliRes.json() : [];
    const cats = (p.categories && p.categories.length) ? p.categories.join(', ') : (p.category || '');

    let supplierSection = '<p class="form-hint">No supplier links.</p>';
    if (supplierLinks.length) {
      supplierSection = `<table class="entity-detail-table"><thead><tr><th>Supplier</th><th>Notes</th><th>Product info file</th><th>Packing image</th></tr></thead><tbody>${supplierLinks.map((l) => `
        <tr>
          <td>${val(l.supplierId?.companyName)}</td>
          <td>${val(l.notes)}</td>
          <td>${fileLink(l.productInfoFile)}</td>
          <td>${fileLink(l.packingImage)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    let clientSection = '<p class="form-hint">No client links.</p>';
    if (clientLinks.length) {
      clientSection = `<table class="entity-detail-table"><thead><tr><th>Client</th><th>Notes</th></tr></thead><tbody>${clientLinks.map((l) => `
        <tr>
          <td>${val(l.clientId?.companyName)}</td>
          <td>${val(l.notes)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    openDetailModal('Product — ' + (p.name || ''), `
      ${section('Product details', `
        ${row('Name', val(p.name))}
        ${row('Categories', val(cats))}
        ${row('HS Code', val(p.hsCode))}
        ${row('Packing', val(p.packing))}
        ${row('Specs', val(p.specs))}
        ${row('Specification', val(p.specification))}
        ${row('Import duty', p.importDuty != null ? esc(p.importDuty) + '%' : '—')}
        ${row('Income tax', p.incomeTax != null ? esc(p.incomeTax) + '%' : '—')}
        ${row('Sales tax', p.salesTax != null ? esc(p.salesTax) + '%' : '—')}
        ${row('Product note', val(p.productNote))}
        ${row('Packing picture', fileLink(p.packingPic))}
        ${row('Other documents', docsLinks(p.otherDocuments))}
      `)}
      <h3 class="entity-detail-section">Linked suppliers</h3>${supplierSection}
      <h3 class="entity-detail-section">Linked clients</h3>${clientSection}
    `);
  }

  async function viewSupplier(id) {
    const [res, linksRes] = await Promise.all([
      fetch(`/api/suppliers/${id}`),
      fetch(`/api/suppliers/${id}/products`),
    ]);
    const s = await res.json();
    if (!res.ok) { alert(s.error || 'Failed to load'); return; }
    const links = linksRes.ok ? await linksRes.json() : [];

    let productSection = '<p class="form-hint">No product links.</p>';
    if (links.length) {
      productSection = `<table class="entity-detail-table"><thead><tr><th>Product</th><th>Category</th><th>HS Code</th><th>Notes</th></tr></thead><tbody>${links.map((l) => `
        <tr>
          <td>${val(l.productId?.name)}</td>
          <td>${val(l.productId?.category)}</td>
          <td>${val(l.productId?.hsCode)}</td>
          <td>${val(l.notes)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    openDetailModal('Supplier — ' + (s.companyName || ''), `
      ${section('Company details', `
        ${row('Company name', val(s.companyName))}
        ${row('Country', val(s.country))}
        ${row('Address', val(s.address))}
        ${row('Post code', val(s.postCode))}
        ${row('City', val(s.city))}
        ${row('Province', val(s.province))}
        ${linkRow('Web', s.web, s.web)}
        ${row('Visiting card', fileLink(s.productSpecsFile))}
      `)}
      <h3 class="entity-detail-section">Contact person(s)</h3>
      <div class="entity-detail-contacts">${contactsFullHtml(s.contactPersons)}</div>
      <h3 class="entity-detail-section">Linked products</h3>${productSection}
    `);
  }

  async function viewClient(id) {
    const [res, linksRes] = await Promise.all([
      fetch(`/api/clients/${id}`),
      fetch(`/api/clients/${id}/products`),
    ]);
    const c = await res.json();
    if (!res.ok) { alert(c.error || 'Failed to load'); return; }
    const links = linksRes.ok ? await linksRes.json() : [];

    let productSection = '<p class="form-hint">No product links.</p>';
    if (links.length) {
      productSection = `<table class="entity-detail-table"><thead><tr><th>Product</th><th>Notes</th></tr></thead><tbody>${links.map((l) => `
        <tr>
          <td>${val(l.productId?.name)}</td>
          <td>${val(l.notes)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    openDetailModal('Client — ' + (c.companyName || ''), `
      ${section('Company details', `
        ${row('Company name', val(c.companyName))}
        ${row('Country', val(c.country))}
        ${row('Address', val(c.address))}
        ${row('Post code', val(c.postCode))}
        ${row('City', val(c.city))}
        ${row('Province', val(c.province))}
        ${row('Tel', val(c.tel))}
        ${row('Mobile', val(c.mobile))}
        ${row('Company email', val(c.email))}
        ${linkRow('Web', c.web, c.web)}
        ${row('WeChat', val(c.wechat))}
        ${row('Facebook', val(c.facebook))}
        ${row('Whatsapp', val(c.whatsapp))}
        ${row('Other social', val(c.others))}
        ${row('Notes', val(c.notes))}
        ${row('NTN #', c.ntnNumber || '—')}
        ${row('NTN file', fileLink(c.ntnFile))}
      `)}
      <h3 class="entity-detail-section">Contact person(s)</h3>
      <div class="entity-detail-contacts">${contactsFullHtml(c.contactPersons)}</div>
      <h3 class="entity-detail-section">Linked products</h3>${productSection}
    `);
  }

  global.TriDetail = { viewProduct, viewSupplier, viewClient, openDetailModal };
})(window);
