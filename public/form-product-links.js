/**
 * Product link UI for supplier & client forms — mirrors client-link UX on the products form.
 */
(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function $(id) { return document.getElementById(id); }

  function createProductLinksController(config) {
    const cfg = config || {};
    const ids = cfg.ids || {};
    let productList = [];
    let drafts = [];
    let savedLinks = [];
    let linkedIds = new Set();
    let inlineProductFormApi = null;

    function el(name) { return $(ids[name]); }

    function syncLinkedIds() {
      linkedIds = new Set();
      savedLinks.forEach((l) => {
        const pid = l.productId?._id || l.productId;
        if (pid) linkedIds.add(String(pid));
      });
      drafts.forEach((d) => linkedIds.add(String(d.productId)));
    }

    function deleteLinkApi(linkId) {
      if (cfg.entityType === 'supplier') {
        return fetch(`/api/supplier-products/${linkId}`, { method: 'DELETE' });
      }
      return fetch(`/api/product-clients/${linkId}`, { method: 'DELETE' });
    }

    function updateComposerVisibility() {
      const composer = el('composer');
      const addBtn = el('addAnother');
      if (!composer || !addBtn) return;
      if (drafts.length === 0) {
        composer.style.display = 'block';
        addBtn.style.display = 'none';
        addBtn.dataset.wantsNext = '';
      } else if (addBtn.dataset.wantsNext === '1') {
        composer.style.display = 'block';
        addBtn.style.display = 'none';
      } else {
        composer.style.display = 'none';
        addBtn.style.display = 'inline-block';
      }
    }

    function renderSavedLinks() {
      const listEl = el('existingList');
      if (!listEl) return;
      if (!savedLinks.length) {
        listEl.innerHTML = '';
        return;
      }
      listEl.innerHTML = `
        <p class="form-hint saved-links-label">Linked products (saved):</p>
        ${savedLinks.map((l) => {
          const name = l.productId?.name || 'Product';
          return `<span class="draft-chip is-saved">${esc(name)} <button type="button" class="action-btn fpl-remove-saved" data-id="${esc(l._id)}">Remove</button></span>`;
        }).join('')}
      `;
      listEl.querySelectorAll('.fpl-remove-saved').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Remove this product link?')) return;
          const res = await deleteLinkApi(btn.getAttribute('data-id'));
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to remove link');
            return;
          }
          savedLinks = savedLinks.filter((l) => String(l._id) !== String(btn.getAttribute('data-id')));
          syncLinkedIds();
          renderSavedLinks();
          renderCheckboxList();
        };
      });
    }

    function renderDrafts() {
      const listEl = el('draftsList');
      if (!listEl) return;
      if (!drafts.length) {
        listEl.innerHTML = '';
        updateComposerVisibility();
        renderCheckboxList();
        return;
      }
      listEl.innerHTML = drafts.map((d, i) => {
        const name = (productList.find((p) => String(p._id) === String(d.productId)) || {}).name || d.productId;
        return `<span class="draft-chip">${esc(name)} <button type="button" class="action-btn fpl-remove-draft" data-i="${i}">Remove</button></span>`;
      }).join('');
      listEl.querySelectorAll('.fpl-remove-draft').forEach((btn) => {
        btn.onclick = () => {
          drafts.splice(Number(btn.dataset.i), 1);
          syncLinkedIds();
          renderDrafts();
        };
      });
      updateComposerVisibility();
      renderCheckboxList();
    }

    function renderCheckboxList() {
      const box = el('checkboxList');
      if (!box) return;
      syncLinkedIds();
      box.innerHTML = productList.map((p) => {
        const id = String(p._id);
        const already = linkedIds.has(id);
        const rowClass = already ? 'form-pick-row is-already-added' : 'form-pick-row';
        const disabledAttr = already ? ' disabled' : '';
        const titleAttr = already
          ? ' title="Already saved for this record — remove from the list above to select again"'
          : '';
        return `<label class="${rowClass}"${titleAttr}><input type="checkbox" class="fpl-pick-cb" value="${esc(id)}"${disabledAttr} /><span class="form-pick-name">${esc(p.name)}</span></label>`;
      }).join('');
      box.querySelectorAll('.fpl-pick-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          if (cb.disabled) return;
          if (cb.checked) {
            box.querySelectorAll('.fpl-pick-cb').forEach((o) => {
              if (o !== cb && !o.disabled) o.checked = false;
            });
          }
        });
      });
    }

    function clearComposerInputs() {
      const box = el('checkboxList');
      if (box) box.querySelectorAll('.fpl-pick-cb:not(:disabled)').forEach((cb) => { cb.checked = false; });
    }

    async function loadProducts() {
      try {
        const res = await fetch('/api/products');
        const data = await res.json();
        productList = Array.isArray(data) ? data : (data.items || []);
      } catch (_) {
        productList = [];
      }
      renderCheckboxList();
    }

    function reset() {
      drafts = [];
      savedLinks = [];
      linkedIds.clear();
      const existing = el('existingList');
      if (existing) existing.innerHTML = '';
      const inline = el('inlineForm');
      if (inline) inline.style.display = 'none';
      if (inlineProductFormApi && inlineProductFormApi.reset) inlineProductFormApi.reset();
      renderSavedLinks();
      renderDrafts();
      updateComposerVisibility();
    }

    function setExistingLinks(links) {
      savedLinks = (links || []).slice();
      syncLinkedIds();
      renderSavedLinks();
      renderCheckboxList();
      updateComposerVisibility();
    }

    function getDrafts() { return drafts.slice(); }

    async function saveDraftsForEntity(entityId) {
      for (const d of drafts) {
        if (cfg.entityType === 'supplier') {
          const fd = new FormData();
          fd.append('productId', d.productId);
          fd.append('supplierId', entityId);
          await fetch('/api/supplier-products', { method: 'POST', body: fd });
        } else {
          await fetch('/api/product-clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: d.productId, clientId: entityId }),
          });
        }
      }
      drafts = [];
      renderDrafts();
    }

    async function init() {
      await loadProducts();

      const toggleBtn = el('toggleInline');
      const inlineForm = el('inlineForm');
      if (toggleBtn && inlineForm) {
        toggleBtn.onclick = () => {
          inlineForm.style.display = inlineForm.style.display === 'none' ? 'block' : 'none';
        };
      }

      const cancelBtn = el('inlineCancel');
      if (cancelBtn && inlineForm) {
        cancelBtn.onclick = () => {
          inlineForm.style.display = 'none';
          if (inlineProductFormApi && inlineProductFormApi.reset) inlineProductFormApi.reset();
        };
      }

      const mount = el('inlineMount');
      if (mount && global.TriProductForm) {
        global.TriProductForm.mount(mount, cfg.productFormPrefix || 'fpl').then((api) => {
          inlineProductFormApi = api;
        });
      }

      const inlineSave = el('inlineSave');
      if (inlineSave) {
        inlineSave.onclick = async () => {
          if (!inlineProductFormApi) { alert('Product form still loading…'); return; }
          try {
            const { productId } = await inlineProductFormApi.submitProduct();
            if (!productId) { alert('Product added but could not link.'); return; }
            drafts.push({ productId });
            clearComposerInputs();
            const addBtn = el('addAnother');
            if (addBtn) addBtn.dataset.wantsNext = '';
            if (inlineForm) inlineForm.style.display = 'none';
            inlineProductFormApi.reset();
            await loadProducts();
            if (global.TriNewEntry) global.TriNewEntry.notifyNewEntry('product');
            syncLinkedIds();
            renderDrafts();
          } catch (err) {
            alert(err.message || 'Failed to add product');
          }
        };
      }

      const saveDraftBtn = el('saveDraft');
      if (saveDraftBtn) {
        saveDraftBtn.onclick = () => {
          const box = el('checkboxList');
          const picked = box && box.querySelector('.fpl-pick-cb:checked');
          if (!picked || picked.disabled) {
            alert('Select a product using the checkbox.');
            return;
          }
          drafts.push({ productId: picked.value });
          clearComposerInputs();
          const addBtn = el('addAnother');
          if (addBtn) addBtn.dataset.wantsNext = '';
          syncLinkedIds();
          renderDrafts();
        };
      }

      const addAnother = el('addAnother');
      if (addAnother) {
        addAnother.onclick = () => {
          addAnother.dataset.wantsNext = '1';
          updateComposerVisibility();
        };
      }

      updateComposerVisibility();
    }

    return { init, reset, setExistingLinks, getDrafts, saveDraftsForEntity, loadProducts };
  }

  global.TriFormProductLinks = { create: createProductLinksController };
})(typeof window !== 'undefined' ? window : global);
