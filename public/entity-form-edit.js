(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function scrollToForm(formEl) {
    if (!formEl) return;
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setEditMode(formEl, config) {
    const cfg = config || {};
    const submitBtn = cfg.submitBtn || formEl.querySelector('button[type="submit"]');
    const cancelBtn = cfg.cancelBtn;
    const toggleBtn = cfg.toggleBtn;
    const nameInput = cfg.nameInput;

    if (cfg.editingId) {
      formEl.dataset.editingId = cfg.editingId;
      if (submitBtn) submitBtn.textContent = cfg.submitLabel || 'Save changes';
      if (cancelBtn) cancelBtn.style.display = '';
      if (toggleBtn) toggleBtn.textContent = 'Close Form';
      if (nameInput) nameInput.dataset.editExcludeId = cfg.editingId;
      formEl.style.display = 'block';
      scrollToForm(formEl);
    } else {
      delete formEl.dataset.editingId;
      if (submitBtn) submitBtn.textContent = cfg.addLabel || 'Add';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (nameInput) {
        delete nameInput.dataset.editExcludeId;
        delete nameInput.dataset.duplicateId;
        nameInput.classList.remove('input-duplicate-warning');
        nameInput.setAttribute('aria-invalid', 'false');
        const hint = document.getElementById(nameInput.getAttribute('aria-describedby') || '')
          || nameInput.parentNode.querySelector('.duplicate-company-hint');
        if (hint) {
          hint.classList.remove('visible');
          hint.textContent = '';
        }
      }
    }
  }

  function getEditingId(formEl) {
    return formEl && formEl.dataset.editingId ? formEl.dataset.editingId : null;
  }

  /**
   * Show current file(s) on edit — no extra upload fields, only links + optional remove.
   * Returns { getRemovedFiles(), clear() }
   */
  function bindExistingFiles(hintEl, files, options) {
    const opts = options || {};
    const single = opts.single !== false;
    const list = (files || []).filter(Boolean);
    const removed = new Set();

    function clear() {
      removed.clear();
      if (hintEl) {
        hintEl.innerHTML = '';
        hintEl.style.display = 'none';
      }
    }

    if (!hintEl) {
      return { getRemovedFiles: () => [], clear };
    }

    if (!list.length) {
      clear();
      return { getRemovedFiles: () => [], clear };
    }

    hintEl.style.display = 'block';
    hintEl.innerHTML = list.map((fn) => `
      <div class="existing-file-row" data-fn="${esc(fn)}">
        <span class="form-hint">Current: <a href="/uploads/${esc(fn)}" target="_blank" rel="noopener">${esc(fn)}</a></span>
        <button type="button" class="action-btn existing-file-remove-btn">Remove</button>
      </div>
    `).join('');

    hintEl.querySelectorAll('.existing-file-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.existing-file-row');
        const fn = row && row.getAttribute('data-fn');
        if (!fn) return;
        if (removed.has(fn)) {
          removed.delete(fn);
          row.classList.remove('marked-remove');
          btn.textContent = 'Remove';
        } else {
          if (single) {
            removed.clear();
            hintEl.querySelectorAll('.existing-file-row').forEach((r) => {
              r.classList.remove('marked-remove');
              const b = r.querySelector('.existing-file-remove-btn');
              if (b) b.textContent = 'Remove';
            });
          }
          removed.add(fn);
          row.classList.add('marked-remove');
          btn.textContent = 'Undo';
        }
      });
    });

    return {
      getRemovedFiles: () => Array.from(removed),
      clear,
    };
  }

  function resetFormToAdd(formEl, config) {
    const cfg = config || {};
    formEl.reset();
    if (cfg.contactsWidget && cfg.contactsWidget.reset) cfg.contactsWidget.reset();
    if (cfg.linkComposer && cfg.linkComposer.reset) cfg.linkComposer.reset();
    if (cfg.fileState && cfg.fileState.clear) cfg.fileState.clear();
    if (cfg.onReset) cfg.onReset();
    setEditMode(formEl, {
      editingId: null,
      submitBtn: cfg.submitBtn,
      cancelBtn: cfg.cancelBtn,
      toggleBtn: cfg.toggleBtn,
      nameInput: cfg.nameInput,
      addLabel: cfg.addLabel,
    });
  }

  global.TriFormEdit = {
    scrollToForm,
    setEditMode,
    getEditingId,
    resetFormToAdd,
    bindExistingFiles,
  };
})(typeof window !== 'undefined' ? window : global);
