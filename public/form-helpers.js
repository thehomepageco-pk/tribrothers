/**
 * Tri Brothers — shared form helpers (country picker, contacts, address datalists, file edit, duplicate check)
 */
(function (global) {
  'use strict';

  const COUNTRIES = [
    { name: 'Afghanistan', dial: '+93' }, { name: 'Albania', dial: '+355' }, { name: 'Algeria', dial: '+213' },
    { name: 'Andorra', dial: '+376' }, { name: 'Angola', dial: '+244' }, { name: 'Argentina', dial: '+54' },
    { name: 'Armenia', dial: '+374' }, { name: 'Australia', dial: '+61' }, { name: 'Austria', dial: '+43' },
    { name: 'Azerbaijan', dial: '+994' }, { name: 'Bahrain', dial: '+973' }, { name: 'Bangladesh', dial: '+880' },
    { name: 'Belarus', dial: '+375' }, { name: 'Belgium', dial: '+32' }, { name: 'Belize', dial: '+501' },
    { name: 'Benin', dial: '+229' }, { name: 'Bhutan', dial: '+975' }, { name: 'Bolivia', dial: '+591' },
    { name: 'Bosnia and Herzegovina', dial: '+387' }, { name: 'Botswana', dial: '+267' }, { name: 'Brazil', dial: '+55' },
    { name: 'Brunei', dial: '+673' }, { name: 'Bulgaria', dial: '+359' }, { name: 'Burkina Faso', dial: '+226' },
    { name: 'Cambodia', dial: '+855' }, { name: 'Cameroon', dial: '+237' }, { name: 'Canada', dial: '+1' },
    { name: 'Chile', dial: '+56' }, { name: 'China', dial: '+86' }, { name: 'Colombia', dial: '+57' },
    { name: 'Costa Rica', dial: '+506' }, { name: 'Croatia', dial: '+385' }, { name: 'Cuba', dial: '+53' },
    { name: 'Cyprus', dial: '+357' }, { name: 'Czech Republic', dial: '+420' }, { name: 'Denmark', dial: '+45' },
    { name: 'Dominican Republic', dial: '+1' }, { name: 'Ecuador', dial: '+593' }, { name: 'Egypt', dial: '+20' },
    { name: 'El Salvador', dial: '+503' }, { name: 'Estonia', dial: '+372' }, { name: 'Ethiopia', dial: '+251' },
    { name: 'Finland', dial: '+358' }, { name: 'France', dial: '+33' }, { name: 'Georgia', dial: '+995' },
    { name: 'Germany', dial: '+49' }, { name: 'Ghana', dial: '+233' }, { name: 'Greece', dial: '+30' },
    { name: 'Guatemala', dial: '+502' }, { name: 'Hong Kong', dial: '+852' }, { name: 'Hungary', dial: '+36' },
    { name: 'Iceland', dial: '+354' }, { name: 'India', dial: '+91' }, { name: 'Indonesia', dial: '+62' },
    { name: 'Iran', dial: '+98' }, { name: 'Iraq', dial: '+964' }, { name: 'Ireland', dial: '+353' },
    { name: 'Israel', dial: '+972' }, { name: 'Italy', dial: '+39' }, { name: 'Jamaica', dial: '+1' },
    { name: 'Japan', dial: '+81' }, { name: 'Jordan', dial: '+962' }, { name: 'Kazakhstan', dial: '+7' },
    { name: 'Kenya', dial: '+254' }, { name: 'Kuwait', dial: '+965' }, { name: 'Laos', dial: '+856' },
    { name: 'Latvia', dial: '+371' }, { name: 'Lebanon', dial: '+961' }, { name: 'Libya', dial: '+218' },
    { name: 'Lithuania', dial: '+370' }, { name: 'Luxembourg', dial: '+352' }, { name: 'Malaysia', dial: '+60' },
    { name: 'Maldives', dial: '+960' }, { name: 'Malta', dial: '+356' }, { name: 'Mexico', dial: '+52' },
    { name: 'Moldova', dial: '+373' }, { name: 'Monaco', dial: '+377' }, { name: 'Mongolia', dial: '+976' },
    { name: 'Morocco', dial: '+212' }, { name: 'Myanmar', dial: '+95' }, { name: 'Nepal', dial: '+977' },
    { name: 'Netherlands', dial: '+31' }, { name: 'New Zealand', dial: '+64' }, { name: 'Nigeria', dial: '+234' },
    { name: 'North Macedonia', dial: '+389' }, { name: 'Norway', dial: '+47' }, { name: 'Oman', dial: '+968' },
    { name: 'Pakistan', dial: '+92' }, { name: 'Palestine', dial: '+970' }, { name: 'Panama', dial: '+507' },
    { name: 'Paraguay', dial: '+595' }, { name: 'Peru', dial: '+51' }, { name: 'Philippines', dial: '+63' },
    { name: 'Poland', dial: '+48' }, { name: 'Portugal', dial: '+351' }, { name: 'Qatar', dial: '+974' },
    { name: 'Romania', dial: '+40' }, { name: 'Russia', dial: '+7' }, { name: 'Rwanda', dial: '+250' },
    { name: 'Saudi Arabia', dial: '+966' }, { name: 'Senegal', dial: '+221' }, { name: 'Serbia', dial: '+381' },
    { name: 'Singapore', dial: '+65' }, { name: 'Slovakia', dial: '+421' }, { name: 'Slovenia', dial: '+386' },
    { name: 'South Africa', dial: '+27' }, { name: 'South Korea', dial: '+82' }, { name: 'Spain', dial: '+34' },
    { name: 'Sri Lanka', dial: '+94' }, { name: 'Sudan', dial: '+249' }, { name: 'Sweden', dial: '+46' },
    { name: 'Switzerland', dial: '+41' }, { name: 'Syria', dial: '+963' }, { name: 'Taiwan', dial: '+886' },
    { name: 'Tanzania', dial: '+255' }, { name: 'Thailand', dial: '+66' }, { name: 'Tunisia', dial: '+216' },
    { name: 'Turkey', dial: '+90' }, { name: 'Uganda', dial: '+256' }, { name: 'Ukraine', dial: '+380' },
    { name: 'United Arab Emirates', dial: '+971' }, { name: 'United Kingdom', dial: '+44' },
    { name: 'United States', dial: '+1' }, { name: 'Uruguay', dial: '+598' }, { name: 'Uzbekistan', dial: '+998' },
    { name: 'Venezuela', dial: '+58' }, { name: 'Vietnam', dial: '+84' }, { name: 'Yemen', dial: '+967' },
    { name: 'Zambia', dial: '+260' }, { name: 'Zimbabwe', dial: '+263' }
  ];

  const dialByCountry = Object.fromEntries(COUNTRIES.map(c => [c.name.toLowerCase(), c.dial]));

  function escapeHtml(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function getDialCode(countryName) {
    return dialByCountry[(countryName || '').trim().toLowerCase()] || '';
  }

  function initCountryPicker(inputEl, options) {
    if (!inputEl || inputEl.dataset.countryPickerInit) return inputEl;
    inputEl.dataset.countryPickerInit = '1';
    const wrap = document.createElement('div');
    wrap.className = 'country-picker-wrap';
    inputEl.parentNode.insertBefore(wrap, inputEl);
    wrap.appendChild(inputEl);
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.placeholder = inputEl.placeholder || 'Search country…';

    const dropdown = document.createElement('div');
    dropdown.className = 'country-picker-dropdown';
    wrap.appendChild(dropdown);

    let highlightIdx = -1;

    function renderList(filter) {
      const q = (filter || '').trim().toLowerCase();
      const list = q
        ? COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.dial.includes(q))
        : COUNTRIES;
      highlightIdx = -1;
      if (!list.length) {
        dropdown.innerHTML = '<div class="country-picker-empty">No countries found</div>';
        return;
      }
      dropdown.innerHTML = list.map((c, i) =>
        `<div class="country-picker-option" data-idx="${i}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}<span class="dial">${escapeHtml(c.dial)}</span></div>`
      ).join('');
      dropdown._list = list;
    }

    function open() {
      renderList(inputEl.value);
      dropdown.classList.add('open');
    }

    function close() {
      dropdown.classList.remove('open');
      highlightIdx = -1;
    }

    function selectCountry(name) {
      inputEl.value = name;
      close();
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (options && typeof options.onSelect === 'function') options.onSelect(name, getDialCode(name));
    }

    inputEl.addEventListener('focus', open);
    inputEl.addEventListener('input', () => { open(); });
    inputEl.addEventListener('keydown', (e) => {
      const opts = dropdown.querySelectorAll('.country-picker-option');
      if (!dropdown.classList.contains('open')) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') open();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, opts.length - 1);
        opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
      } else if (e.key === 'Enter' && highlightIdx >= 0 && opts[highlightIdx]) {
        e.preventDefault();
        selectCountry(opts[highlightIdx].getAttribute('data-name'));
      } else if (e.key === 'Escape') {
        close();
      }
    });

    dropdown.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.country-picker-option');
      if (opt) {
        e.preventDefault();
        selectCountry(opt.getAttribute('data-name'));
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });

    return inputEl;
  }

  function bindDialCodeToPhones(countryInput, phoneInputs) {
    const phones = Array.isArray(phoneInputs) ? phoneInputs : [phoneInputs];
    function apply() {
      const dial = getDialCode(countryInput.value);
      if (!dial) return;
      phones.forEach(inp => {
        if (!inp) return;
        const v = (inp.value || '').trim();
        if (!v || v.startsWith('+')) {
          if (!v || !v.startsWith(dial)) {
            const rest = v.replace(/^\+\d+\s*/, '');
            inp.value = dial + (rest ? ' ' + rest : ' ');
          }
        } else {
          inp.value = dial + ' ' + v;
        }
      });
    }
    countryInput.addEventListener('change', apply);
    return apply;
  }

  async function loadAddressSuggestions(entityType) {
    const path = entityType === 'clients' ? '/api/clients/field-suggestions' : '/api/suppliers/field-suggestions';
    try {
      const res = await fetch(path);
      if (!res.ok) return { cities: [], postCodes: [], provinces: [] };
      return await res.json();
    } catch (_) {
      return { cities: [], postCodes: [], provinces: [] };
    }
  }

  function attachDatalist(inputEl, id, values) {
    if (!inputEl) return;
    let list = document.getElementById(id);
    if (!list) {
      list = document.createElement('datalist');
      list.id = id;
      document.body.appendChild(list);
    }
    list.innerHTML = (values || []).map(v => `<option value="${escapeHtml(v)}">`).join('');
    inputEl.setAttribute('list', id);
  }

  async function initAddressDatalists(formEl, entityType, prefix) {
    const p = prefix || '';
    const data = await loadAddressSuggestions(entityType);
    attachDatalist(formEl.querySelector(`[name="${p}city"], #${p}city`), `${entityType}-cities`, data.cities);
    attachDatalist(formEl.querySelector(`[name="${p}postCode"], #${p}postCode`), `${entityType}-postcodes`, data.postCodes);
    attachDatalist(formEl.querySelector(`[name="${p}province"], #${p}province`), `${entityType}-provinces`, data.provinces);
  }

  function createContactPersonsWidget(container, options) {
    const opts = options || {};
    const showTelMobile = opts.showTelMobile !== false;
    const contacts = [];

    container.classList.add('contact-persons-widget');
    // form="tri-cp-orphan" keeps these controls out of parent form HTML5 validation / FormData
    container.innerHTML = `
      <div class="cp-saved-list"></div>
      <div class="cp-entry-row${showTelMobile ? ' cp-with-phone' : ''}">
        <input type="text" class="cp-name" form="tri-cp-orphan" placeholder="Contact name" autocomplete="name" />
        <input type="text" class="cp-email" form="tri-cp-orphan" placeholder="Email" inputmode="email" autocomplete="email" />
        ${showTelMobile ? '<input type="text" class="cp-tel" form="tri-cp-orphan" placeholder="Tel" autocomplete="tel" /><input type="text" class="cp-mobile" form="tri-cp-orphan" placeholder="Mobile" autocomplete="tel" />' : ''}
      </div>
      <button type="button" class="btn cp-add-btn" form="tri-cp-orphan">Add contact</button>
    `;

    const savedList = container.querySelector('.cp-saved-list');
    const nameInp = container.querySelector('.cp-name');
    const emailInp = container.querySelector('.cp-email');
    const telInp = container.querySelector('.cp-tel');
    const mobileInp = container.querySelector('.cp-mobile');

    function renderSaved() {
      savedList.innerHTML = contacts.map((c, i) => {
        const parts = [escapeHtml(c.name || 'Unnamed')];
        if (c.email) parts.push(escapeHtml(c.email));
        if (c.tel) parts.push('Tel: ' + escapeHtml(c.tel));
        if (c.mobile) parts.push('Mob: ' + escapeHtml(c.mobile));
        return `<span class="cp-chip">${parts.join(' · ')} <button type="button" class="action-btn cp-remove" data-i="${i}">×</button></span>`;
      }).join('');
      savedList.querySelectorAll('.cp-remove').forEach(btn => {
        btn.onclick = () => {
          contacts.splice(Number(btn.dataset.i), 1);
          renderSaved();
        };
      });
    }

    function readPendingEntry() {
      const name = (nameInp.value || '').trim();
      const email = (emailInp.value || '').trim();
      const tel = (telInp && telInp.value || '').trim();
      const mobile = (mobileInp && mobileInp.value || '').trim();
      if (!name && !email && !tel && !mobile) return null;
      return {
        name: name || email || 'Contact',
        email,
        ...(showTelMobile ? { tel, mobile } : {}),
      };
    }

    function commitPending(optionsCommit) {
      const commitOpts = optionsCommit || {};
      const pending = readPendingEntry();
      if (!pending) return false;
      if (opts.countryInput && showTelMobile && (pending.tel || pending.mobile) && !commitOpts.skipCountryCheck) {
        const country = (opts.countryInput.value || '').trim();
        if (!country) {
          if (commitOpts.quiet) return false;
          alert('Please select a country first so phone numbers get the correct country code.');
          opts.countryInput.focus();
          return false;
        }
      }
      contacts.push(pending);
      nameInp.value = '';
      emailInp.value = '';
      if (telInp) telInp.value = '';
      if (mobileInp) mobileInp.value = '';
      renderSaved();
      return true;
    }

    container.querySelector('.cp-add-btn').onclick = () => {
      const name = (nameInp.value || '').trim();
      if (!name) { alert('Enter a contact name.'); return; }
      commitPending();
    };

    // Enter in contact fields adds the contact instead of submitting the parent form
    [nameInp, emailInp, telInp, mobileInp].filter(Boolean).forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = (nameInp.value || '').trim();
        if (!name) { alert('Enter a contact name.'); return; }
        commitPending();
      });
    });

    return {
      getContacts() { return contacts.slice(); },
      commitPending,
      hasPending() { return !!readPendingEntry(); },
      setContacts(list) {
        contacts.length = 0;
        (list || []).forEach(c => {
          if (typeof c === 'string') contacts.push({ name: c });
          else if (c && typeof c === 'object') contacts.push({ ...c });
        });
        renderSaved();
      },
      reset() {
        contacts.length = 0;
        renderSaved();
        nameInp.value = '';
        emailInp.value = '';
        if (telInp) telInp.value = '';
        if (mobileInp) mobileInp.value = '';
      }
    };
  }

  function initDuplicateNameCheck(inputEl, entityType, hintEl) {
    if (!inputEl) return;
    let timer = null;
    const apiPaths = {
      suppliers: '/api/suppliers/check-name',
      clients: '/api/clients/check-name',
      products: '/api/products/check-name',
    };
    const labels = {
      suppliers: 'Supplier',
      clients: 'Client',
      products: 'Product',
    };
    const displayKey = entityType === 'products' ? 'name' : 'companyName';
    const apiPath = apiPaths[entityType] || apiPaths.suppliers;
    const label = labels[entityType] || 'Record';
    const minLen = entityType === 'products' ? 1 : 2;
    const hint = hintEl || (() => {
      let h = inputEl.parentNode.querySelector('.duplicate-company-hint');
      if (!h) {
        h = document.createElement('div');
        h.className = 'duplicate-company-hint';
        h.setAttribute('role', 'alert');
        h.setAttribute('aria-live', 'polite');
        inputEl.parentNode.insertBefore(h, inputEl.nextSibling);
      }
      return h;
    })();

    function setDuplicateState(isDuplicate) {
      inputEl.classList.toggle('input-duplicate-warning', isDuplicate);
      inputEl.setAttribute('aria-invalid', isDuplicate ? 'true' : 'false');
    }

    function clearDuplicateState() {
      hint.classList.remove('visible');
      hint.textContent = '';
      inputEl.dataset.duplicateId = '';
      setDuplicateState(false);
    }

    async function runCheck() {
      const val = (inputEl.value || '').trim();
      if (val.length < minLen) {
        clearDuplicateState();
        return;
      }
      try {
        const excludeId = inputEl.dataset.editExcludeId || '';
        const qs = `name=${encodeURIComponent(val)}${excludeId ? `&excludeId=${encodeURIComponent(excludeId)}` : ''}`;
        const res = await fetch(`${apiPath}?${qs}`);
        if (!res.ok) {
          clearDuplicateState();
          return;
        }
        const data = await res.json();
        if (data.exists) {
          const existingName = data[displayKey] || val;
          const alreadyMsg = entityType === 'products'
            ? `Product "${existingName}" is already added.`
            : `${label} "${existingName}" is already added.`;
          hint.textContent = alreadyMsg;
          hint.classList.add('visible');
          inputEl.dataset.duplicateId = data.existingId || '1';
          setDuplicateState(true);
        } else {
          clearDuplicateState();
        }
      } catch (_) {
        clearDuplicateState();
      }
    }

    function scheduleCheck() {
      clearTimeout(timer);
      timer = setTimeout(runCheck, 300);
    }

    inputEl.addEventListener('input', scheduleCheck);
    inputEl.addEventListener('change', scheduleCheck);
    inputEl.addEventListener('blur', runCheck);

    return { runCheck, clearDuplicateState };
  }

  const initDuplicateCompanyCheck = initDuplicateNameCheck;

  function createFileEditPanel(cell, config) {
    const cfg = config || {};
    const files = (cfg.files || []).slice();
    const single = cfg.single === true;
    const removeSet = new Set();
    let replaceMode = false;

    const panel = document.createElement('div');
    panel.className = 'file-edit-panel';

    function render() {
      let html = '';
      if (files.length) {
        files.forEach(fn => {
          const marked = removeSet.has(fn);
          html += `<div class="file-edit-row${marked ? ' marked-remove' : ''}" data-fn="${escapeHtml(fn)}">
            <a href="/uploads/${escapeHtml(fn)}" target="_blank" rel="noopener">${escapeHtml(fn)}</a>
            <button type="button" class="action-btn file-remove-btn">${marked ? 'Undo' : 'Remove'}</button>
            ${single ? '<button type="button" class="action-btn file-replace-btn">Replace</button>' : ''}
          </div>`;
        });
      } else if (single) {
        html += '<p class="form-hint">No file uploaded</p>';
      }
      html += `<div class="file-edit-add">
        <label>${single ? 'Upload file' : 'Add file(s)'}</label>
        <input type="file" class="file-add-input" ${single ? '' : 'multiple'} accept="${escapeHtml(cfg.accept || '*')}" />
      </div>`;
      panel.innerHTML = html;

      panel.querySelectorAll('.file-remove-btn').forEach(btn => {
        btn.onclick = () => {
          const row = btn.closest('.file-edit-row');
          const fn = row.getAttribute('data-fn');
          if (removeSet.has(fn)) removeSet.delete(fn);
          else removeSet.add(fn);
          render();
        };
      });
      panel.querySelectorAll('.file-replace-btn').forEach(btn => {
        btn.onclick = () => {
          replaceMode = true;
          removeSet.clear();
          files.forEach(f => removeSet.add(f));
          render();
          const inp = panel.querySelector('.file-add-input');
          if (inp) inp.click();
        };
      });
    }

    render();
    cell.innerHTML = '';
    cell.appendChild(panel);

    return {
      getRemovedFiles() { return Array.from(removeSet); },
      getNewFiles() {
        const inp = panel.querySelector('.file-add-input');
        if (!inp || !inp.files) return [];
        return Array.from(inp.files);
      },
      hasNewFile() {
        const inp = panel.querySelector('.file-add-input');
        return inp && inp.files && inp.files.length > 0;
      },
      getNewFile() {
        const inp = panel.querySelector('.file-add-input');
        return inp && inp.files && inp.files[0] ? inp.files[0] : null;
      }
    };
  }

  function wireSupplierSpecsOnSelect(checkboxListSelector, specsBlockSelector) {
    const list = document.querySelector(checkboxListSelector);
    const block = document.querySelector(specsBlockSelector);
    if (!list || !block) return;
    function update() {
      const checked = list.querySelector('.sup-pick-cb:checked:not(:disabled)');
      block.classList.toggle('visible', !!checked);
    }
    list.addEventListener('change', (e) => {
      if (e.target.classList.contains('sup-pick-cb')) update();
    });
    update();
  }

  async function handleDuplicateResponse(res, result, entityType) {
    if (res.status !== 409) return false;
    alert(result.error || `${entityType === 'clients' ? 'Client' : 'Supplier'} already exists.`);
    return { existingId: result.existingId };
  }

  function initSearchableSelect(selectEl, options) {
    if (!selectEl) return null;
    if (selectEl._searchableSelectApi) return selectEl._searchableSelectApi;
    options = options || {};
    const placeholder = options.placeholder || 'Select…';
    const searchPlaceholder = options.searchPlaceholder || 'Search…';

    const wrap = document.createElement('div');
    wrap.className = 'searchable-select-wrap';
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('searchable-select-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'searchable-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    wrap.insertBefore(trigger, selectEl);

    const dropdown = document.createElement('div');
    dropdown.className = 'searchable-select-dropdown';
    dropdown.innerHTML =
      `<input type="search" class="searchable-select-search" placeholder="${escapeHtml(searchPlaceholder)}" autocomplete="off" />` +
      '<div class="searchable-select-options" role="listbox"></div>';
    wrap.appendChild(dropdown);

    const searchInput = dropdown.querySelector('.searchable-select-search');
    const optionsBox = dropdown.querySelector('.searchable-select-options');
    let highlightIdx = -1;
    let isOpen = false;

    function getOptions() {
      return Array.from(selectEl.options).filter((o) => options.showEmptyOption || o.value);
    }

    function selectedLabel() {
      const opt = selectEl.options[selectEl.selectedIndex];
      if (!opt || !opt.value) return placeholder;
      return opt.textContent;
    }

    function updateTrigger() {
      trigger.textContent = selectedLabel();
      trigger.classList.toggle('is-placeholder', !selectEl.value);
    }

    function renderOptions(filter) {
      const q = (filter || '').trim().toLowerCase();
      const opts = getOptions().filter((o) => {
        if (!q) return true;
        return (o.textContent || '').toLowerCase().includes(q) || (o.value || '').toLowerCase().includes(q);
      });
      highlightIdx = -1;
      if (!opts.length) {
        optionsBox.innerHTML = '<div class="searchable-select-empty">No results</div>';
        return;
      }
      optionsBox.innerHTML = opts.map((o, i) =>
        `<div class="searchable-select-option${selectEl.value === o.value ? ' selected' : ''}" data-value="${escapeHtml(o.value)}" data-idx="${i}">${escapeHtml(o.textContent)}</div>`
      ).join('');
      optionsBox._opts = opts;
    }

    function positionDropdown() {
      const rect = trigger.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.style.width = `${Math.max(rect.width, 220)}px`;
    }

    function open() {
      if (global._triOpenSearchableSelect && global._triOpenSearchableSelect !== api) {
        global._triOpenSearchableSelect.close();
      }
      global._triOpenSearchableSelect = api;
      renderOptions(searchInput.value);
      document.body.appendChild(dropdown);
      dropdown.classList.add('open');
      wrap.classList.add('open');
      isOpen = true;
      positionDropdown();
      setTimeout(() => searchInput.focus(), 0);
    }

    function close() {
      if (!isOpen) return;
      dropdown.classList.remove('open');
      wrap.classList.remove('open');
      searchInput.value = '';
      highlightIdx = -1;
      isOpen = false;
      wrap.appendChild(dropdown);
      if (global._triOpenSearchableSelect === api) global._triOpenSearchableSelect = null;
    }

    function selectValue(value) {
      selectEl.value = value;
      updateTrigger();
      close();
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) close();
      else open();
    });

    dropdown.addEventListener('mousedown', (e) => e.stopPropagation());
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    searchInput.addEventListener('input', () => renderOptions(searchInput.value));

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
      const items = optionsBox.querySelectorAll('.searchable-select-option');
      if (e.key === 'Escape') { close(); trigger.focus(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIdx = Math.max(highlightIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
        if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter' && highlightIdx >= 0 && items[highlightIdx]) {
        selectValue(items[highlightIdx].dataset.value);
      }
    });

    optionsBox.addEventListener('click', (e) => {
      const opt = e.target.closest('.searchable-select-option');
      if (opt) selectValue(opt.dataset.value);
    });

    const onDocClick = (e) => {
      if (wrap.contains(e.target) || dropdown.contains(e.target)) return;
      close();
    };
    document.addEventListener('click', onDocClick);

    const onReposition = () => {
      if (isOpen) positionDropdown();
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    selectEl.addEventListener('change', updateTrigger);

    const api = {
      refresh() {
        updateTrigger();
        if (isOpen) renderOptions(searchInput.value);
      },
      setValue(value) {
        selectEl.value = value;
        updateTrigger();
      },
      getValue() {
        return selectEl.value;
      },
      close,
      destroy() {
        document.removeEventListener('click', onDocClick);
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
        if (global._triOpenSearchableSelect === api) global._triOpenSearchableSelect = null;
        close();
        wrap.parentNode.insertBefore(selectEl, wrap);
        wrap.remove();
        if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
        selectEl.classList.remove('searchable-select-native');
        delete selectEl._searchableSelectApi;
      },
    };

    updateTrigger();
    selectEl._searchableSelectApi = api;
    return api;
  }

  function positionRowActionsDropdown(details) {
    const dropdown = details.querySelector('.row-actions-dropdown') || details._triDropdown;
    const summary = details.querySelector('summary');
    if (!dropdown || !summary) return;
    if (!details._triDropdown) details._triDropdown = dropdown;
    if (dropdown.parentNode !== document.body) {
      document.body.appendChild(dropdown);
    }
    const rect = summary.getBoundingClientRect();
    const width = Math.max(dropdown.offsetWidth || 180, 180);
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 4;
    const estimatedHeight = dropdown.offsetHeight || 220;
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - estimatedHeight - 4);
    }
    dropdown.classList.add('is-fixed');
    dropdown.style.left = left + 'px';
    dropdown.style.top = top + 'px';
    dropdown.style.right = 'auto';
    dropdown.style.display = 'flex';
  }

  function clearRowActionsDropdown(details) {
    const dropdown = (details && details._triDropdown) || (details && details.querySelector('.row-actions-dropdown'));
    if (!dropdown) return;
    dropdown.classList.remove('is-fixed');
    dropdown.style.left = '';
    dropdown.style.top = '';
    dropdown.style.right = '';
    dropdown.style.display = '';
    if (details && details.isConnected && dropdown.parentNode === document.body) {
      details.appendChild(dropdown);
    } else if (!details || !details.isConnected) {
      dropdown.remove();
    }
  }

  function closeAllRowActionsMenus() {
    document.querySelectorAll('details.row-actions-menu[open]').forEach(function (details) {
      details.open = false;
    });
    document.querySelectorAll('body > .row-actions-dropdown').forEach(function (el) {
      el.remove();
    });
  }

  function initRowActionsMenus(root) {
    const scope = root || document;
    if (scope._triRowActionsBound) return;
    scope._triRowActionsBound = true;

    scope.addEventListener('toggle', function (e) {
      const details = e.target;
      if (!details || !details.classList || !details.classList.contains('row-actions-menu')) return;
      if (details.open) {
        scope.querySelectorAll('details.row-actions-menu[open]').forEach(function (other) {
          if (other !== details) other.open = false;
        });
        positionRowActionsDropdown(details);
      } else {
        clearRowActionsDropdown(details);
      }
    }, true);

    scope.addEventListener('scroll', function () {
      scope.querySelectorAll('details.row-actions-menu[open]').forEach(function (details) {
        positionRowActionsDropdown(details);
      });
    }, true);

    window.addEventListener('resize', function () {
      document.querySelectorAll('details.row-actions-menu[open]').forEach(function (details) {
        positionRowActionsDropdown(details);
      });
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('details.row-actions-menu') || e.target.closest('.row-actions-dropdown')) return;
      document.querySelectorAll('details.row-actions-menu[open]').forEach(function (details) {
        details.open = false;
      });
    });

    // When a menu item is clicked, close the menu after the click is handled
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.row-actions-dropdown .action-btn, .row-actions-dropdown a.action-btn');
      if (!btn) return;
      const dropdown = btn.closest('.row-actions-dropdown');
      const details = document.querySelector('details.row-actions-menu[open]');
      if (details && dropdown) {
        setTimeout(function () { details.open = false; }, 0);
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { initRowActionsMenus(document); });
    } else {
      initRowActionsMenus(document);
    }
  }

  global.TriForm = {
    COUNTRIES,
    escapeHtml,
    getDialCode,
    initCountryPicker,
    initSearchableSelect,
    initRowActionsMenus,
    closeAllRowActionsMenus,
    bindDialCodeToPhones,
    initAddressDatalists,
    createContactPersonsWidget,
    initDuplicateCompanyCheck,
    initDuplicateNameCheck,
    createFileEditPanel,
    wireSupplierSpecsOnSelect,
    handleDuplicateResponse,
    loadAddressSuggestions
  };
})(typeof window !== 'undefined' ? window : global);
