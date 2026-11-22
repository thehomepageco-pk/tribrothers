(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  /**
   * Product link composer — mirrors client-link UX on the products form.
   */
  function createProductLinkComposer(options) {
    const cfg = options || {};
    let productList = [];
    let drafts = [];
    let savedLinks = [];
    const linkedIds = new Set();
    let inlineProductFormApi = null;

    function getDrafts() { return drafts.slice(); }

    function syncLinkedIds() {
      linkedIds.clear();
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

    function setExistingLinks(links) {
      savedLinks = (links || []).slice();
      syncLinkedIds();
      renderSavedLinks();
      render();
    }

    function renderSavedLinks() {
      const el = cfg.existingLinksEl;
      if (!el) return;
      if (!savedLinks.length) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.innerHTML = `
        <p class="form-hint saved-links-label">Linked products (saved):</p>
        ${savedLinks.map((l) => {
          const name = l.productId?.name || 'Product';
          const note = l.notes ? ` — ${esc(l.notes)}` : '';
          return `<span class="draft-chip is-saved">${esc(name)}${note} <button type="button" class="action-btn elc-remove-saved" data-id="${esc(l._id)}">Remove</button></span>`;
        }).join('')}
      `;
      el.querySelectorAll('.elc-remove-saved').forEach((btn) => {
        btn.onclick = async () => {
          const linkId = btn.getAttribute('data-id');
          if (!linkId) return;
          if (!confirm('Remove this product link?')) return;
          const res = await deleteLinkApi(linkId);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Failed to remove link');
            return;
          }
          savedLinks = savedLinks.filter((l) => String(l._id) !== String(linkId));
          syncLinkedIds();
          renderSavedLinks();
          render();
        };
      });
    }

    function reset() {
      drafts = [];
      savedLinks = [];
      linkedIds.clear();
      if (cfg.existingLinksEl) {
        cfg.existingLinksEl.innerHTML = '';
        cfg.existingLinksEl.style.display = 'none';
      }
      if (cfg.inlineFormEl) cfg.inlineFormEl.style.display = 'none';
      if (cfg.notesInputEl) cfg.notesInputEl.value = '';
      if (inlineProductFormApi && inlineProductFormApi.reset) inlineProductFormApi.reset();
      render();
    }

    function renderDrafts() {
      const el = cfg.draftsListEl;
      if (!el) return;
      if (!drafts.length) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = drafts.map((d, i) => {
        const name = (productList.find((p) => String(p._id) === String(d.productId)) || {}).name || d.productId;
        const note = d.notes ? ` — ${esc(d.notes)}` : '';
        return `<span class="draft-chip">${esc(name)}${note} <button type="button" class="action-btn elc-remove" data-i="${i}">Remove</button></span>`;
      }).join('');
      el.querySelectorAll('.elc-remove').forEach((btn) => {
        btn.onclick = () => {
          drafts.splice(Number(btn.dataset.i), 1);
          syncLinkedIds();
          render();
        };
      });
    }

    function renderCheckboxes() {
      const box = cfg.checkboxListEl;
      if (!box) return;
      syncLinkedIds();
      box.innerHTML = productList.map((p) => {
        const id = String(p._id);
        const already = linkedIds.has(id);
        const rowClass = already ? 'form-pick-row is-already-added' : 'form-pick-row';
        const disabledAttr = already ? ' disabled' : '';
        const titleAttr = already
          ? ' title="Already linked — remove from saved or draft list above to select again"'
          : '';
        return `<label class="${rowClass}"${titleAttr}><input type="checkbox" class="elc-pick-cb" value="${esc(id)}"${disabledAttr} /><span class="form-pick-name">${esc(p.name)}</span></label>`;
      }).join('');
      box.querySelectorAll('.elc-pick-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          if (cb.disabled) return;
          if (cb.checked) {
            box.querySelectorAll('.elc-pick-cb').forEach((o) => {
              if (o !== cb && !o.disabled) o.checked = false;
            });
          }
        });
      });
    }

    function updateComposerVisibility() {
      if (!cfg.composerEl || !cfg.addAnotherBtnEl) return;
      const pendingCount = drafts.length;
      if (pendingCount === 0) {
        cfg.composerEl.style.display = 'block';
        cfg.addAnotherBtnEl.style.display = 'none';
        cfg.addAnotherBtnEl.dataset.wantsNext = '';
      } else if (cfg.addAnotherBtnEl.dataset.wantsNext === '1') {
        cfg.composerEl.style.display = 'block';
        cfg.addAnotherBtnEl.style.display = 'none';
      } else {
        cfg.composerEl.style.display = 'none';
        cfg.addAnotherBtnEl.style.display = 'inline-block';
      }
    }

    function clearComposerInputs() {
      if (cfg.checkboxListEl) {
        cfg.checkboxListEl.querySelectorAll('.elc-pick-cb:not(:disabled)').forEach((cb) => { cb.checked = false; });
      }
      if (cfg.notesInputEl) cfg.notesInputEl.value = '';
    }

    function render() {
      renderDrafts();
      renderCheckboxes();
      updateComposerVisibility();
    }

    async function refreshProductList() {
      try {
        const res = await fetch('/api/products');
        const data = await res.json();
        productList = Array.isArray(data) ? data : (data.items || []);
      } catch (_) {
        productList = [];
      }
      render();
    }

    async function init() {
      await refreshProductList();

      if (cfg.toggleInlineBtnEl && cfg.inlineFormEl) {
        cfg.toggleInlineBtnEl.onclick = () => {
          const show = cfg.inlineFormEl.style.display === 'none';
          cfg.inlineFormEl.style.display = show ? 'block' : 'none';
        };
      }

      if (cfg.inlineCancelBtnEl && cfg.inlineFormEl) {
        cfg.inlineCancelBtnEl.onclick = () => {
          cfg.inlineFormEl.style.display = 'none';
          if (inlineProductFormApi && inlineProductFormApi.reset) inlineProductFormApi.reset();
        };
      }

      if (cfg.inlineFormMountEl && global.TriProductForm) {
        const prefix = cfg.entityType === 'supplier' ? 'sif' : 'cif';
        global.TriProductForm.mount(cfg.inlineFormMountEl, prefix).then((api) => {
          inlineProductFormApi = api;
        });
      }

      if (cfg.inlineSaveBtnEl) {
        cfg.inlineSaveBtnEl.onclick = async () => {
          if (!inlineProductFormApi) {
            alert('Product form still loading…');
            return;
          }
          try {
            const { productId, linkNotes } = await inlineProductFormApi.submitProduct();
            if (!productId) {
              alert('Product added but could not link.');
              return;
            }
            drafts.push({ productId, notes: linkNotes || '' });
            clearComposerInputs();
            if (cfg.addAnotherBtnEl) cfg.addAnotherBtnEl.dataset.wantsNext = '';
            if (cfg.inlineFormEl) cfg.inlineFormEl.style.display = 'none';
            inlineProductFormApi.reset();
            await refreshProductList();
            if (global.TriNewEntry) global.TriNewEntry.notifyNewEntry('product');
            syncLinkedIds();
            render();
          } catch (err) {
            alert(err.message || 'Failed to add product');
          }
        };
      }

      if (cfg.saveBtnEl) {
        cfg.saveBtnEl.onclick = () => {
          const picked = cfg.checkboxListEl && cfg.checkboxListEl.querySelector('.elc-pick-cb:checked');
          if (!picked || picked.disabled) {
            alert('Select a product using the checkbox.');
            return;
          }
          const notes = cfg.notesInputEl ? (cfg.notesInputEl.value || '').trim() : '';
          drafts.push({ productId: picked.value, notes });
          clearComposerInputs();
          if (cfg.addAnotherBtnEl) cfg.addAnotherBtnEl.dataset.wantsNext = '';
          syncLinkedIds();
          render();
        };
      }

      if (cfg.addAnotherBtnEl) {
        cfg.addAnotherBtnEl.onclick = () => {
          cfg.addAnotherBtnEl.dataset.wantsNext = '1';
          updateComposerVisibility();
        };
      }
    }

    async function saveLinksForEntity(entityId) {
      const results = [];
      for (const d of drafts) {
        try {
          if (cfg.entityType === 'supplier') {
            const fd = new FormData();
            fd.append('productId', d.productId);
            fd.append('supplierId', entityId);
            if (d.notes) fd.append('notes', d.notes);
            const res = await fetch('/api/supplier-products', { method: 'POST', body: fd });
            results.push(res.ok);
          } else {
            const res = await fetch('/api/product-clients', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                productId: d.productId,
                clientId: entityId,
                notes: d.notes || undefined,
              }),
            });
            results.push(res.ok);
          }
        } catch (_) {
          results.push(false);
        }
      }
      drafts = [];
      syncLinkedIds();
      renderDrafts();
      return results;
    }

    return {
      init, reset, render, getDrafts, setExistingLinks, saveLinksForEntity, refreshProductList,
    };
  }

  global.TriLinkComposer = { createProductLinkComposer };
})(typeof window !== 'undefined' ? window : global);
