/**
 * Full product add form for use inside supplier/client modals and inline link composers.
 */
(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function formHtml(prefix) {
    const p = prefix || 'np';
    return `
      <div class="product-modal-form" data-prefix="${p}">
        <div class="pmf-block">
          <label>Categories <span class="form-hint">(select at least one)</span></label>
          <div id="${p}Categories" class="form-checkbox-list pmf-categories"></div>
          <div class="pmf-new-category-row">
            <input type="text" id="${p}NewCat" placeholder="New category name" />
            <button type="button" class="action-btn ${p}-add-cat-btn">Add</button>
          </div>
        </div>
        <label for="${p}HsCode">HS Code *</label>
        <input type="text" id="${p}HsCode" list="${p}HsList" required />
        <datalist id="${p}HsList"></datalist>
        <label for="${p}Name">Product Name *</label>
        <input type="text" id="${p}Name" required autocomplete="off" />
        <label for="${p}Packing">Packing *</label>
        <input type="text" id="${p}Packing" required />
        <label for="${p}ProductNote">Product note</label>
        <textarea id="${p}ProductNote" rows="2"></textarea>
        <label for="${p}OtherDocs">Other documents</label>
        <input type="file" id="${p}OtherDocs" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
        <div class="pmf-tax-row">
          <div>
            <label for="${p}ImportDuty">Import Duty (%)</label>
            <input type="number" id="${p}ImportDuty" step="0.01" value="0" />
          </div>
          <div>
            <label for="${p}IncomeTax">Income Tax (%)</label>
            <input type="number" id="${p}IncomeTax" step="0.01" value="0" />
          </div>
          <div>
            <label for="${p}SalesTax">Sales Tax (%)</label>
            <input type="number" id="${p}SalesTax" step="0.01" value="0" />
          </div>
        </div>
        <label for="${p}LinkNotes">Link notes (optional)</label>
        <input type="text" id="${p}LinkNotes" placeholder="Notes for this product link" />
      </div>`;
  }

  async function loadCategories(box) {
    const res = await fetch('/api/product-categories');
    const names = await res.json();
    const seen = new Set();
    const unique = (names || []).filter((n) => {
      const k = (n || '').trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    box.innerHTML = unique.map((n) => `
      <label class="form-pick-row">
        <input type="checkbox" class="pm-cat-cb" value="${esc(n)}" />
        <span class="form-pick-name">${esc(n)}</span>
      </label>
    `).join('');
  }

  async function loadHsDatalist(listId) {
    try {
      const res = await fetch('/api/products/hs-codes/list');
      const codes = await res.json();
      const list = document.getElementById(listId);
      if (list) list.innerHTML = (codes || []).map((c) => `<option value="${esc(c)}">`).join('');
    } catch (_) { /* ignore */ }
  }

  async function mount(container, prefix) {
    const p = prefix || 'np';
    container.innerHTML = formHtml(p);
    const catBox = document.getElementById(p + 'Categories');
    await loadCategories(catBox);
    await loadHsDatalist(p + 'HsList');

    container.querySelector('.' + p + '-add-cat-btn').onclick = () => {
      const inp = document.getElementById(p + 'NewCat');
      const v = (inp.value || '').trim();
      if (!v) return;
      const existingCb = Array.from(catBox.querySelectorAll('.pm-cat-cb')).find((cb) => cb.value.toLowerCase() === v.toLowerCase());
      if (existingCb) {
        existingCb.checked = true;
        inp.value = '';
        return;
      }
      const label = document.createElement('label');
      label.className = 'form-pick-row';
      label.innerHTML = `<input type="checkbox" class="pm-cat-cb" value="${esc(v)}" checked /><span class="form-pick-name">${esc(v)}</span>`;
      catBox.appendChild(label);
      inp.value = '';
      const labels = [...catBox.querySelectorAll('label.form-pick-row')];
      labels.sort((a, b) => (a.textContent || '').localeCompare(b.textContent || ''));
      labels.forEach((l) => catBox.appendChild(l));
    };

    const nameInput = document.getElementById(p + 'Name');
    if (nameInput && global.TriForm && TriForm.initDuplicateNameCheck) {
      TriForm.initDuplicateNameCheck(nameInput, 'products');
    }

    return {
      async submitProduct() {
        const nameEl = document.getElementById(p + 'Name');
        if (nameEl && nameEl.dataset.duplicateId) {
          throw new Error('A product with this name is already added.');
        }
        const cats = Array.from(catBox.querySelectorAll('.pm-cat-cb:checked')).map((cb) => cb.value);
        if (!cats.length) throw new Error('Select at least one category');
        const name = nameEl.value.trim();
        if (!name) throw new Error('Product name is required');
        const fd = new FormData();
        fd.append('categories', JSON.stringify(cats));
        fd.append('name', name);
        fd.append('hsCode', document.getElementById(p + 'HsCode').value.trim());
        fd.append('packing', document.getElementById(p + 'Packing').value.trim());
        fd.append('productNote', document.getElementById(p + 'ProductNote').value.trim());
        fd.append('importDuty', document.getElementById(p + 'ImportDuty').value || '0');
        fd.append('incomeTax', document.getElementById(p + 'IncomeTax').value || '0');
        fd.append('salesTax', document.getElementById(p + 'SalesTax').value || '0');
        const docs = document.getElementById(p + 'OtherDocs');
        if (docs && docs.files) Array.from(docs.files).forEach((f) => fd.append('otherDocuments', f));
        const res = await fetch('/api/products', { method: 'POST', body: fd });
        const result = await res.json();
        if (res.status === 409) {
          throw new Error(result.error || 'A product with this name already exists.');
        }
        if (!res.ok) throw new Error(result.error || 'Failed to add product');
        return {
          productId: result.product?._id || result._id,
          linkNotes: document.getElementById(p + 'LinkNotes').value.trim(),
        };
      },
      reset() {
        container.querySelectorAll('input[type=text],input[type=number],textarea').forEach((el) => {
          if (el.id === p + 'Name') el.dataset.duplicateId = '';
          el.value = el.type === 'number' ? '0' : '';
        });
        const hint = container.querySelector('.duplicate-company-hint');
        if (hint) hint.classList.remove('visible');
        catBox.querySelectorAll('.pm-cat-cb').forEach((cb) => { cb.checked = false; });
        const docs = document.getElementById(p + 'OtherDocs');
        if (docs) docs.value = '';
      },
    };
  }

  global.TriProductForm = { mount, formHtml };
})(window);
