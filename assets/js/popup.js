// Promise-based modal + toast + spinner. Compatible with the Swal.fire(opts) API.
const cpop = (function () {
  let ready = false, modal, iconEl, titleEl, textEl, progEl, progBar, okBtn, cancelBtn, toastsEl;
  let activeResolve = null, activeTimer = null, escHandler = null, closeTimer = null;
  let _mdCapture = null; // capture-phase mousedown blocker while cpop is open

  const ICONS = {
    success:  '<circle cx="26" cy="26" r="22"/><path class="check" d="M14 27 l8 7 16-18" stroke-linecap="round" stroke-linejoin="round"/>',
    error:    '<circle cx="26" cy="26" r="22"/><path class="x1" d="M16 16 L36 36" stroke-linecap="round"/><path class="x2" d="M36 16 L16 36" stroke-linecap="round"/>',
    warning:  '<path d="M26 6 L46 42 L6 42 Z" stroke-linejoin="round"/><line x1="26" y1="20" x2="26" y2="32" stroke-linecap="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>',
    info:     '<circle cx="26" cy="26" r="22"/><circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none"/><line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round"/>',
    question: '<circle cx="26" cy="26" r="22"/><path d="M20 20 a6 6 0 1 1 8 5 l-2 2 v3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>'
  };

  function svg(icon) {
    return '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">' + (ICONS[icon] || ICONS.info) + '</svg>';
  }

  function ensureDOM() {
    if (ready) return;
    ready = true;
    modal = document.createElement('div');
    modal.className = 'cpop cpop-hidden';
    modal.innerHTML =
      '<div class="cpop-backdrop"></div>' +
      '<div class="cpop-box" role="dialog" aria-modal="true">' +
        '<div class="cpop-icon"></div>' +
        '<h2 class="cpop-title"></h2>' +
        '<div class="cpop-text"></div>' +
        '<div class="cpop-progress" style="display:none;"><span></span></div>' +
        '<div class="cpop-actions">' +
          '<button class="cpop-btn cpop-btn-cancel hidden" type="button">Cancel</button>' +
          '<button class="cpop-btn cpop-btn-ok" type="button">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    iconEl = modal.querySelector('.cpop-icon');
    titleEl = modal.querySelector('.cpop-title');
    textEl = modal.querySelector('.cpop-text');
    progEl = modal.querySelector('.cpop-progress');
    progBar = progEl.querySelector('span');
    okBtn = modal.querySelector('.cpop-btn-ok');
    cancelBtn = modal.querySelector('.cpop-btn-cancel');
    okBtn.addEventListener('click', (e) => { e.stopPropagation(); close(true); });
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); close(false); });
    modal.querySelector('.cpop-backdrop').addEventListener('click', (e) => {
      e.stopPropagation();
      if (modal.dataset.dismiss !== 'false') close(false);
    });
    // Stop clicks inside the cpop box from bubbling to Bootstrap modal listeners
    modal.querySelector('.cpop-box').addEventListener('click', (e) => e.stopPropagation());
    toastsEl = document.createElement('div');
    toastsEl.className = 'cpop-toasts';
    toastsEl.setAttribute('data-pos', 'top-end');
    document.body.appendChild(toastsEl);
  }

  // Install a capture-phase mousedown listener that prevents Bootstrap modals
  // from receiving mousedown events while cpop is visible. Bootstrap uses
  // mousedown on the .modal element to detect outside-clicks; this blocks it.
  function _installMdCapture() {
    if (_mdCapture) return;
    _mdCapture = (e) => {
      // If the click target is inside cpop itself, let it through
      if (modal && modal.contains(e.target)) return;
      // Block mousedown from reaching any open Bootstrap modal
      const bsModal = e.target && e.target.closest && e.target.closest('.modal.show');
      if (bsModal) { e.stopImmediatePropagation(); }
    };
    document.addEventListener('mousedown', _mdCapture, true);
  }

  function _removeMdCapture() {
    if (!_mdCapture) return;
    document.removeEventListener('mousedown', _mdCapture, true);
    _mdCapture = null;
  }

  function close(confirmed) {
    if (!ready || modal.classList.contains('cpop-hidden')) return;
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
    if (escHandler)  { document.removeEventListener('keydown', escHandler); escHandler = null; }
    _removeMdCapture();
    _unfreezeBsModals();
    modal.classList.add('cpop-closing');
    const r = activeResolve; activeResolve = null;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      modal.classList.add('cpop-hidden');
      modal.classList.remove('cpop-closing');
      if (r) r({ isConfirmed: !!confirmed, isDismissed: !confirmed, isDenied: false, value: !!confirmed });
    }, 180);
  }

  // Freeze all open Bootstrap modals so they can't be dismissed while cpop is showing
  function _freezeBsModals() {
    document.querySelectorAll('.modal.show').forEach(m => {
      // Use a plain data attribute name (no leading underscore) to avoid dataset double-dash bug
      m.setAttribute('data-cpop-prev-backdrop', m.getAttribute('data-bs-backdrop') || '');
      m.setAttribute('data-bs-backdrop', 'static');
      m.setAttribute('data-cpop-prev-keyboard', m.getAttribute('data-bs-keyboard') || '');
      m.setAttribute('data-bs-keyboard', 'false');
      const inst = window.bootstrap && bootstrap.Modal.getInstance(m);
      if (inst) { inst._config.backdrop = 'static'; inst._config.keyboard = false; }
    });
  }
  function _unfreezeBsModals() {
    document.querySelectorAll('.modal[data-cpop-prev-backdrop]').forEach(m => {
      const prev = m.getAttribute('data-cpop-prev-backdrop');
      if (prev) m.setAttribute('data-bs-backdrop', prev); else m.removeAttribute('data-bs-backdrop');
      m.removeAttribute('data-cpop-prev-backdrop');
      const prevK = m.getAttribute('data-cpop-prev-keyboard');
      if (prevK) m.setAttribute('data-bs-keyboard', prevK); else m.removeAttribute('data-bs-keyboard');
      m.removeAttribute('data-cpop-prev-keyboard');
      const inst = window.bootstrap && bootstrap.Modal.getInstance(m);
      if (inst) { inst._config.backdrop = prev || true; inst._config.keyboard = prevK !== 'false'; }
    });
  }

  function fire(opts) {
    ensureDOM();
    opts = opts || {};
    if (opts.toast) return showToast(opts);

    // Cancel any in-progress close animation or auto-close timer from a previous popup
    if (closeTimer)  { clearTimeout(closeTimer);  closeTimer  = null; }
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }

    // Reset CSS animations: remove classes, force reflow on the modal AND its
    // animated children so any in-progress fade-out animations are fully cancelled.
    modal.classList.remove('cpop-hidden', 'cpop-closing');
    // Force reflow on children that have CSS animations, cancelling any running animation
    [modal,
     modal.querySelector('.cpop-backdrop'),
     modal.querySelector('.cpop-box')
    ].forEach(el => { if (el) void el.offsetWidth; });

    // Always freeze Bootstrap modals while cpop is visible (even for loading spinner),
    // and install a capture-phase mousedown blocker for Belt-and-suspenders protection.
    _freezeBsModals();
    _installMdCapture();

    const box = modal.querySelector('.cpop-box');
    // Panel mode: wide, no padding, left-aligned — used for detail dialogs
    if (opts.panelClass) {
      box.className = 'cpop-box ' + opts.panelClass;
    } else {
      box.className = 'cpop-box';
    }

    if (opts.loading) {
      iconEl.className = 'cpop-icon';
      iconEl.innerHTML = '<div class="cpop-loading"></div>';
      iconEl.style.display = '';
    } else if (opts.icon === false || opts.icon === null) {
      iconEl.className = 'cpop-icon';
      iconEl.innerHTML = '';
      iconEl.style.display = 'none';
    } else {
      const icon = opts.icon || 'info';
      iconEl.className = 'cpop-icon cpop-icon-' + icon;
      iconEl.innerHTML = svg(icon);
      iconEl.style.display = '';
    }

    titleEl.textContent = opts.title || '';
    titleEl.style.display = opts.title ? '' : 'none';
    if (opts.html) textEl.innerHTML = opts.html;
    else textEl.textContent = opts.text || '';

    const showCancel = opts.showCancelButton === true;
    const showConfirm = opts.showConfirmButton !== false && !opts.loading;
    okBtn.classList.toggle('hidden', !showConfirm);
    cancelBtn.classList.toggle('hidden', !showCancel);
    okBtn.innerHTML     = opts.confirmButtonText || 'OK';
    cancelBtn.innerHTML = opts.cancelButtonText  || 'Cancel';
    okBtn.classList.remove('cpop-btn-success', 'cpop-btn-danger', 'cpop-btn-warning');
    if      (opts.icon === 'warning' || opts.icon === 'error') okBtn.classList.add('cpop-btn-danger');
    else if (opts.icon === 'success')                          okBtn.classList.add('cpop-btn-success');

    if (opts.timer && opts.timerProgressBar) {
      progEl.style.display = 'block';
      progBar.style.transition = 'none';
      progBar.style.width = '100%';
      void progBar.offsetWidth;
      progBar.style.transition = 'width ' + opts.timer + 'ms linear';
      progBar.style.width = '0%';
    } else {
      progEl.style.display = 'none';
    }

    // Error and warning modals must always be dismissed explicitly — never by timer or outside click
    const isAlert = opts.icon === 'error' || opts.icon === 'warning';
    modal.dataset.dismiss = (opts.allowOutsideClick === false || opts.loading || isAlert) ? 'false' : 'true';
    modal.classList.remove('cpop-hidden', 'cpop-closing');

    if (opts.timer && !isAlert) activeTimer = setTimeout(() => close(false), opts.timer);

    escHandler = (e) => {
      if (e.key === 'Escape' && modal.dataset.dismiss !== 'false') close(false);
      else if (e.key === 'Enter' && !okBtn.classList.contains('hidden') && !opts.loading) close(true);
    };
    document.addEventListener('keydown', escHandler);

    if (typeof opts.didOpen === 'function') setTimeout(() => { try { opts.didOpen(); } catch (_) {} }, 50);

    return new Promise(resolve => { activeResolve = resolve; });
  }

  function showToast(opts) {
    ensureDOM();
    const t = document.createElement('div');
    const icon = opts.icon || 'info';
    t.className = 'cpop-toast cpop-toast-' + icon;
    toastsEl.setAttribute('data-pos', opts.position || 'top-end');
    t.innerHTML =
      '<div class="cpop-toast-icon">' + svg(icon) + '</div>' +
      '<div class="cpop-toast-body">' +
        (opts.title ? '<div class="cpop-toast-title"></div>' : '') +
        (opts.text  ? '<div class="cpop-toast-text"></div>'  : '') +
      '</div>' +
      (opts.timerProgressBar ? '<div class="cpop-toast-bar"></div>' : '');
    if (opts.title) t.querySelector('.cpop-toast-title').textContent = opts.title;
    if (opts.text)  t.querySelector('.cpop-toast-text').textContent  = opts.text;
    toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add('cpop-toast-in'));

    const dur = opts.timer || 3000;
    if (opts.timerProgressBar) {
      const bar = t.querySelector('.cpop-toast-bar');
      if (bar) {
        bar.style.transition = 'width ' + dur + 'ms linear';
        requestAnimationFrame(() => { bar.style.width = '0%'; });
      }
    }
    setTimeout(() => {
      t.classList.add('cpop-toast-out');
      setTimeout(() => t.remove(), 300);
    }, dur);
    return Promise.resolve({ isConfirmed: false, isDismissed: true, isDenied: false });
  }

  function showLoading() {
    fire({ loading: true, allowOutsideClick: false, showConfirmButton: false });
  }

  return { fire, close: () => close(false), showLoading };
})();

// Drop-in shim: any existing Swal.fire / Swal.close / Swal.showLoading call routes to cpop
window.Swal = cpop;
