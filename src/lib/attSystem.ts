/**
 * src/lib/attSystem.ts
 *
 * TypeScript port of assets/app.js — the main Attendance System orchestrator.
 *
 * Replaces the 1,111-line vanilla-JS IIFE with a typed module.  The public
 * interface (`init`, `goTo`, `_buildPayslipHtml`, `_completeLogin`) is kept
 * identical so Preact components and legacy callers keep working unchanged.
 *
 * Key differences from the original:
 *   • `_tfa` global reference in `_completeLogin` removed — rememberMe is read
 *     from the DOM `#rememberMe` checkbox directly (the value is set by
 *     LoginPage.tsx before calling `onLoginSuccess`).
 *   • jQuery removed; all DOM interactions use native APIs.
 *   • All `window.*` calls are typed via the `Win` helper cast.
 *   • `_safeInit()` is NOT called here — main.tsx calls `AttendanceSystem.init()`
 *     from `bootApp()` after `SiomacDB.warmSwr()` resolves.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

// ── CDN-global type shims ─────────────────────────────────────────────────────
declare const flatpickr: ((sel: string, opts: Record<string, unknown>) => { selectedDates: Date[]; formatDate: (d: Date, f: string) => string; set: (k: string, v: unknown) => void; setDate: (d: string, trigger: boolean) => void; destroy: () => void }) | undefined;
declare const L: { latLng: (lat: number, lng: number) => { toBounds: (r: number) => unknown }; featureGroup: (arr: unknown[]) => { getBounds: () => { pad: (n: number) => unknown } } };

// ── Win helper ────────────────────────────────────────────────────────────────
type Win = Window & typeof globalThis & Record<string, unknown>;
const w = (): Win => window as Win;

// ── Legacy module shorthands (live on window.* at runtime) ───────────────────
// Using function helpers so TypeScript doesn't error on absent types.
function _Nav()         { return (w() as Record<string, unknown>)['Nav']         as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _Dashboard()   { return (w() as Record<string, unknown>)['Dashboard']   as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _LiveMap()     { return (w() as Record<string, unknown>)['LiveMap']     as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _Payroll()     { return (w() as Record<string, unknown>)['Payroll']     as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _AttView()     { return (w() as Record<string, unknown>)['AttendanceView'] as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _SettingsView(){ return (w() as Record<string, unknown>)['SettingsView'] as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _SiomacDB()    { return (w() as Record<string, unknown>)['SiomacDB']    as { warmSwr: () => Promise<void> } | undefined; }
function _SwCacheMgr()  { return (w() as Record<string, unknown>)['SwCacheManager'] as Record<string, (...a: unknown[]) => unknown> | undefined; }
function _AppState()    { return (w() as Record<string, unknown>)['AppState']    as { get: (k: string) => unknown; set: (k: string, v: unknown) => void; _photoCache: Record<string, string> } | undefined; }
function _swr()         { return (w() as Record<string, unknown>)['swr']         as { clearByPrefix: (p: string) => void } | undefined; }
function _swrLastHash() { return (w() as Record<string, unknown>)['_swrLastHash'] as Map<string, string> | undefined; }
function _rawApiW()     { return (w() as Record<string, unknown>)['_rawApi']     as ((action: string, args?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; [k: string]: unknown }>) | undefined; }
function _apiW()        { return (w() as Record<string, unknown>)['api']         as ((action: string, args?: Record<string, unknown>) => Promise<{ success: boolean; [k: string]: unknown }>) | undefined; }
function _cpop()        { return (w() as Record<string, unknown>)['cpop']        as { fire: (o: Record<string, unknown>) => Promise<{ isConfirmed: boolean }>; close: () => void } | undefined; }
function _Swal()        { return (w() as Record<string, unknown>)['Swal']        as { fire: (o: Record<string, unknown>) => void } | undefined; }
function _SiomacConfig(){ return (w() as Record<string, unknown>)['SiomacConfig'] as { SECTION_DEFS: Record<string, { id: string }[]>; COMMON_ITEMS: { id: string }[] } | undefined; }

// ── Local-only state ──────────────────────────────────────────────────────────

let currentColorScheme   = 'navy';
let currentLayoutMode    = 'sidebar';
let _currentProfileImage: string | null = null;   // null = not yet loaded

let _attFpFrom: ReturnType<NonNullable<typeof flatpickr>> | null = null;
let _attFpTo:   ReturnType<NonNullable<typeof flatpickr>> | null = null;

let _sessExpTimer:  ReturnType<typeof setTimeout>  | null = null;
let _sessWarnTimer: ReturnType<typeof setTimeout>  | null = null;
let _sessTickTimer: ReturnType<typeof setInterval> | null = null;
let _sessWarned = false;
// Idle-timeout activity tracking
let _lastActivityReset = 0;
let _activityHandler: (() => void) | null = null;

const _sectionLoaded: Record<string, boolean> = {};
function _resetLoadedState(): void { Object.keys(_sectionLoaded).forEach(k => delete _sectionLoaded[k]); }

const _photoCache: Record<string, string> = {};

// ── Session constants ─────────────────────────────────────────────────────────

const SESSION_KEY           = 'siomac_session_v1';
// Idle-timeout model: the session expires after this much INACTIVITY. The
// deadline slides forward on user activity (see _resetIdleDeadline). The value
// is per-role and superadmin-configurable; the server sends the resolved window
// in the login payload (sessionIdleTimeoutMs). These are fallbacks only.
const SESSION_DEFAULT_IDLE  = 8 * 60 * 60 * 1000;       // 8h if the server sends nothing
const SESSION_REMEMBER_IDLE = 7 * 24 * 60 * 60 * 1000;  // "Remember me" widens the idle window
const SESSION_WARN_AT       = 5 * 60 * 1000;            // warn 5 min before idle expiry
const SESSION_ACTIVITY_THROTTLE = 30 * 1000;           // at most one deadline reset per 30s

// ── CONFIG ────────────────────────────────────────────────────────────────────

const CONFIG = {
  WORKING_HOURS: { start: 6, end: 22 },
  MAX_DISTANCE:  200,
};
// Expose CONFIG so legacy callers can read it
(w() as Record<string, unknown>)['CONFIG'] = CONFIG;

// ── Utility ───────────────────────────────────────────────────────────────────

function fmtLocalTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (_) { return '--:--'; }
}

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c));
}

function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/(["\\])/g, '\\$1');
}

// ── Photo cache ───────────────────────────────────────────────────────────────

function _patchPhotoCache(username: string | null | undefined, photoUrl: string): void {
  if (username) {
    _photoCache[username] = photoUrl ?? '';
    const as = _AppState();
    if (as) as._photoCache = _photoCache;
  }
}

function _clearPhotoCache(): void {
  Object.keys(_photoCache).forEach(k => delete _photoCache[k]);
  const as = _AppState();
  if (as) as._photoCache = _photoCache;
}

// ── Popup helpers ─────────────────────────────────────────────────────────────

const showSpinner = (msg?: string): void => {
  void _cpop()?.fire({ loading: true, title: msg ?? 'Loading...', allowOutsideClick: false, showConfirmButton: false });
};
const hideSpinner = (): void => _cpop()?.close();
const showPopup = (type: string, title: string, text: string): Promise<{ isConfirmed: boolean }> | undefined =>
  _cpop()?.fire({ icon: type, title, text, showConfirmButton: true, allowOutsideClick: type !== 'error' && type !== 'warning' });

// ── getCurrentLocation ────────────────────────────────────────────────────────

interface GeoResult { fallback?: boolean; latitude: number; longitude: number; accuracy: number; timestamp: string }

const getCurrentLocation = (): Promise<GeoResult> => new Promise(resolve => {
  if (!navigator.geolocation) {
    resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: new Date().toISOString() }),
    ()  => resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() }),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
});

// ── _spinBtn ──────────────────────────────────────────────────────────────────

function _spinBtn(idOrEl: string | HTMLElement): void {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return;
  el.classList.add('btn-spinning');
  setTimeout(() => el.classList.remove('btn-spinning'), 1000);
}

// ── _swapAvatarImg ────────────────────────────────────────────────────────────

interface ProfileAvEl { imgEl: HTMLImageElement; emptyEl: HTMLElement; removeBtn?: HTMLElement }

function _swapAvatarImg(el: HTMLElement | ProfileAvEl, url: string, initial: string, variant: 'hdr' | 'attendance' | 'profile'): void {
  const wp = w() as Record<string, unknown>;
  const preloaded = wp['_preloadedProfileImage'] as HTMLImageElement | undefined;
  const isReady   = preloaded && wp['_preloadedProfileUrl'] === url && preloaded.complete && preloaded.naturalWidth > 0;

  function applyImg(): void {
    if (variant === 'hdr' || variant === 'attendance') {
      (el as HTMLElement).innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else if (variant === 'profile') {
      const p = el as ProfileAvEl;
      p.imgEl.src = url; p.imgEl.style.display = 'block';
      p.emptyEl.style.display = 'none';
      if (p.removeBtn) p.removeBtn.style.display = '';
    }
  }
  function applyFallback(): void {
    if (variant === 'profile') {
      const p = el as ProfileAvEl;
      p.imgEl.src = ''; p.imgEl.style.display = 'none';
      p.emptyEl.style.display = 'flex'; p.emptyEl.textContent = initial;
      if (p.removeBtn) p.removeBtn.style.display = 'none';
    }
  }

  if (isReady) { applyImg(); return; }
  if (variant === 'hdr')        (el as HTMLElement).textContent = initial;
  if (variant === 'attendance') (el as HTMLElement).innerHTML   = `<span>${initial}</span>`;
  const probe = new Image();
  probe.onload  = applyImg;
  probe.onerror = applyFallback;
  probe.src = url;
}

// ── _syncPillAvatars ──────────────────────────────────────────────────────────

function _syncPillAvatars(result: Record<string, unknown>): void {
  const as       = _AppState();
  const fullName = (as?.get('currentFullName') ?? as?.get('currentUser') ?? '?') as string;
  const username = (as?.get('currentUser') ?? '') as string;
  const role     = (as?.get('currentRole') ?? 'admin') as string;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const initial   = fullName.trim().charAt(0).toUpperCase();
  const img       = (result['profileImage'] as string) || '';

  function _pill(pfx: string, fallbackName: string): void {
    const av = document.getElementById(pfx + 'ProfileAvatar');
    if (av) { if (img) _swapAvatarImg(av, img, initial, 'hdr'); else av.textContent = initial; }
    const nm = document.getElementById(pfx + 'ProfileName');
    if (nm) nm.textContent = fullName !== '?' ? fullName : (username || fallbackName);
    const rl = document.getElementById(pfx + 'ProfileRole');
    if (rl) rl.textContent = roleLabel;
  }

  const hdrAv = document.getElementById('hdrProfileAvatar');
  if (hdrAv) { if (img) _swapAvatarImg(hdrAv, img, initial, 'hdr'); else hdrAv.textContent = initial; }

  // Pinned sidebar user card (Meridian-style, H).
  const cardAv = document.getElementById('sidebarUserCardAvatar');
  if (cardAv) { if (img) _swapAvatarImg(cardAv, img, initial, 'hdr'); else cardAv.textContent = initial; }
  const cardNm = document.getElementById('sidebarUserCardName');
  if (cardNm) cardNm.textContent = fullName !== '?' ? fullName : (username || 'User');
  const cardRl = document.getElementById('sidebarUserCardRole');
  if (cardRl) cardRl.textContent = roleLabel;

  _pill('dash', 'Admin');
  _pill('emp',  'Employee');
  _pill('mgr',  'Manager');
  _pill('hse',  'Admin');   // PPE Manager overview-panel profile pill
  ['admEmp','admDept','admProj','admAtt','admLv','admRates','admPay','admProf','admStg','admAbt'].forEach(pfx => _pill(pfx, 'Admin'));
}

// ── _setAttendanceAvatar ──────────────────────────────────────────────────────

function _setAttendanceAvatar(imgUrl: string, fullName: string): void {
  const avatarDiv = document.querySelector<HTMLElement>('.user-avatar');
  if (!avatarDiv) return;
  const as      = _AppState();
  const initial = ((fullName || (as?.get('currentFullName') as string) || '?').charAt(0).toUpperCase());
  if (imgUrl) { _swapAvatarImg(avatarDiv, imgUrl, initial, 'attendance'); }
  else { avatarDiv.innerHTML = `<span>${initial}</span>`; }
}

// ── _profileToast ─────────────────────────────────────────────────────────────

let _profileToastTimer: ReturnType<typeof setTimeout> | null = null;

function _profileToast(msg: string, isError: boolean): void {
  const el = document.getElementById('profileToast');
  if (!el) return;
  el.className = 'profile-toast' + (isError ? ' error' : '');
  el.innerHTML = `<i class="fas fa-${isError ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
  el.style.display = 'flex';
  if (_profileToastTimer) clearTimeout(_profileToastTimer);
  _profileToastTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── Phone mask ────────────────────────────────────────────────────────────────

const PREFIX     = '(868) ';
const PREFIX_LEN = PREFIX.length;

function _buildMasked(localDigits: string): string {
  const d = localDigits.slice(0, 7);
  if (d.length === 0) return PREFIX;
  if (d.length <= 3)  return PREFIX + d;
  return PREFIX + d.slice(0, 3) + '-' + d.slice(3);
}

function _localDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  const all = raw.replace(/\D/g, '');
  return (all.startsWith('868') ? all.slice(3) : all).slice(0, 7);
}

export function setPhone(idOrEl: string | HTMLInputElement, value: string): void {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) as HTMLInputElement | null : idOrEl;
  if (!el) return;
  el.value = value ? _buildMasked(_localDigits(value)) : '';
}

export function readPhone(idOrEl: string | HTMLInputElement): string {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) as HTMLInputElement | null : idOrEl;
  if (!el) return '';
  const digits = _localDigits(el.value);
  if (!digits) return '';
  return _buildMasked(digits);
}

// Phone mask event listeners
(function setupPhoneMask(): void {
  function onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
    const rawValue    = el.value;
    const cursorPos   = el.selectionStart ?? 0;
    const beforeCursor = rawValue.slice(0, cursorPos);
    const digitsBeforeCursor = _localDigits(beforeCursor);
    const digits = _localDigits(rawValue);
    const masked = _buildMasked(digits);
    el.value = masked;
    const target = digitsBeforeCursor.length;
    let count = 0, newPos = PREFIX_LEN;
    for (let i = PREFIX_LEN; i < masked.length; i++) {
      if (masked[i] === '-') continue;
      if (count === target) { newPos = i; break; }
      count++;
      newPos = masked.length;
    }
    if (count < target) newPos = masked.length;
    newPos = Math.max(newPos, PREFIX_LEN);
    el.setSelectionRange(newPos, newPos);
  }
  function onFocus(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
    if (!_localDigits(el.value)) el.value = PREFIX;
    setTimeout(() => { if ((el.selectionStart ?? 0) < PREFIX_LEN) el.setSelectionRange(PREFIX_LEN, PREFIX_LEN); }, 0);
  }
  function onKeydown(e: KeyboardEvent): void {
    const el = e.target as HTMLInputElement;
    if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
    const pos    = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd   ?? 0;
    if (e.key === 'Backspace' && pos <= PREFIX_LEN && pos === selEnd) { e.preventDefault(); return; }
    if (e.key === 'Delete'    && pos <  PREFIX_LEN && pos === selEnd) { e.preventDefault(); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'Home') && pos <= PREFIX_LEN) {
      e.preventDefault(); el.setSelectionRange(PREFIX_LEN, PREFIX_LEN);
    }
  }
  function onBlur(e: Event): void {
    const el = e.target as HTMLInputElement;
    if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
    if (!_localDigits(el.value)) el.value = '';
  }
  document.addEventListener('input',   onInput,   true);
  document.addEventListener('focus',   onFocus,   true);
  document.addEventListener('keydown', onKeydown as EventListener, true);
  document.addEventListener('blur',    onBlur,    true);
})();

// ── _buildPayslipHtml ─────────────────────────────────────────────────────────

export function _buildPayslipHtml(d: Record<string, unknown>): string {
  const fmt = (n: unknown): string => Number(n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cycleLabel: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
  const sv = _SettingsView();
  const ci = (sv?.['getCompanyInfo'] ? sv['getCompanyInfo']() : {}) as Record<string, string> | null ?? {};
  const sr = (sv?.['getStatutoryRates'] ? sv['getStatutoryRates']() : { allowanceAnnual: 90000, nisRate: 6 }) as Record<string, number>;
  const rateStr = d['pay_basis'] === 'hourly'
    ? `TTD ${fmt(d['hourly_rate'])} / hr`
    : `TTD ${fmt(d['monthly_salary'])} / month`;
  return `
    <div class="pr-payslip">
      <div class="pr-payslip-header">
        <div class="pr-payslip-header-icon"><i class="fas fa-file-invoice-dollar"></i></div>
        <div class="pr-payslip-header-info">
          <div class="pr-payslip-subtitle">${escapeHtml(d['name'] ?? '—')}</div>
          <div class="pr-payslip-period">${escapeHtml(d['position'] ?? '—')} &bull; ${escapeHtml(d['department'] ?? '—')}</div>
        </div>
        <button class="pr-payslip-print-btn no-print" onclick="window._printPayslip()"><i class="fas fa-print"></i> Print</button>
        <button class="pr-payslip-close-btn no-print" onclick="cpop.close()"><i class="fas fa-times"></i></button>
      </div>
      <div class="pr-payslip-brand">
        ${ci['logoUrl'] ? `<img src="${escapeHtml(ci['logoUrl'])}" alt="Logo" class="pr-payslip-brand-logo">` : ''}
        <div class="pr-payslip-brand-contact">
          <div class="pr-payslip-brand-name">${escapeHtml(ci['name'] ?? 'My Company')}</div>
          ${ci['address'] ? `<div class="pr-payslip-brand-detail">${escapeHtml(ci['address'])}</div>` : ''}
          ${ci['phone']   ? `<div class="pr-payslip-brand-detail"><i class="fas fa-phone"></i> ${escapeHtml(ci['phone'])}</div>` : ''}
          ${ci['email']   ? `<div class="pr-payslip-brand-detail"><i class="fas fa-envelope"></i> ${escapeHtml(ci['email'])}</div>` : ''}
          <div class="pr-payslip-brand-detail">NIS Reg: ${escapeHtml(ci['nis'] ?? '1234567')}</div>
          <div class="pr-payslip-brand-detail">BIR File: ${escapeHtml(ci['bir'] ?? '100123456')}</div>
        </div>
      </div>
      <div class="pr-payslip-meta">
        <div class="pr-payslip-meta-col">
          <div class="pr-payslip-meta-row"><span>Pay Period</span><strong>${escapeHtml(d['date_from'] as string)} — ${escapeHtml(d['date_to'] as string)}</strong></div>
          <div class="pr-payslip-meta-row"><span>Pay Cycle</span><strong>${cycleLabel[d['pay_cycle'] as string] ?? (d['pay_cycle'] as string) ?? '—'}</strong></div>
          <div class="pr-payslip-meta-row"><span>Pay Date</span><strong>${escapeHtml(d['pay_date'] ?? '—')}</strong></div>
          <div class="pr-payslip-meta-row"><span>Payroll Type</span><strong>Normal</strong></div>
        </div>
        <div class="pr-payslip-meta-col">
          <div class="pr-payslip-meta-row"><span>Rate</span><strong>${rateStr}</strong></div>
          <div class="pr-payslip-meta-row"><span>Hours Worked</span><strong>${d['hours_worked'] ?? d['hoursWorked'] ?? 0}h</strong></div>
          <div class="pr-payslip-meta-row"><span>Days Worked</span><strong>${d['days_worked'] ?? d['daysWorked'] ?? '—'}</strong></div>
          <div class="pr-payslip-meta-row"><span>Personal Allowance</span><strong>TTD ${fmt(sr['allowanceAnnual'])} / yr</strong></div>
          <div class="pr-payslip-meta-row pr-payslip-meta-row--sep"><span>NIS Reg</span><strong>${escapeHtml(ci['nis'] ?? '1234567')}</strong></div>
          <div class="pr-payslip-meta-row"><span>BIR File</span><strong>${escapeHtml(ci['bir'] ?? '100123456')}</strong></div>
        </div>
      </div>
      <div class="pr-payslip-tables">
        <div class="pr-payslip-table-col">
          <div class="pr-payslip-section-title"><i class="fas fa-plus-circle"></i> Earnings</div>
          <table class="pr-payslip-tbl">
            <thead><tr><th>Description</th><th>Rate</th><th>Units</th><th>Amount</th></tr></thead>
            <tbody>
              <tr>
                <td>${d['pay_basis'] === 'hourly' ? 'Straight Time' : 'Monthly Salary'}</td>
                <td>${d['pay_basis'] === 'hourly' ? fmt(d['hourly_rate'] ?? d['hourlyRate']) : '—'}</td>
                <td>${d['hours_worked'] ?? d['hoursWorked'] ?? '—'}</td>
                <td>TTD ${fmt(d['gross_pay'] ?? d['grossPay'])}</td>
              </tr>
            </tbody>
          </table>
          <div class="pr-payslip-subtotal"><span>Gross Pay</span><span>TTD ${fmt(d['gross_pay'] ?? d['grossPay'])}</span></div>
        </div>
        <div class="pr-payslip-table-col">
          <div class="pr-payslip-section-title"><i class="fas fa-minus-circle"></i> Deductions</div>
          <table class="pr-payslip-tbl">
            <thead><tr><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              <tr><td>Health Surcharge</td><td>${Number(d['health_surcharge'] ?? d['healthSurcharge'] ?? 0) > 0 ? 'TTD ' + fmt(d['health_surcharge'] ?? d['healthSurcharge']) : 'N/A'}</td></tr>
              <tr><td>NIS (${sr['nisRate'] ?? 6}%)</td><td>${Number(d['nis'] ?? 0) > 0 ? 'TTD ' + fmt(d['nis']) : 'N/A'}</td></tr>
              <tr><td>PAYE</td><td>TTD ${fmt(d['paye'])}</td></tr>
            </tbody>
          </table>
          <div class="pr-payslip-subtotal pr-payslip-subtotal--ded"><span>Total Deductions</span><span>TTD ${fmt(d['total_deductions'] ?? d['totalDeductions'])}</span></div>
        </div>
      </div>
      <div class="pr-payslip-net"><span>Net Pay</span><span>TTD ${fmt(d['net_pay'] ?? d['netPay'])}</span></div>
      <div class="pr-payslip-ytd">
        <div class="pr-payslip-section-title"><i class="fas fa-calendar-alt"></i> Year to Date</div>
        <div class="pr-payslip-ytd-row">
          <div class="pr-payslip-ytd-item"><span>Earnings</span><strong>TTD ${fmt(d['gross_pay'] ?? d['grossPay'])}</strong></div>
          <div class="pr-payslip-ytd-item"><span>Gross</span><strong>TTD ${fmt(d['gross_pay'] ?? d['grossPay'])}</strong></div>
          <div class="pr-payslip-ytd-item"><span>PAYE</span><strong>TTD ${fmt(d['paye'])}</strong></div>
          <div class="pr-payslip-ytd-item"><span>NIS</span><strong>TTD ${fmt(d['nis'])}</strong></div>
          <div class="pr-payslip-ytd-item"><span>HS</span><strong>TTD ${fmt(d['health_surcharge'] ?? d['healthSurcharge'])}</strong></div>
        </div>
      </div>
      <div class="pr-payslip-footer">This is a computer-generated payslip &mdash; Trinidad &amp; Tobago</div>
    </div>`;
}

// ── Session management ────────────────────────────────────────────────────────

interface SessionData {
  userId:         string;
  username:       string;
  fullName:       string;
  role:           string;
  departmentId:   string;
  position:       string;
  colorScheme:    string;
  layoutMode:     string;
  token:          string;
  refreshToken:   string;
  companyName:    string;
  companyLogoUrl: string;
  profileImage:   string;
  expiresAt:      number;   // sliding idle deadline (unix ms)
  idleTimeoutMs:  number;   // the role's configured idle window
  rememberMe:     boolean;
  [key: string]:  unknown;
}

function saveSession(payload: Partial<SessionData>, rememberMe: boolean): void {
  try {
    // Idle window: explicit per-role value from the server, widened if "remember
    // me" is on, else the safe default.
    const serverIdle = Number(payload['idleTimeoutMs']) || 0;
    const idleTimeoutMs = rememberMe
      ? Math.max(serverIdle, SESSION_REMEMBER_IDLE)
      : (serverIdle || SESSION_DEFAULT_IDLE);
    const data = Object.assign({}, payload, {
      idleTimeoutMs,
      expiresAt:  Date.now() + idleTimeoutMs,
      rememberMe: !!rememberMe,
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (_) {}
}

function updateStoredSession(patch: Partial<SessionData>): void {
  try {
    const s = loadSession();
    if (!s) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign({}, s, patch)));
  } catch (_) {}
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionData;
    if (!s || !s.expiresAt || s.expiresAt < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch (_) { return null; }
}

function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  stopSessionTimer();            // clears timers + detaches activity listeners
  _sessWarned = false;
  _lastActivityReset = 0;
}

/** (Re)arm the expiry + warning timers from the current stored deadline. */
function _armSessionTimers(): void {
  const s = loadSession();
  if (!s) return;
  const msLeft = s.expiresAt - Date.now();
  if (msLeft <= 0) { handleSessionExpired(); return; }
  if (_sessExpTimer)  clearTimeout(_sessExpTimer);
  if (_sessWarnTimer) clearTimeout(_sessWarnTimer);
  _sessExpTimer = setTimeout(handleSessionExpired, msLeft);
  if (msLeft > SESSION_WARN_AT) {
    _sessWarnTimer = setTimeout(handleSessionWarning, msLeft - SESSION_WARN_AT);
  } else if (!_sessWarned) {
    handleSessionWarning();
  }
}

/**
 * Slide the idle deadline forward on user activity. Throttled so a burst of
 * mouse/key events costs at most one localStorage write + timer re-arm per
 * SESSION_ACTIVITY_THROTTLE. Once the warning has fired we stop auto-extending
 * so a warned-then-idle user still logs out (activity after the warning that
 * lands before expiry will still extend — intentional: they came back).
 */
function _resetIdleDeadline(): void {
  const now = Date.now();
  if (now - _lastActivityReset < SESSION_ACTIVITY_THROTTLE) return;
  const s = loadSession();
  if (!s) return;
  _lastActivityReset = now;
  const idle = Number(s.idleTimeoutMs) || SESSION_DEFAULT_IDLE;
  updateStoredSession({ expiresAt: now + idle });
  _sessWarned = false;            // fresh activity clears a prior warning
  _armSessionTimers();
}

function startSessionTimer(): void {
  const s = loadSession();
  if (!s) return;
  if (s.expiresAt - Date.now() <= 0) { handleSessionExpired(); return; }
  if (_sessTickTimer) clearInterval(_sessTickTimer);
  _armSessionTimers();
  updateSessionWidget();
  _sessTickTimer = setInterval(updateSessionWidget, 30000);

  // Attach throttled activity listeners that slide the idle deadline forward.
  if (!_activityHandler) {
    _activityHandler = () => _resetIdleDeadline();
    const evs: (keyof DocumentEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    for (const ev of evs) document.addEventListener(ev, _activityHandler, { passive: true });
  }
}

function stopSessionTimer(): void {
  if (_sessExpTimer)  { clearTimeout(_sessExpTimer);   _sessExpTimer  = null; }
  if (_sessWarnTimer) { clearTimeout(_sessWarnTimer);  _sessWarnTimer = null; }
  if (_sessTickTimer) { clearInterval(_sessTickTimer); _sessTickTimer = null; }
  if (_activityHandler) {
    const evs: (keyof DocumentEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    for (const ev of evs) document.removeEventListener(ev, _activityHandler);
    _activityHandler = null;
  }
}

function handleSessionWarning(): void {
  if (_sessWarned) return;
  _sessWarned = true;
  _Swal()?.fire({ icon: 'warning', title: 'Session Expiring', text: 'Your session will end in 5 minutes. Save your work.', timer: 6000, timerProgressBar: true, toast: true, position: 'top-end', showConfirmButton: false });
}

function handleSessionExpired(): void {
  _Swal()?.fire({ icon: 'info', title: 'Session Expired', text: 'Please log in again.', showConfirmButton: true });
  handleLogout();
}

function updateSessionWidget(): void {
  const widget = document.getElementById('sessionTimer');
  if (!widget) return;
  const s = loadSession();
  if (!s) { widget.classList.add('hidden'); return; }
  widget.classList.remove('hidden');
  const msLeft = s.expiresAt - Date.now();
  if (msLeft <= 0) { handleSessionExpired(); return; }
  const totalMins = Math.floor(msLeft / 60000);
  const secs      = Math.floor((msLeft % 60000) / 1000);
  let txt: string;
  if (totalMins >= 60) {
    const h = Math.floor(totalMins / 60); const m = totalMins % 60;
    txt = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else if (totalMins >= 1) {
    txt = totalMins + 'm';
  } else {
    txt = secs + 's';
  }
  const danger = msLeft <= SESSION_WARN_AT;
  const txtEl = document.getElementById('sessionTimerText');
  if (txtEl) txtEl.textContent = txt;
  widget.classList.toggle('warn', danger);
}

// Register handleSessionExpired on window so apiLegacy.ts can call it on 401
(w() as Record<string, unknown>)['handleSessionExpired'] = handleSessionExpired;

// ── Auth: _completeLogin ──────────────────────────────────────────────────────
// Called by LoginPage.tsx's onLoginSuccess callback after successful auth.
// NOTE: _tfa from the original app.js does NOT exist here — rememberMe is read
// from the DOM #rememberMe checkbox which LoginPage.tsx populates.

export function _completeLogin(result: Record<string, unknown>): void {
  clearSession();
  const as = _AppState();
  as?.set('currentUser',     null);
  as?.set('currentUserId',   null);
  as?.set('currentFullName', null);
  as?.set('currentDeptId',   null);
  as?.set('currentRole',     null);

  const rememberMeEl = document.getElementById('rememberMe') as HTMLInputElement | null;
  const rememberMe   = rememberMeEl?.checked ?? false;
  if (rememberMe) { localStorage.setItem('rememberedUser', result['username'] as string); }
  else            { localStorage.removeItem('rememberedUser'); }

  saveSession({
    userId:         result['userId']          as string ?? '',
    username:       result['username']        as string ?? '',
    fullName:       result['fullName']        as string ?? '',
    role:           result['role']            as string ?? '',
    departmentId:   result['departmentId']    as string ?? '',
    position:       result['position']        as string ?? '',
    colorScheme:    result['colorScheme']     as string ?? 'navy',
    layoutMode:     result['layoutMode']      as string ?? 'sidebar',
    token:          result['token']           as string ?? '',
    refreshToken:   result['refreshToken']    as string ?? '',
    companyName:    result['companyName']     as string ?? '',
    companyLogoUrl: result['companyLogoUrl']  as string ?? '',
    profileImage:   result['profileImage']    as string ?? '',
    idleTimeoutMs:  Number(result['sessionIdleTimeoutMs']) || 0,
    isEmployee:     result['isEmployee'] !== false,
    roleScope:      (result['roleScope'] as 'own' | 'all') ?? 'own',
  }, rememberMe);

  // Sync the Zustand session store so Preact components see isAuthenticated=true
  // immediately after login (without requiring a page refresh).
  try {
    const store = (w() as Record<string, unknown>)['__siomacSessionStore'] as
      { getState: () => { login: (r: Record<string, unknown>) => void } } | undefined;
    store?.getState().login(result as Record<string, unknown>);
  } catch (_) {}

  applySession(result, true);
}

// ── applySession ──────────────────────────────────────────────────────────────

function applySession(result: Record<string, unknown>, announce: boolean): void {
  const as = _AppState();
  as?.set('currentUser',     result['username']);
  as?.set('currentUserId',   result['userId']);
  as?.set('currentFullName', result['fullName'] ?? result['username']);
  as?.set('currentDeptId',   result['departmentId'] ?? '');
  as?.set('currentRole',     result['role']);
  // Whether this role gets the self-service Personal nav (default true if absent).
  as?.set('currentIsEmployee', result['isEmployee'] !== false);
  // Data scope hint: 'all' = org-wide, 'own' = own department only (default own).
  as?.set('currentRoleScope', (result['roleScope'] as string) ?? 'own');

  const nav = _Nav();
  currentColorScheme = (result['colorScheme'] as string) || 'navy';
  nav?.['applyPalette']?.(currentColorScheme);
  currentLayoutMode = (result['layoutMode'] as string) || 'sidebar';
  nav?.['applyLayout']?.(currentLayoutMode);

  document.getElementById('loginPage')?.classList.add('hidden');
  document.getElementById('appShell')?.classList.remove('hidden');
  document.documentElement.classList.add('app-active');
  document.body.classList.add('app-active');

  _syncPillAvatars(result);

  if (result['profileImage'] !== undefined) {
    _currentProfileImage = (result['profileImage'] as string) || '';
    _patchPhotoCache(as?.get('currentUser') as string, _currentProfileImage);
  }

  const sv = _SettingsView();
  if (result['companyLogoUrl']) sv?.['applyCompanyLogo']?.(result['companyLogoUrl']);
  sv?.['applyCompanyName']?.(result['companyName'] ?? 'My Company');
  sv?.['refreshCompanySettings']?.();

  const currentRole = as?.get('currentRole') as string;
  // superadmin is treated as admin for all admin-gated UI affordances.
  const isAdminish  = currentRole === 'admin' || currentRole === 'superadmin';
  document.querySelectorAll<HTMLElement>('.admin-only').forEach(el => { el.style.display = isAdminish ? '' : 'none'; });
  document.querySelectorAll<HTMLElement>('.non-admin-only').forEach(el => { el.style.display = !isAdminish ? '' : 'none'; });
  sv?.['_stgActivatePanel']?.(isAdminish ? 'company' : 'appearance');

  nav?.['buildSidebar']?.(currentRole);
  nav?.['buildTopTabs']?.(currentRole);

  const cfg = _SiomacConfig();
  const sectionDefs = cfg?.SECTION_DEFS ?? {};
  const commonItems = cfg?.COMMON_ITEMS ?? [];
  const def = (sectionDefs[currentRole] ?? [commonItems[1] ?? { id: '' }])[0] ?? { id: '' };

  if (announce) {
    try { localStorage.removeItem('siomac_last_section_' + currentRole); } catch (_) {}
    nav?.['showSection']?.(def.id);
  } else {
    let lastSection: string | null = null;
    try { lastSection = localStorage.getItem('siomac_last_section_' + currentRole); } catch (_) {}
    nav?.['showSection']?.((lastSection && document.getElementById(lastSection)) ? lastSection : def.id);
  }

  if (currentRole === 'employee') {
    _setAttendanceAvatar((result['profileImage'] as string) || '', as?.get('currentFullName') as string);
    const displayName = document.getElementById('displayNameText');
    if (displayName) displayName.textContent = as?.get('currentFullName') as string;
    const roleDept = document.getElementById('ea-role-dept');
    if (roleDept) {
      const pos  = (result['position']   as string) || '';
      const dept = (result['department'] as string) || '';
      roleDept.textContent = pos && dept ? `${pos} · ${dept}` : pos || dept || '—';
    }
    startLocationTracking();
  }

  startAutoSync();
  startSessionTimer();

  try {
    const MAP_VISITED_KEY = 'siomac_map_last_visited';
    const lv = parseInt(localStorage.getItem(MAP_VISITED_KEY) ?? '0', 10) || 0;
    if (!lv) localStorage.setItem(MAP_VISITED_KEY, String(Date.now()));
  } catch (_) {}

  if (nav?.['_doHdrBadgeSync']) nav['_doHdrBadgeSync']();
  const startNotif  = w()['_startNotifPolling']  as (() => void) | undefined;
  const startMsg    = w()['_startMsgSystem']      as (() => void) | undefined;
  const startTicket = w()['_startTicketSystem']   as (() => void) | undefined;
  const initRt      = w()['_initRealtime']        as ((uid: unknown) => void) | undefined;
  if (typeof startNotif  === 'function') startNotif();
  if (typeof startMsg    === 'function') startMsg();
  if (typeof startTicket === 'function') startTicket();
  if (typeof initRt      === 'function') initRt(as?.get('currentUserId'));
  if (nav?.['_scheduleHdrBadgeSync']) setInterval(nav['_scheduleHdrBadgeSync'], 30_000);

  setTimeout(function _bulkPhotoPreload() {
    const rawApi = _rawApiW();
    if (!rawApi) return;
    rawApi('listEmployees', {}).then(res => {
      const employees = (res['data'] as Record<string, unknown>[] | undefined) ?? (Array.isArray(res) ? res as Record<string, unknown>[] : []);
      employees.forEach(e => {
        if (e['username'] && e['profileImage']) _patchPhotoCache(e['username'] as string, e['profileImage'] as string);
        if (e['profileImage']) { const img = new Image(); img.src = e['profileImage'] as string; }
      });
    }).catch(() => {});
  }, 1500);
}

// ── handleLogout ──────────────────────────────────────────────────────────────

function handleLogout(): void {
  const as = _AppState();
  const currentUser   = as?.get('currentUser')   as string | null;
  const currentUserId = as?.get('currentUserId') as string | null;
  if (currentUser) void _apiW()?.('logout', { userId: currentUserId ?? '', username: currentUser });

  stopCamera();
  stopAutoSync();
  clearSession();

  const locationWatchId = as?.get('locationWatchId') as number | undefined;
  if (locationWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);

  as?.set('currentUser',     null);
  as?.set('currentUserId',   null);
  as?.set('currentFullName', null);
  as?.set('currentDeptId',   null);
  as?.set('currentRole',     null);
  as?.set('cameraStream',    null);
  as?.set('locationWatchId', null);
  as?.set('syncInterval',    null);
  as?.set('mapViewSet',      false);
  as?.set('selectedSiteId',  '');
  as?.set('siteLayerMap',    {});
  as?.set('activeEmpMarker', null);

  _currentProfileImage = null;
  _clearPhotoCache();
  _resetLoadedState();

  const lmSel = document.getElementById('lmSiteSelect') as HTMLSelectElement | null;
  if (lmSel) { lmSel.innerHTML = '<option value="">— Select a project site —</option>'; lmSel.value = ''; }

  if (_attFpFrom && typeof _attFpFrom.destroy === 'function') { _attFpFrom.destroy(); } _attFpFrom = null;
  if (_attFpTo   && typeof _attFpTo.destroy   === 'function') { _attFpTo.destroy();   } _attFpTo   = null;

  const stopNotif  = w()['_stopNotifPolling']  as (() => void) | undefined;
  const stopMsg    = w()['_stopMsgSystem']      as (() => void) | undefined;
  const stopTicket = w()['_stopTicketSystem']   as (() => void) | undefined;
  const teardownRt = w()['_teardownRealtime']   as (() => void) | undefined;
  if (typeof stopNotif  === 'function') stopNotif();
  if (typeof stopMsg    === 'function') stopMsg();
  if (typeof stopTicket === 'function') stopTicket();
  if (typeof teardownRt === 'function') teardownRt();

  document.getElementById('appShell')?.classList.add('hidden');
  document.getElementById('loginPage')?.classList.remove('hidden');
  document.documentElement.classList.remove('app-active');
  document.body.classList.remove('app-active');
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  const sidebarMenu = document.getElementById('sidebarMenu');
  if (sidebarMenu) sidebarMenu.innerHTML = '';
  const pwEl = document.getElementById('password') as HTMLInputElement | null;
  if (pwEl) pwEl.value = '';
  const loginForm = document.getElementById('loginForm') as HTMLFormElement | null;
  loginForm?.reset();

  // Reset login panels back to the credentials form. The LoginPage component
  // is not remounted on logout, so the 2FA verify/setup panels stay visible
  // unless we restore the default panel visibility here.
  if (loginForm) loginForm.style.display = '';
  const twoFaPanel      = document.getElementById('twoFaPanel');
  const twoFaSetupPanel = document.getElementById('twoFaSetupPanel');
  if (twoFaPanel)      twoFaPanel.style.display      = 'none';
  if (twoFaSetupPanel) twoFaSetupPanel.style.display = 'none';

  // Sync Zustand session store on logout
  try {
    const store = (w() as Record<string, unknown>)['__siomacSessionStore'] as
      { getState: () => { logout: () => void } } | undefined;
    store?.getState().logout();
  } catch (_) {}
}

// ── Camera ────────────────────────────────────────────────────────────────────

function stopCamera(): void {
  const as = _AppState();
  const cameraStream = as?.get('cameraStream') as MediaStream | null | undefined;
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    as?.set('cameraStream', null);
  }
}

// ── Location tracking ─────────────────────────────────────────────────────────

function startLocationTracking(): void {
  const as = _AppState();
  if (navigator.geolocation) {
    const opts: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    const watchId = navigator.geolocation.watchPosition(updateLocationInfo, handleLocationError, opts);
    as?.set('locationWatchId', watchId);
    void getCurrentLocation().then(loc => {
      updateLocationInfo({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy } } as GeolocationPosition);
    });
  } else {
    const el = document.getElementById('currentLocation');
    if (el) el.textContent = 'Geolocation is not supported by this browser.';
  }
}

function updateLocationInfo(position: GeolocationPosition): void {
  const as = _AppState();
  const { latitude, longitude, accuracy } = position.coords;
  as?.set('userLocation', { lat: latitude, lng: longitude, accuracy });

  const locationEl = document.getElementById('currentLocation');
  if (locationEl) locationEl.innerHTML = `<a href="https://maps.google.com/?q=${latitude},${longitude}" target="_blank" class="location-map-link"><i class="fas fa-external-link-alt me-1"></i>View on Map (${latitude.toFixed(6)}, ${longitude.toFixed(6)})</a>`;

  const accEl = document.getElementById('locationAccuracy');
  if (accuracy && accEl) {
    accEl.textContent = `Accuracy: ${Math.round(accuracy)} meters`;
    accEl.style.color = accuracy > 100 ? '#ef4444' : accuracy > 50 ? '#f59e0b' : '#10b981';
  }

  const map        = as?.get('map')        as Record<string, unknown> | undefined;
  const userMarker = as?.get('userMarker') as Record<string, unknown> | undefined;
  if (map && userMarker) {
    (userMarker['setLatLng'] as (ll: number[]) => void)?.([latitude, longitude]);
  } else if (map && !userMarker) {
    _LiveMap()?.['updateUserLocationOnMap']?.();
  }
}

function handleLocationError(error: GeolocationPositionError): void {
  let message = '';
  switch (error.code) {
    case error.PERMISSION_DENIED:    message = 'Location access denied. Please enable location permissions.'; break;
    case error.POSITION_UNAVAILABLE: message = 'Location information unavailable.'; break;
    case error.TIMEOUT:              message = 'Location request timed out.'; break;
    default:                         message = 'An unknown location error occurred.'; break;
  }
  const locEl = document.getElementById('currentLocation');
  if (locEl) locEl.textContent = message;
  const accEl = document.getElementById('locationAccuracy');
  if (accEl) accEl.textContent = '';
}

// ── Auto-sync ─────────────────────────────────────────────────────────────────

const _noSyncSections = new Set(['s-settings', 's-profile', 's-payroll', 's-adm-rates']);

function _userIsInteracting(): boolean {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (document.querySelector('.modal.show')) return true;
  if (_Dashboard()?.['getDashEditMode']?.()) return true;
  return false;
}

function startAutoSync(): void {
  const as = _AppState();
  const id = setInterval(syncData, 60_000);
  as?.set('syncInterval', id);
}

function stopAutoSync(): void {
  const as = _AppState();
  const syncInterval = as?.get('syncInterval') as ReturnType<typeof setInterval> | undefined;
  if (syncInterval != null) { clearInterval(syncInterval); as?.set('syncInterval', null); }
}

function syncData(): void {
  _AppState()?.set('lastSyncTime', new Date().toISOString());
  refreshCurrentView();
}

function refreshCurrentView(): void {
  if (_userIsInteracting()) return;
  const active = document.querySelector<HTMLElement>('.app-section.active');
  if (active && !_noSyncSections.has(active.id)) _Nav()?.['refreshSection']?.(active.id);
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function updateClock(): void {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const isoDate = now.toISOString().slice(0, 10);
  const set = (id: string, txt: string): void => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('isoClock',    `${timeStr} · ${dateStr}`);
  set('currentTime', now.toTimeString().slice(0, 8));
  set('currentDate', isoDate);
}

function initializeDateSelectors(): void {
  const now          = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth();

  const yearSelect = document.getElementById('attendanceYear') as HTMLSelectElement | null;
  if (yearSelect) {
    yearSelect.innerHTML = '';
    for (let i = currentYear - 2; i <= currentYear; i++) {
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = String(i);
      if (i === currentYear) opt.selected = true;
      yearSelect.appendChild(opt);
    }
  }
  const monthSelect = document.getElementById('attendanceMonth') as HTMLSelectElement | null;
  if (monthSelect) monthSelect.value = String(currentMonth);

  const todayStr   = now.toISOString().slice(0, 10);
  const monthStart = new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10);

  if (typeof flatpickr !== 'undefined') {
    const fromEl = document.getElementById('attDateFrom') as HTMLElement & { _flatpickr?: { destroy: () => void } } | null;
    const toEl   = document.getElementById('attDateTo')   as HTMLElement & { _flatpickr?: { destroy: () => void } } | null;
    fromEl?._flatpickr?.destroy();
    toEl?._flatpickr?.destroy();

    _attFpFrom = flatpickr('#attDateFrom', {
      dateFormat: 'Y-m-d', maxDate: 'today', defaultDate: monthStart, allowInput: false, disableMobile: true,
      onChange: (selectedDates: Date[], dateStr: string) => {
        if (_attFpTo) _attFpTo.set('minDate', dateStr);
        if (_attFpTo && _attFpTo.selectedDates[0] && _attFpTo.selectedDates[0] < selectedDates[0]!) _attFpTo.setDate(dateStr, false);
      },
    } as Record<string, unknown>);
    _attFpTo = flatpickr('#attDateTo', { dateFormat: 'Y-m-d', maxDate: 'today', minDate: monthStart, defaultDate: todayStr, allowInput: false, disableMobile: true } as Record<string, unknown>);
  }
}

// ── setupEventListeners ───────────────────────────────────────────────────────

function setupEventListeners(): void {
  const nav    = _Nav();
  const liveMap = _LiveMap();
  const payroll = _Payroll();
  const attView = _AttView();
  const sv      = _SettingsView();

  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

  // Mark attendance
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('#markAttendanceBtn')) liveMap?.['markProjectAttendance']?.();
  });

  // Input filters
  document.addEventListener('input', (e) => {
    const tgt = e.target as HTMLInputElement;
    if (tgt.matches('#attSearchInput')) {
      const rt = w()['_renderAttTable'] as (() => void) | undefined;
      const rc = w()['_renderAttConsistency'] as (() => void) | undefined;
      attView?.['loadAttendanceData']?.();
      rt?.();
      rc?.();
    }
    if (tgt.matches('#hrSearchInput'))                                          payroll?.['_hrSearch']?.(tgt.value);
    if (tgt.matches('#prsMonthlySalary, #prsHourlyRate, #prsStdHours'))         payroll?.['_prsRefreshEstimate']?.();

    // Rate input live dirty + stats
    const inp = tgt.closest<HTMLInputElement>('.rate-input');
    if (inp) {
      inp.classList.toggle('dirty', String(inp.value) !== String(inp.dataset['original']));
      const ratesData  = w()['_ratesData'] as Record<string, unknown>[] | undefined;
      const hrUpdateStats = w()['_hrUpdateStats'] as ((d: unknown[]) => void) | undefined;
      if (ratesData && hrUpdateStats) {
        const snapshot = ratesData.map(r => {
          const liveInp = document.querySelector<HTMLInputElement>(`.rate-input[data-username="${cssEscape((r['username'] as string) ?? '')}"]`);
          const liveVal = liveInp ? parseFloat(liveInp.value) : NaN;
          return Object.assign({}, r, { hourlyRate: isNaN(liveVal) ? (r['hourlyRate'] ?? 0) : liveVal });
        });
        hrUpdateStats(snapshot);
      }
    }
  });

  // Change events
  document.addEventListener('change', (e) => {
    const tgt = e.target as HTMLInputElement | HTMLSelectElement;

    if (tgt.matches('#lmSiteSelect')) {
      const as         = _AppState();
      const val        = (tgt as HTMLSelectElement).value;
      const siteLayerMap = (as?.get('siteLayerMap') ?? {}) as Record<string, { site: { name: string; latitude: string; longitude: string; radius: string }; marker?: Record<string, unknown> }>;
      if (val) {
        const entry = siteLayerMap[val];
        liveMap?.['_selectLiveSite']?.(val, entry?.site.name ?? val);
        if (entry?.site) {
          const map = as?.get('map') as Record<string, unknown> | undefined;
          if (map) {
            const lat = Number(entry.site.latitude), lng = Number(entry.site.longitude), rad = Number(entry.site.radius) || 200;
            if (lat && lng) {
              const bounds = L.latLng(lat, lng).toBounds(rad * 4);
              (map['fitBounds'] as (b: unknown, o: unknown) => void)?.(bounds, { padding: [40, 40], animate: false });
              if (entry.marker) (entry.marker['openPopup'] as () => void)?.();
            }
          }
        }
      } else {
        liveMap?.['_clearLiveSite']?.();
      }
    }

    if (tgt.matches('#attendanceMonth') || tgt.matches('#attendanceYear')) {
      const as = _AppState();
      if ((as?.get('attFilterMode') as string ?? 'month') === 'month') attView?.['loadAttendanceData']?.();
    }
    if (tgt.matches('#attDeptFilter')) {
      const rt = w()['_renderAttTable']       as (() => void) | undefined;
      const rc = w()['_renderAttConsistency'] as (() => void) | undefined;
      rt?.(); rc?.();
    }
    if (tgt.matches('#hrDeptFilter'))  payroll?.['_hrDept']?.(tgt.value);
    if (tgt.matches('#hrRoleFilter'))  payroll?.['_hrRole']?.(tgt.value);
    if (tgt.matches('#hrFileInput'))   {
      const f = (tgt as HTMLInputElement).files?.[0];
      (tgt as HTMLInputElement).value = '';
      if (f) payroll?.['_hrHandleFile']?.(f);
    }
    if (tgt.matches('#prsNis, #prsHs, #prsTax')) payroll?.['_prsRefreshEstimate']?.();
    if (tgt.id === 'logoFileInput')       { const fn = w()['onLogoPicked']         as ((f: File) => void) | undefined; const f = (tgt as HTMLInputElement).files?.[0]; if (f && fn) fn(f); }
    if (tgt.id === 'profileImageInput')   { const fn = w()['onProfileImagePicked'] as ((f: File) => void) | undefined; const f = (tgt as HTMLInputElement).files?.[0]; if (f && fn) fn(f); }
  });

  // Click delegation
  document.addEventListener('click', (e) => {
    const tgt = e.target as Element;

    // Attendance export
    if (tgt.closest?.('#exportAttendanceBtn')) {
      const btn = document.querySelector<HTMLElement>('.dt-button.buttons-csv, .dt-button.buttons-excel');
      if (btn) btn.click(); else showPopup('info', 'Export', 'Use the DataTable export buttons to download.');
    }

    // Attendance mode toggle
    const modeBtn = tgt.closest<HTMLElement>('.att-mode-btn');
    if (modeBtn) {
      const mode = modeBtn.dataset['mode']; if (!mode) return;
      const as = _AppState();
      as?.set('attFilterMode', mode);
      document.querySelectorAll<HTMLElement>('.att-mode-btn').forEach(b => b.classList.toggle('active', b.dataset['mode'] === mode));
      const monthPickers = document.getElementById('attMonthPickers');
      const rangePickers = document.getElementById('attRangePickers');
      if (monthPickers) monthPickers.style.display = mode === 'month' ? '' : 'none';
      if (rangePickers) rangePickers.style.display = mode === 'range' ? '' : 'none';
      if (mode === 'month') {
        _swr()?.clearByPrefix('listDailyLog:');
        _swrLastHash()?.forEach((_, k) => { if (k.startsWith('listDailyLog:')) _swrLastHash()?.delete(k); });
        attView?.['loadAttendanceData']?.();
      }
    }

    // Date range apply
    if (tgt.closest?.('#attApplyRange')) {
      const from = _attFpFrom?.selectedDates[0] ? _attFpFrom.formatDate(_attFpFrom.selectedDates[0], 'Y-m-d') : '';
      if (!from) { showPopup('warning', 'Date Required', 'Please select a start date.'); return; }
      _swr()?.clearByPrefix('listDailyLog:');
      _swrLastHash()?.forEach((_, k) => { if (k.startsWith('listDailyLog:')) _swrLastHash()?.delete(k); });
      attView?.['loadAttendanceData']?.();
    }

    // Admin leave actions
    const btnViewLeave   = tgt.closest<HTMLElement>('.btn-view-leave');
    const btnPrintLeave  = tgt.closest<HTMLElement>('.btn-print-leave');
    const btnEditLeave   = tgt.closest<HTMLElement>('.btn-edit-leave');
    const btnDeleteLeave = tgt.closest<HTMLElement>('.btn-delete-leave');
    const LeaveView = w()['LeaveView'] as Record<string, (...a: unknown[]) => unknown> | undefined;
    if (btnViewLeave)   LeaveView?.['viewLeaveDoc']?.(btnViewLeave.dataset['id'], false);
    if (btnPrintLeave)  LeaveView?.['viewLeaveDoc']?.(btnPrintLeave.dataset['id'], true);
    if (btnEditLeave)   { const fn = w()['openEditLeaveModal'] as ((id: string) => void) | undefined; if (fn) fn(btnEditLeave.dataset['id'] ?? ''); }
    if (btnDeleteLeave) { const fn = w()['deleteLeaveRecord']  as ((id: string) => void) | undefined; if (fn) fn(btnDeleteLeave.dataset['id'] ?? ''); }

    // Attendance selfie + emp detail panel
    const btnViewAtt = tgt.closest<HTMLElement>('.btn-view-att');
    if (btnViewAtt) { const fn = w()['viewAttendancePhotos'] as ((a: unknown, b: unknown, c: unknown) => void) | undefined; fn?.(btnViewAtt.dataset['in'], btnViewAtt.dataset['out'], btnViewAtt.dataset['name']); }
    const btnViewEmpDetail = tgt.closest<HTMLElement>('.btn-view-emp-detail');
    if (btnViewEmpDetail) { const fn = w()['_openAttEmpPanel'] as ((u: string) => void) | undefined; fn?.(btnViewEmpDetail.dataset['username'] ?? ''); }

    // Settings palette/layout
    const pCard = tgt.closest<HTMLElement>('.palette-card');
    if (pCard) nav?.['savePalette']?.(pCard.dataset['palette']);
    const lCard = tgt.closest<HTMLElement>('.layout-card');
    if (lCard) nav?.['saveLayout']?.(lCard.dataset['layout']);

    // Top tabs
    const tabBtn = tgt.closest<HTMLElement>('#topTabs button[data-section]');
    if (tabBtn) nav?.['showSection']?.(tabBtn.dataset['section']);

    // Live map controls
    if (tgt.closest?.('#refreshLiveMapBtn')) { _spinBtn('refreshLiveMapBtn'); liveMap?.['loadLiveAttendance']?.(); }
    if (tgt.closest?.('#centerMapBtn')) {
      const as = _AppState();
      const map             = as?.get('map')             as Record<string, unknown> | undefined;
      const activeEmpMarker = as?.get('activeEmpMarker') as Record<string, unknown> | undefined;
      const attendanceZones = (as?.get('attendanceZones') ?? []) as unknown[];
      if (map) {
        if (activeEmpMarker) {
          const getLatLng = activeEmpMarker['getLatLng'] as (() => unknown) | undefined;
          (map['setView'] as (ll: unknown, z: number, o: unknown) => void)?.(getLatLng?.(), 16, { animate: true });
        } else if (attendanceZones.length) {
          try { (map['fitBounds'] as (b: unknown) => void)?.(L.featureGroup(attendanceZones).getBounds().pad(0.25)); } catch (_) {}
        } else {
          (map['setView'] as (ll: number[], z: number) => void)?.([10.6549, -61.5019], 12);
        }
      }
    }
    const liveCard = tgt.closest<HTMLElement>('.lm-emp-item, .live-emp-card');
    if (liveCard && tgt.closest('#s-projectMap')) liveMap?.['focusLiveEmployee']?.(String(liveCard.dataset['id'] ?? liveCard.dataset['userid'] ?? ''));

    // Hourly rates
    if (tgt.closest?.('#refreshRatesBtn'))   payroll?.['loadHourlyRates']?.();
    if (tgt.closest?.('#saveAllRatesBtn'))   payroll?.['_hrSaveAll']?.();
    if (tgt.closest?.('#exportRatesCsvBtn')) payroll?.['_hrExportCsv']?.();
    if (tgt.closest?.('#importRatesCsvBtn')) payroll?.['_hrOpenModal']?.();
    if (tgt.closest?.('#hrCloseModalBtn') || tgt.closest?.('#hrCancelModalBtn')) payroll?.['_hrCloseModal']?.();
    if (tgt.closest?.('#hrConfirmImportBtn')) payroll?.['_hrConfirmImport']?.();
    if (tgt.closest?.('#hrFileDrop') || tgt.closest?.('#hrFileDrop label')) document.getElementById('hrFileInput')?.click();
    if (tgt.closest?.('#hrResetFiltersBtn')) {
      payroll?.['_hrSearch']?.(''); payroll?.['_hrDept']?.('all'); payroll?.['_hrRole']?.('all');
      const si = document.getElementById('hrSearchInput')  as HTMLInputElement | null;
      const df = document.getElementById('hrDeptFilter')   as HTMLSelectElement | null;
      const rf = document.getElementById('hrRoleFilter')   as HTMLSelectElement | null;
      if (si) si.value = ''; if (df) df.value = 'all'; if (rf) rf.value = 'all';
      payroll?.['renderHourlyRates']?.();
    }
    const saveBtn = tgt.closest<HTMLElement>('.btn-save-rate');
    if (saveBtn) payroll?.['saveHourlyRate']?.(saveBtn.dataset['username'], saveBtn);

    // Payroll settings modal
    if (tgt.closest?.('#prsCloseBtn') || tgt.closest?.('#prsCancelBtn')) payroll?.['_prsClose']?.();
    if (tgt.closest?.('#prsSaveBtn'))  payroll?.['_prsSave']?.();
    if ((tgt as HTMLElement).id === 'prSettingsModal') payroll?.['_prsClose']?.();

    // Payroll constants modal
    if (tgt.closest?.('#prSettingsBtn'))    payroll?.['_prcOpen']?.();
    if (tgt.closest?.('#prcCloseBtn') || tgt.closest?.('#prcCancelBtn')) payroll?.['_prcClose']?.();
    if (tgt.closest?.('#prcVerifyBtn'))     payroll?.['_prcVerify']?.();
    if (tgt.closest?.('#prcSaveBtn'))       payroll?.['_prcSave']?.();
    if (tgt.closest?.('#prcRestoreBtn'))    payroll?.['_prcRestoreDefaults']?.();
    if ((tgt as HTMLElement).id === 'prConstantsModal') payroll?.['_prcClose']?.();
    const prcTab = tgt.closest<HTMLElement>('.prc-tab');
    if (prcTab?.dataset['prcTab']) {
      document.querySelectorAll('.prc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.prc-panel').forEach(p => p.classList.remove('active'));
      prcTab.classList.add('active');
      const panel = document.getElementById('prc-' + prcTab.dataset['prcTab']);
      panel?.classList.add('active');
    }

    // Pay cycle/basis pills
    const prsCyclePill = tgt.closest<HTMLElement>('#prsCycleGroup .prs-pill');
    if (prsCyclePill) {
      document.querySelectorAll('#prsCycleGroup .prs-pill').forEach(p => p.classList.remove('active'));
      prsCyclePill.classList.add('active');
      const cyEl = document.getElementById('prsPayCycle') as HTMLInputElement | null;
      if (cyEl) cyEl.value = prsCyclePill.dataset['val'] ?? '';
      payroll?.['_prsRefreshEstimate']?.();
    }
    const prsBasisPill = tgt.closest<HTMLElement>('#prsBasisGroup .prs-pill');
    if (prsBasisPill) {
      document.querySelectorAll('#prsBasisGroup .prs-pill').forEach(p => p.classList.remove('active'));
      prsBasisPill.classList.add('active');
      const bsEl = document.getElementById('prsPayBasis') as HTMLInputElement | null;
      if (bsEl) bsEl.value = prsBasisPill.dataset['val'] ?? '';
      payroll?.['_prsToggleRateRows']?.(prsBasisPill.dataset['val']);
      payroll?.['_prsRefreshEstimate']?.();
    }

    // Payroll filter panel toggle
    if (tgt.closest?.('#prFilterToggle')) {
      const toggle = document.getElementById('prFilterToggle');
      const expand = document.getElementById('prFilterExpand');
      if (toggle && expand) { const open = expand.classList.toggle('open'); toggle.classList.toggle('active', open); }
    }

    // Payroll mode + actions
    if (tgt.closest?.('#prReportBtn'))        payroll?.['_prToggleReportsMode']?.();
    if (tgt.closest?.('#prApplyBtn'))         (payroll?.['_prReportsMode'] ? payroll?.['_prRunReportsSearch'] : payroll?.['_prRunPayroll'])?.();
    if (tgt.closest?.('#prSendApprovalBtn'))  payroll?.['_prSendForApproval']?.();
    const prPayslipBtn = tgt.closest<HTMLElement>('.pr-payslip-btn');
    if (prPayslipBtn) payroll?.['_prOpenPayslip']?.(prPayslipBtn.dataset['uid']);
    const prEditBtn = tgt.closest<HTMLElement>('.pr-edit-btn');
    if (prEditBtn) payroll?.['_prOpenEditPayroll']?.(prEditBtn.dataset['uid']);

    // Profile actions
    if (tgt.closest?.('#pickProfileImageBtn') || tgt.closest?.('#editAvatarBtn'))  { const fn = w()['pickProfileImage']    as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#removeProfileImageBtn'))  { const fn = w()['removeProfileImage']  as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#saveProfileBtn'))          { const fn = w()['saveMyProfile']       as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#updateSecurityBtn'))        { const fn = w()['_updateSecurityOnly'] as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#uploadDocBtn'))             _profileToast('Document upload coming soon.', false);

    // Admin branding + payroll rules
    if (tgt.closest?.('#pickLogoBtn'))             { const fn = w()['pickLogo']            as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#saveLogoBtn'))             { const fn = w()['saveLogo']            as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#savePayrollSettingsBtn'))  { const fn = w()['savePayrollSettings'] as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#saveWorkHoursBtn'))        { const fn = w()['saveWorkHours']       as (() => void) | undefined; fn?.(); }

    // Leave tabs
    const lvTab = tgt.closest<HTMLElement>('.lv-tab-btn');
    if (lvTab) {
      const id = lvTab.dataset['lvTab'];
      if (id) {
        const as = _AppState();
        const section = lvTab.closest('.app-section');
        section?.querySelectorAll('.lv-tab-btn').forEach(b => b.classList.remove('active'));
        lvTab.classList.add('active');
        if (id.startsWith('emp-'))      { as?.set('lvEmpTab', id);  (w()['_renderEmpLeaves'] as (() => void) | undefined)?.(); }
        else if (id.startsWith('mgr-')) { as?.set('lvMgrTab', id);  (w()['_renderMgrLeaves'] as (() => void) | undefined)?.(); }
        else if (id.startsWith('adm-')) { as?.set('lvAdmTab', id);  (w()['_renderAdmLeaves'] as (() => void) | undefined)?.(); }
      }
    }

    // Settings nav
    const stgNav = tgt.closest<HTMLElement>('.stg-nav-item');
    if (stgNav?.dataset['stgTab']) sv?.['_stgActivatePanel']?.(stgNav.dataset['stgTab'], true);

    // Profile tabs
    const epTab = tgt.closest<HTMLElement>('.ep-tab-btn');
    if (epTab) {
      document.querySelectorAll('.ep-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ep-tab-pane').forEach(p => p.classList.remove('active'));
      epTab.classList.add('active');
      const pane = document.getElementById('ep-tab-' + epTab.dataset['epTab']);
      pane?.classList.add('active');
    }

    // Settings save all / reset / clear cache
    if (tgt.closest?.('#saveAllSettingsBtn')) { const fn = w()['savePayrollSettings'] as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#resetDefaultsBtn'))   { const fn = w()['_stgResetDefaults']   as (() => void) | undefined; fn?.(); }
    if (tgt.closest?.('#clearCacheBtn')) {
      _SwCacheMgr()?.['clearAll']?.();
      localStorage.clear();
      void _cpop()?.fire({ icon: 'success', title: 'Cache cleared', text: 'Page will reload.', showConfirmButton: true }).then(() => location.reload());
    }
  });

  // Profile icon → profile section
  document.getElementById('hdrProfileBtn')?.addEventListener('click', () => nav?.['showSection']?.('s-profile'));

  // Dashboard today date
  const dashDate = document.getElementById('dashTodayDate');
  const dashDay  = document.getElementById('dashTodayDay');
  if (dashDate) {
    const now = new Date();
    dashDate.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(now);
    if (dashDay) dashDay.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  }

  // Dashboard theme toggle
  (function(): void {
    const btnLight = document.getElementById('dashThemeLight');
    const btnDark  = document.getElementById('dashThemeDark');
    if (!btnLight || !btnDark) return;
    function applyTheme(t: string): void {
      document.body.setAttribute('data-theme', t);
      btnLight!.classList.toggle('active', t === 'light');
      btnDark!.classList.toggle('active',  t === 'dark');
      localStorage.setItem('siomac-theme', t);
    }
    const saved = localStorage.getItem('siomac-theme') ?? 'light';
    applyTheme(saved);
    btnLight.addEventListener('click', () => applyTheme('light'));
    btnDark.addEventListener('click',  () => applyTheme('dark'));
  })();

  // Sidebar click
  document.getElementById('sidebarMenu')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('button[data-section]');
    if (btn) nav?.['showSection']?.(btn.dataset['section']);
  });

  // Pinned user card → My Profile
  document.getElementById('sidebarUserCard')?.addEventListener('click', () => nav?.['showSection']?.('s-profile'));

  // Sidebar search button → open the command palette (⌘K)
  document.getElementById('sidebarSearchBtn')?.addEventListener('click', () => {
    (w()['openCommandPalette'] as (() => void) | undefined)?.();
  });
}

// ── init ──────────────────────────────────────────────────────────────────────

export function init(): void {
  try {
    const savedPalette = localStorage.getItem('colorScheme');
    if (savedPalette) { currentColorScheme = savedPalette; _Nav()?.['applyPalette']?.(savedPalette); }
    const savedLayout = localStorage.getItem('layoutMode');
    if (savedLayout)  { currentLayoutMode  = savedLayout;  _Nav()?.['applyLayout']?.(savedLayout); }
  } catch (_) {}

  try {
    const cached   = loadSession();
    const branRaw  = localStorage.getItem('siomac_branding');
    const branding: Record<string, unknown> | null = cached ?? (branRaw ? JSON.parse(branRaw) as Record<string, unknown> : null);
    const sv = _SettingsView();
    if (branding?.['companyName'])   sv?.['applyCompanyName']?.(branding['companyName'] as string);
    if (branding?.['companyLogoUrl']) sv?.['applyCompanyLogo']?.(branding['companyLogoUrl'] as string);
    else sv?.['applyCompanyLogo']?.('');
  } catch (_) { _SettingsView()?.['applyCompanyLogo']?.(''); }

  // Only fetch settings when a valid session exists — avoids a 401 on the
  // login screen that would otherwise trigger the session-expiry handler.
  const rawApi = _rawApiW();
  const _hasSession = !!loadSession();
  if (rawApi && _hasSession) {
    rawApi('getSettings', {}).then(res => {
      const s = (res['data'] as Record<string, unknown> | undefined) ?? (res as Record<string, unknown>);
      const logoUrl = (s['companyLogoUrl'] ?? s['logoUrl'] ?? '') as string;
      const name    = (s['companyName'] ?? '') as string;
      const sv = _SettingsView();
      sv?.['applyCompanyLogo']?.(logoUrl);
      if (name) sv?.['applyCompanyName']?.(name);
      sv?.['setCompanyInfo']?.({ name, address: s['companyAddress'] ?? '', phone: s['companyPhone'] ?? '', email: s['companyEmail'] ?? '', nis: s['companyNIS'] ?? '', bir: s['companyBIR'] ?? '', logoUrl });

      const currentRole = _AppState()?.get('currentRole') as string | undefined;
      if (currentRole === 'admin' || currentRole === 'manager') {
        rawApi('getPayrollConstants', {}).then(cr => {
          if (cr?.['success'] && cr['data']) {
            const d = cr['data'] as Record<string, number>;
            sv?.['setStatutoryRates']?.({ allowanceAnnual: d['PERSONAL_ALLOWANCE_ANNUAL'] ?? 90000, nisRate: Math.round((d['NIS_RATE'] ?? 0.06) * 100), payeRateLow: Math.round((d['PAYE_RATE_LOW'] ?? 0.25) * 100), payeRateHigh: Math.round((d['PAYE_RATE_HIGH'] ?? 0.30) * 100) });
          }
        }).catch(() => {});
      }

      try {
        const sess = loadSession();
        if (sess) updateStoredSession({ companyLogoUrl: logoUrl, companyName: name || sess['companyName'] as string });
        else localStorage.setItem('siomac_branding', JSON.stringify({ companyLogoUrl: logoUrl, companyName: name }));
      } catch (_) {}
    }).catch(() => {});
  }

  setupEventListeners();
  _Nav()?.['setupSidebar']?.();

  updateClock();
  setInterval(updateClock, 1000);
  initializeDateSelectors();

  const sess = loadSession();
  if (sess) applySession(sess as unknown as Record<string, unknown>, false);
}

// ── Public API object ─────────────────────────────────────────────────────────

export const AttendanceSystem = {
  init,
  goTo(sectionId: string): void {
    const btn = document.querySelector<HTMLElement>(`.sidebar-menu button[data-section="${sectionId}"]`);
    if (btn) { btn.click(); return; }
    _Nav()?.['showSection']?.(sectionId);
  },
  _buildPayslipHtml,
  _completeLogin,
  // Exported for legacy callers
  setPhone,
  readPhone,
  fmtLocalTime,
  escapeHtml,
  cssEscape,
  showSpinner,
  hideSpinner,
  showPopup,
  handleLogout,
  refreshCurrentView,
  startSessionTimer,
  stopSessionTimer,
  saveSession,
  loadSession,
  clearSession,
  updateSessionWidget,
};

// ── Window registrations ──────────────────────────────────────────────────────

const _w = w() as Record<string, unknown>;
_w['AttendanceSystem']  = AttendanceSystem;
_w['_buildPayslipHtml'] = _buildPayslipHtml;   // kept for payroll.js / employees.js
_w['setPhone']          = setPhone;
_w['readPhone']         = readPhone;
_w['showSpinner']       = showSpinner;
_w['hideSpinner']       = hideSpinner;
_w['showPopup']         = showPopup;
_w['handleLogout']      = handleLogout;
_w['refreshCurrentView']= refreshCurrentView;
_w['fmtLocalTime']      = fmtLocalTime;
_w['escapeHtml']        = escapeHtml;
_w['cssEscape']         = cssEscape;
