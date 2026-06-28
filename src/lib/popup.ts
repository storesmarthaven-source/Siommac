/**
 * src/lib/popup.ts
 *
 * Promise-based modal + toast + spinner — ported from assets/js/popup.js.
 *
 * Implements the same `cpop` API as the original IIFE and also registers
 * itself as `window.Swal` (the drop-in Sweetalert2-compatible shim) and
 * `window.cpop` so legacy callers keep working unchanged.
 *
 * Public API (identical to legacy):
 *   cpop.fire(opts)      → Promise<{ isConfirmed, isDismissed, isDenied, value }>
 *   cpop.close()         → void
 *   cpop.showLoading()   → void
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

// ── SVG icon paths ────────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  success:  '<circle cx="26" cy="26" r="22"/><path class="check" d="M14 27 l8 7 16-18" stroke-linecap="round" stroke-linejoin="round"/>',
  error:    '<circle cx="26" cy="26" r="22"/><path class="x1" d="M16 16 L36 36" stroke-linecap="round"/><path class="x2" d="M36 16 L16 36" stroke-linecap="round"/>',
  warning:  '<path d="M26 6 L46 42 L6 42 Z" stroke-linejoin="round"/><line x1="26" y1="20" x2="26" y2="32" stroke-linecap="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>',
  info:     '<circle cx="26" cy="26" r="22"/><circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none"/><line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round"/>',
  question: '<circle cx="26" cy="26" r="22"/><path d="M20 20 a6 6 0 1 1 8 5 l-2 2 v3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>',
};

function _svg(icon: string): string {
  return '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">' + (ICONS[icon] ?? ICONS['info']!) + '</svg>';
}

// ── DOM state ─────────────────────────────────────────────────────────────────

let _ready      = false;
let _modal:     HTMLElement;
let _iconEl:    HTMLElement;
let _titleEl:   HTMLElement;
let _textEl:    HTMLElement;
let _progEl:    HTMLElement;
let _progBar:   HTMLElement;
let _okBtn:     HTMLButtonElement;
let _cancelBtn: HTMLButtonElement;
let _toastsEl:  HTMLElement;
let _inputEl:    HTMLInputElement;
let _textareaEl: HTMLTextAreaElement;
let _activeInput: HTMLInputElement | HTMLTextAreaElement | null = null;

let _activeResolve: ((v: CpopResult) => void) | null = null;
let _activeTimer:   ReturnType<typeof setTimeout>    | null = null;
let _escHandler:    ((e: KeyboardEvent) => void)     | null = null;
let _closeTimer:    ReturnType<typeof setTimeout>    | null = null;
let _mdCapture:     ((e: MouseEvent) => void)        | null = null;

// ── Result type ───────────────────────────────────────────────────────────────

export interface CpopResult {
  isConfirmed: boolean;
  isDismissed: boolean;
  isDenied:    boolean;
  value:       boolean;
  /** For prompts (opts.input) — the field's value when confirmed. */
  inputValue?: string;
}

// ── Fire options ──────────────────────────────────────────────────────────────

export interface CpopOptions {
  toast?:             boolean;
  loading?:           boolean;
  icon?:              string | false | null;
  title?:             string;
  text?:              string;
  html?:              string;
  showConfirmButton?: boolean;
  showCancelButton?:  boolean;
  confirmButtonText?: string;
  cancelButtonText?:  string;
  allowOutsideClick?: boolean;
  timer?:             number;
  timerProgressBar?:  boolean;
  panelClass?:        string;
  position?:          string;
  didOpen?:           () => void;
  /** Prompt input — renders a field; the value is returned in CpopResult.inputValue. */
  input?:             'text' | 'password' | 'email' | 'number' | 'textarea';
  inputValue?:        string;
  inputPlaceholder?:  string;
}

// ── DOM bootstrap ─────────────────────────────────────────────────────────────

function _ensureDOM(): void {
  if (_ready) return;
  _ready = true;

  _modal = document.createElement('div');
  _modal.className = 'cpop cpop-hidden';
  _modal.innerHTML =
    '<div class="cpop-backdrop"></div>' +
    '<div class="cpop-box" role="dialog" aria-modal="true">' +
      '<div class="cpop-icon"></div>' +
      '<h2 class="cpop-title"></h2>' +
      '<div class="cpop-text"></div>' +
      '<input class="cpop-input hidden" type="text">' +
      '<textarea class="cpop-textarea hidden" rows="3"></textarea>' +
      '<div class="cpop-progress" style="display:none;"><span></span></div>' +
      '<div class="cpop-actions">' +
        '<button class="cpop-btn cpop-btn-cancel hidden" type="button">Cancel</button>' +
        '<button class="cpop-btn cpop-btn-ok" type="button">OK</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(_modal);

  _iconEl    = _modal.querySelector('.cpop-icon')    as HTMLElement;
  _titleEl   = _modal.querySelector('.cpop-title')   as HTMLElement;
  _textEl    = _modal.querySelector('.cpop-text')    as HTMLElement;
  _inputEl    = _modal.querySelector('.cpop-input')    as HTMLInputElement;
  _textareaEl = _modal.querySelector('.cpop-textarea') as HTMLTextAreaElement;
  _progEl    = _modal.querySelector('.cpop-progress') as HTMLElement;
  _progBar   = _progEl.querySelector('span')         as HTMLElement;
  _okBtn     = _modal.querySelector('.cpop-btn-ok')  as HTMLButtonElement;
  _cancelBtn = _modal.querySelector('.cpop-btn-cancel') as HTMLButtonElement;

  _okBtn.addEventListener('click',     e => { e.stopPropagation(); _close(true);  });
  _cancelBtn.addEventListener('click', e => { e.stopPropagation(); _close(false); });
  (_modal.querySelector('.cpop-backdrop') as HTMLElement).addEventListener('click', e => {
    e.stopPropagation();
    if (_modal.dataset['dismiss'] !== 'false') _close(false);
  });
  (_modal.querySelector('.cpop-box') as HTMLElement).addEventListener('click', e => e.stopPropagation());

  _toastsEl = document.createElement('div');
  _toastsEl.className = 'cpop-toasts';
  _toastsEl.setAttribute('data-pos', 'top-end');
  document.body.appendChild(_toastsEl);
}

// ── Bootstrap modal freeze helpers ────────────────────────────────────────────

/** Block Bootstrap modals from intercepting mousedown while cpop is visible. */
function _installMdCapture(): void {
  if (_mdCapture) return;
  _mdCapture = (e: MouseEvent) => {
    if (_modal && _modal.contains(e.target as Node)) return;
    const bsModal = (e.target as Element)?.closest?.('.modal.show');
    if (bsModal) e.stopImmediatePropagation();
  };
  document.addEventListener('mousedown', _mdCapture, true);
}

function _removeMdCapture(): void {
  if (!_mdCapture) return;
  document.removeEventListener('mousedown', _mdCapture, true);
  _mdCapture = null;
}

function _freezeBsModals(): void {
  document.querySelectorAll('.modal.show').forEach(m => {
    m.setAttribute('data-cpop-prev-backdrop', m.getAttribute('data-bs-backdrop') ?? '');
    m.setAttribute('data-bs-backdrop', 'static');
    m.setAttribute('data-cpop-prev-keyboard', m.getAttribute('data-bs-keyboard') ?? '');
    m.setAttribute('data-bs-keyboard', 'false');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = (window as any).bootstrap?.Modal?.getInstance?.(m);
    if (inst) { inst._config.backdrop = 'static'; inst._config.keyboard = false; }
  });
}

function _unfreezeBsModals(): void {
  document.querySelectorAll('.modal[data-cpop-prev-backdrop]').forEach(m => {
    const prev = m.getAttribute('data-cpop-prev-backdrop');
    if (prev) m.setAttribute('data-bs-backdrop', prev); else m.removeAttribute('data-bs-backdrop');
    m.removeAttribute('data-cpop-prev-backdrop');
    const prevK = m.getAttribute('data-cpop-prev-keyboard');
    if (prevK) m.setAttribute('data-bs-keyboard', prevK); else m.removeAttribute('data-bs-keyboard');
    m.removeAttribute('data-cpop-prev-keyboard');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = (window as any).bootstrap?.Modal?.getInstance?.(m);
    if (inst) { inst._config.backdrop = prev || true; inst._config.keyboard = prevK !== 'false'; }
  });
}

// ── Core close ────────────────────────────────────────────────────────────────

function _close(confirmed: boolean): void {
  if (!_ready || _modal.classList.contains('cpop-hidden')) return;
  if (_activeTimer) { clearTimeout(_activeTimer); _activeTimer = null; }
  if (_escHandler)  { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
  _removeMdCapture();
  _unfreezeBsModals();
  _modal.classList.add('cpop-closing');
  const r = _activeResolve; _activeResolve = null;
  const iv = _activeInput ? _activeInput.value : undefined;
  _closeTimer = setTimeout(() => {
    _closeTimer = null;
    _modal.classList.add('cpop-hidden');
    _modal.classList.remove('cpop-closing');
    if (r) r({ isConfirmed: !!confirmed, isDismissed: !confirmed, isDenied: false, value: !!confirmed, inputValue: iv });
  }, 180);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function _showToast(opts: CpopOptions): Promise<CpopResult> {
  _ensureDOM();
  const icon = opts.icon || 'info';
  const t    = document.createElement('div');
  t.className = 'cpop-toast cpop-toast-' + icon;
  _toastsEl.setAttribute('data-pos', opts.position || 'top-end');
  t.innerHTML =
    '<div class="cpop-toast-icon">' + _svg(String(icon)) + '</div>' +
    '<div class="cpop-toast-body">' +
      (opts.title ? '<div class="cpop-toast-title"></div>' : '') +
      (opts.text  ? '<div class="cpop-toast-text"></div>'  : '') +
    '</div>' +
    (opts.timerProgressBar ? '<div class="cpop-toast-bar"></div>' : '');
  if (opts.title) (t.querySelector('.cpop-toast-title') as HTMLElement).textContent = opts.title;
  if (opts.text)  (t.querySelector('.cpop-toast-text')  as HTMLElement).textContent = opts.text;
  _toastsEl.appendChild(t);
  requestAnimationFrame(() => t.classList.add('cpop-toast-in'));

  const dur = opts.timer ?? 3000;
  if (opts.timerProgressBar) {
    const bar = t.querySelector('.cpop-toast-bar') as HTMLElement | null;
    if (bar) {
      bar.style.transition = `width ${dur}ms linear`;
      requestAnimationFrame(() => { bar.style.width = '0%'; });
    }
  }
  setTimeout(() => {
    t.classList.add('cpop-toast-out');
    setTimeout(() => t.remove(), 300);
  }, dur);
  return Promise.resolve({ isConfirmed: false, isDismissed: true, isDenied: false, value: false });
}

// ── fire ──────────────────────────────────────────────────────────────────────

function fire(opts: CpopOptions = {}): Promise<CpopResult> {
  _ensureDOM();
  if (opts.toast) return _showToast(opts);

  // Cancel any in-progress close animation / auto-timer from a previous popup
  if (_closeTimer)  { clearTimeout(_closeTimer);  _closeTimer  = null; }
  if (_activeTimer) { clearTimeout(_activeTimer); _activeTimer = null; }

  // Reset CSS animations — force reflow on the modal and its animated children
  _modal.classList.remove('cpop-hidden', 'cpop-closing');
  [_modal, _modal.querySelector('.cpop-backdrop'), _modal.querySelector('.cpop-box')]
    .forEach(el => { if (el) void (el as HTMLElement).offsetWidth; });

  _freezeBsModals();
  _installMdCapture();

  const box = _modal.querySelector('.cpop-box') as HTMLElement;
  box.className = opts.panelClass ? 'cpop-box ' + opts.panelClass : 'cpop-box';

  // Icon
  if (opts.loading) {
    _iconEl.className = 'cpop-icon';
    _iconEl.innerHTML = '<div class="cpop-loading"></div>';
    _iconEl.style.display = '';
  } else if (opts.icon === false || opts.icon === null) {
    _iconEl.className = 'cpop-icon';
    _iconEl.innerHTML = '';
    _iconEl.style.display = 'none';
  } else {
    const icon = opts.icon || 'info';
    _iconEl.className = 'cpop-icon cpop-icon-' + icon;
    _iconEl.innerHTML = _svg(icon);
    _iconEl.style.display = '';
  }

  // Content
  _titleEl.textContent = opts.title ?? '';
  _titleEl.style.display = opts.title ? '' : 'none';
  if (opts.html) _textEl.innerHTML = opts.html;
  else           _textEl.textContent = opts.text ?? '';

  // Prompt input
  _activeInput = null;
  _inputEl.classList.add('hidden');
  _textareaEl.classList.add('hidden');
  if (opts.input === 'textarea') {
    _textareaEl.classList.remove('hidden');
    _textareaEl.value = opts.inputValue ?? '';
    _textareaEl.placeholder = opts.inputPlaceholder ?? '';
    _activeInput = _textareaEl;
  } else if (opts.input) {
    _inputEl.classList.remove('hidden');
    _inputEl.type = opts.input;
    _inputEl.value = opts.inputValue ?? '';
    _inputEl.placeholder = opts.inputPlaceholder ?? '';
    _activeInput = _inputEl;
  }

  // Buttons
  const showCancel  = opts.showCancelButton === true;
  const showConfirm = opts.showConfirmButton !== false && !opts.loading;
  _okBtn.classList.toggle('hidden', !showConfirm);
  _cancelBtn.classList.toggle('hidden', !showCancel);
  _okBtn.innerHTML     = opts.confirmButtonText ?? 'OK';
  _cancelBtn.innerHTML = opts.cancelButtonText  ?? 'Cancel';
  _okBtn.classList.remove('cpop-btn-success', 'cpop-btn-danger', 'cpop-btn-warning');
  if      (opts.icon === 'warning' || opts.icon === 'error') _okBtn.classList.add('cpop-btn-danger');
  else if (opts.icon === 'success')                          _okBtn.classList.add('cpop-btn-success');

  // Progress bar
  if (opts.timer && opts.timerProgressBar) {
    _progEl.style.display = 'block';
    _progBar.style.transition = 'none';
    _progBar.style.width = '100%';
    void _progBar.offsetWidth;
    _progBar.style.transition = `width ${opts.timer}ms linear`;
    _progBar.style.width = '0%';
  } else {
    _progEl.style.display = 'none';
  }

  // Dismiss rules: errors/warnings must always be closed explicitly
  const isAlert = opts.icon === 'error' || opts.icon === 'warning';
  _modal.dataset['dismiss'] = (opts.allowOutsideClick === false || opts.loading || isAlert) ? 'false' : 'true';
  _modal.classList.remove('cpop-hidden', 'cpop-closing');

  if (opts.timer && !isAlert) _activeTimer = setTimeout(() => _close(false), opts.timer);

  _escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && _modal.dataset['dismiss'] !== 'false') _close(false);
    // Enter confirms — except in a textarea (where it should insert a newline).
    else if (e.key === 'Enter' && opts.input !== 'textarea' && !_okBtn.classList.contains('hidden') && !opts.loading) _close(true);
  };
  document.addEventListener('keydown', _escHandler);

  if (_activeInput) setTimeout(() => { try { _activeInput?.focus(); _activeInput?.select?.(); } catch (_) {} }, 60);
  if (typeof opts.didOpen === 'function') {
    setTimeout(() => { try { opts.didOpen!(); } catch (_) {} }, 50);
  }

  return new Promise(resolve => { _activeResolve = resolve; });
}

function showLoading(): void {
  void fire({ loading: true, allowOutsideClick: false, showConfirmButton: false });
}

// ── Public export ─────────────────────────────────────────────────────────────

export const cpop = {
  fire,
  close:       () => _close(false),
  showLoading,
};

// ── Window shims — legacy callers use window.cpop and window.Swal ─────────────
(window as unknown as Record<string, unknown>)['cpop'] = cpop;
(window as unknown as Record<string, unknown>)['Swal'] = cpop;   // Sweetalert2-compatible drop-in
