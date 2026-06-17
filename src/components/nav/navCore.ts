/**
 * src/components/nav/navCore.ts
 *
 * Pure DOM-manipulation helpers ported from nav.js.
 * No Preact imports — these are called from NavController's useEffect.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import type { SiomacConfig, SectionItem } from './types';
import { updateColorScheme, updateLayoutMode } from './api';

// ── Config access (loaded by config.js before main.tsx) ──────────────────────

function cfg(): SiomacConfig {
  return (window as unknown as { SiomacConfig: SiomacConfig }).SiomacConfig;
}

export function allSectionItems(): SectionItem[] {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  return ([] as SectionItem[]).concat(BASELINE_SECTIONS, ...Object.values(SECTION_DEFS), COMMON_ITEMS);
}

// ── AppState helpers ──────────────────────────────────────────────────────────

function appState(): { get: (k: string) => string; set: (k: string, v: unknown) => void } {
  return (window as unknown as { AppState: { get: (k: string) => string; set: (k: string, v: unknown) => void } }).AppState;
}

export function getRole():         string { return appState().get('currentRole')         || ''; }
export function getUser():         string { return appState().get('currentUser')        || ''; }
export function getFullName():     string { return appState().get('currentFullName')    || ''; }
export function getProfileImage(): string { return appState().get('_currentProfileImage') || ''; }
export function getScheme():       string { return appState().get('currentColorScheme') || 'navy'; }
export function getLayout():       string { return appState().get('currentLayoutMode')  || 'sidebar'; }

// ── escapeHtml ────────────────────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c,
  );
}

// ── Sidebar / top-tabs ────────────────────────────────────────────────────────

/** Whether the current role is a clocking employee (gets the Personal group). */
function isEmployeeRole(): boolean {
  const as = (window as unknown as { AppState?: { get(k: string): unknown } }).AppState;
  return as?.get('currentIsEmployee') !== false;   // default true if unknown
}

const renderNavItem = (it: SectionItem) =>
  `<li><button data-section="${esc(it.id)}" title="${esc(it.label)}">` +
  `<i class="fas ${esc(it.icon)}"></i><span>${esc(it.label)}</span></button></li>`;

const groupTitle = (label: string) =>
  `<li class="sidebar-menu-title" aria-hidden="true">${esc(label)}</li>`;

/**
 * Build the grouped sidebar (ERP IA):
 *   - pure employee (no management sections): self-service is the main nav.
 *   - role WITH management sections + is_employee: MANAGE group, then a PERSONAL
 *     group with the self-service items, then ACCOUNT.
 *   - non-employee role (e.g. superadmin): MANAGE only, no self-service.
 */
export function buildSidebar(role: string): void {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  const main      = SECTION_DEFS[role] ?? [];
  const personal  = isEmployeeRole() ? BASELINE_SECTIONS : [];

  let html = '';
  if (main.length === 0 && personal.length > 0) {
    // Pure employee: self-service IS the main nav (no group header needed).
    html = personal.map(renderNavItem).join('');
  } else {
    if (main.length) {
      html += groupTitle('Manage') + main.map(renderNavItem).join('');
    }
    if (personal.length) {
      html += groupTitle('Personal') + personal.map(renderNavItem).join('');
    }
  }
  html += groupTitle('Account') + COMMON_ITEMS.map(renderNavItem).join('');

  const menu = document.getElementById('sidebarMenu');
  if (menu) menu.innerHTML = html;
  refreshNavBadges(0);
}

export function buildTopTabs(role: string): void {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  const personal = isEmployeeRole() ? BASELINE_SECTIONS : [];
  // Top-tabs are flat: management first, then personal, then account.
  const items = (SECTION_DEFS[role] ?? []).concat(personal, COMMON_ITEMS);
  const tabs = document.getElementById('topTabs');
  if (tabs) {
    tabs.innerHTML = items.map(it =>
      `<button data-section="${esc(it.id)}" title="${esc(it.label)}">` +
      `<i class="fas ${esc(it.icon)}"></i><span>${esc(it.label)}</span></button>`,
    ).join('');
  }
  refreshNavBadges(0);
}

// ── Palette / layout ──────────────────────────────────────────────────────────

export function applyPalette(id: string): void {
  const { PALETTES } = cfg();
  const p = PALETTES.find(x => x.id === id) ?? PALETTES[0];
  if (!p) return;
  const root = document.documentElement.style;
  root.setProperty('--navy-primary', p.primary);
  root.setProperty('--navy-dark',    p.dark);
  root.setProperty('--navy-light',   p.light);
  root.setProperty('--navy-accent',  p.accent);
  root.setProperty('--navy-hover',   p.hover);
  try { localStorage.setItem('colorScheme', p.id); } catch (_) {}
}

export function renderPalettes(): void {
  const { PALETTES } = cfg();
  const current = getScheme();
  const html = PALETTES.map(p =>
    `<div class="palette-card ${p.id === current ? 'active' : ''}" data-palette="${esc(p.id)}">` +
    `<div class="palette-name">${esc(p.name)}</div>` +
    `<div class="palette-swatches">` +
    `<div class="palette-swatch" style="background:${esc(p.primary)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.dark)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.light)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.accent)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.hover)};"></div>` +
    `</div>` +
    `<div class="palette-preview" style="background:linear-gradient(135deg,${esc(p.primary)} 0%,${esc(p.accent)} 100%);"></div>` +
    `</div>`,
  ).join('');
  const grid = document.getElementById('paletteGrid');
  if (grid) grid.innerHTML = html;
}

export function applyLayout(mode: string): void {
  const { LAYOUTS } = cfg();
  const valid = LAYOUTS.find(l => l.id === mode) ? mode : 'sidebar';
  document.body.classList.remove('layout-sidebar', 'layout-tabs');
  document.body.classList.add('layout-' + valid);
  try { localStorage.setItem('layoutMode', valid); } catch (_) {}
  if (valid === 'tabs' && getRole()) buildTopTabs(getRole());
}

export function renderLayouts(): void {
  const { LAYOUTS } = cfg();
  const html = LAYOUTS.map(l =>
    `<div class="layout-card ${l.id === getLayout() ? 'active' : ''}" data-layout="${esc(l.id)}">` +
    `<div class="layout-icon"><i class="fas ${esc(l.icon)}"></i></div>` +
    `<div class="layout-name">${esc(l.name)}</div>` +
    `<div class="layout-desc">${esc(l.desc)}</div></div>`,
  ).join('');
  const grid = document.getElementById('layoutGrid');
  if (grid) grid.innerHTML = html;
}

export async function savePalette(id: string): Promise<void> {
  const prev = getScheme();
  appState().set('currentColorScheme', id);
  applyPalette(id);
  renderPalettes();
  // Reload charts if on dashboard
  const win = window as unknown as Record<string, { loadDashboardCharts?: (f?: boolean) => void; loadChart?: () => void; loadTrendChart?: () => void }>;
  if (document.getElementById('s-adm-dashboard')?.classList.contains('active')) win['Dashboard']?.loadDashboardCharts?.(true);
  const sc = win['SiomacCharts'] as { hasAttendanceChart?: () => boolean; hasTrendChart?: () => boolean } | undefined;
  if (sc?.hasAttendanceChart?.()) win['Dashboard']?.loadChart?.();
  if (sc?.hasTrendChart?.())      win['Dashboard']?.loadTrendChart?.();

  const res = await updateColorScheme({ username: getUser(), scheme: id });
  if (!res.success) {
    appState().set('currentColorScheme', prev);
    applyPalette(prev);
    renderPalettes();
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('error', 'Failed to save', res.message || 'Could not persist theme');
  } else {
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('success', 'Theme Saved', `${cfg().PALETTES.find(p => p.id === id)?.name ?? id} applied.`);
  }
}

export async function saveLayout(mode: string): Promise<void> {
  if (mode === getLayout()) return;
  const prev = getLayout();
  appState().set('currentLayoutMode', mode);
  applyLayout(mode);
  renderLayouts();
  const res = await updateLayoutMode({ username: getUser(), mode });
  if (!res.success) {
    appState().set('currentLayoutMode', prev);
    applyLayout(prev);
    renderLayouts();
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('error', 'Failed to save', res.message || 'Could not switch layout');
  } else {
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('success', 'Layout Saved', `${cfg().LAYOUTS.find(l => l.id === mode)?.name ?? mode} layout active.`);
  }
}

// ── Section routing ───────────────────────────────────────────────────────────

export function showSection(id: string): void {
  const win = window as unknown as Record<string, { getDashEditMode?: () => boolean; toggleEditMode?: () => void }>;
  if (id !== 's-adm-dashboard' && win['Dashboard']?.getDashEditMode?.()) {
    win['Dashboard'].toggleEditMode?.();
  }
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');

  if (id === 's-adm-projects') {
    setTimeout(() => {
      const miniMaps = (window as unknown as { _getSiteMiniMaps?: () => Record<string, unknown> })._getSiteMiniMaps?.() ?? {};
      Object.values(miniMaps).forEach(m => {
        if (m && m !== 'pending') {
          try { (m as { invalidateSize: () => void }).invalidateSize(); } catch (_) {}
        }
      });
    }, 80);
  }

  try { localStorage.setItem('siomac_last_section_' + getRole(), id); } catch (_) {}

  document.querySelectorAll('.sidebar-menu button').forEach(b =>
    b.classList.toggle('active', (b as HTMLButtonElement).dataset['section'] === id));
  document.querySelectorAll('#topTabs button').forEach(b =>
    b.classList.toggle('active', (b as HTMLButtonElement).dataset['section'] === id));

  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.remove('active');

  refreshSection(id);
}

export function refreshSection(id: string): void {
  const role = getRole();
  const win  = window as unknown as Record<string, Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined>;
  const checkStatus = (window as unknown as { checkStatus?: () => void }).checkStatus;

  switch (id) {
    case 's-settings':
      win['SettingsView']?.['_stgActivatePanel']?.((role === 'admin' || role === 'superadmin') ? 'company' : 'appearance');
      renderPalettes(); renderLayouts();
      win['SettingsView']?.['loadAdminBrandingSettings']?.();
      break;
    case 's-profile':
      document.querySelectorAll('.ep-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('.ep-tab-pane').forEach((p, i) => p.classList.toggle('active', i === 0));
      win['Profile']?.['loadMyProfile']?.();
      break;
    case 's-emp-attendance':
      checkStatus?.();
      (win['Dashboard'] as { loadChart?: () => void; loadTrendChart?: () => void } | undefined)?.loadChart?.();
      (win['Dashboard'] as { loadChart?: () => void; loadTrendChart?: () => void } | undefined)?.loadTrendChart?.();
      break;
    case 's-emp-history':     win['Employees']?.['loadHistoryInline']?.();           break;
    case 's-projectMap': {
      const lmap = (window as unknown as { AppState?: { get: (k: string) => unknown } }).AppState?.get('map');
      setTimeout(() => { if (!lmap) win['LiveMap']?.['initializeMap']?.(); else (lmap as { invalidateSize: () => void }).invalidateSize(); }, 80);
      win['LiveMap']?.['loadLiveAttendance']?.();
      (window as unknown as { _clearMapBadge?: () => void })._clearMapBadge?.();
      break;
    }
    case 's-emp-leave':       win['Employees']?.['loadLeaveRequests']?.();            break;
    case 's-emp-payroll':     win['Employees']?.['loadMyPayslips']?.();               break;
    case 's-mgr-overview':    win['Employees']?.['loadDepartmentData']?.();           break;
    case 's-mgr-employees':   win['Employees']?.['loadDepartmentEmployees']?.();      break;
    case 's-mgr-leaves':      win['Employees']?.['loadManagerLeaveApplications']?.(); break;
    case 's-adm-dashboard':
      win['Employees']?.['loadDashboardData']?.();
      (win['Dashboard'] as { loadDashboardCharts?: () => void; initDashboardLayoutEditor?: () => void } | undefined)?.loadDashboardCharts?.();
      (win['Dashboard'] as { loadDashboardCharts?: () => void; initDashboardLayoutEditor?: () => void } | undefined)?.initDashboardLayoutEditor?.();
      break;
    case 's-adm-employees':   win['Employees']?.['loadEmployeeList']?.();             break;
    case 's-adm-departments': win['Employees']?.['loadDepartments']?.();              break;
    case 's-adm-projects':    win['Sites']?.['loadProjectSites']?.();                 break;
    case 's-adm-attendance':  win['AttendanceView']?.['loadAttendanceData']?.();      break;
    case 's-adm-leaves':      win['LeaveView']?.['loadLeaveApplications']?.();        break;
    case 's-adm-rates':       win['Payroll']?.['loadHourlyRates']?.();               break;
    case 's-payroll':         win['Payroll']?.['initPayrollSection']?.();             break;
  }
}

// ── Skeleton helpers (used by legacy JS modules that remain) ──────────────────

export function setSkel(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function skelStatValues(ids: string[]): void {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="skeleton skel-text-lg" style="width:60px;margin:0 auto;"></div>';
  });
}

export function skelTableRows(cols: number, rows: number): string {
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++)
      html += `<td><div class="skeleton skel-text" style="width:${50 + Math.floor(Math.random() * 40)}%;"></div></td>`;
    html += '</tr>';
  }
  return html;
}

export function skelStatCards(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="skel-stat-card"><div class="skeleton skel-icon"></div><div class="skeleton skel-text-lg" style="width:50%;"></div><div class="skeleton skel-text" style="width:75%;"></div></div>`;
  return html;
}

export function skelCards(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="skel-card"><div class="skeleton skel-text-lg" style="width:55%;"></div><div class="skeleton skel-text" style="width:90%;"></div><div class="skeleton skel-text" style="width:65%;"></div><div class="skeleton skel-text" style="width:80%;"></div></div>`;
  return html;
}

export function skelList(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="lm-emp-item lm-emp-item--skel"><div class="lm-emp-avatar skeleton"></div><div class="lm-emp-info"><div class="skeleton skel-text" style="width:55%;"></div><div class="skeleton skel-text-sm" style="width:75%;margin-top:6px;"></div></div></div>`;
  return html;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const _badgeLastCount = new WeakMap<Element, number>();

export function setHdrBadge(badge: Element | null, count: number, dot?: boolean): void {
  if (!badge) return;
  const prev = _badgeLastCount.get(badge);
  if (prev === count) return;
  _badgeLastCount.set(badge, count);
  if (dot) {
    badge.textContent = '';
    (badge as HTMLElement).style.display = count > 0 ? '' : 'none';
    return;
  }
  const label = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  badge.textContent = label;
  (badge as HTMLElement).style.display = count > 0 ? '' : 'none';
  if (count > 0 && (prev === undefined || prev === 0)) {
    (badge as HTMLElement).style.animation = 'none';
    (badge as HTMLElement).offsetWidth; // reflow
    (badge as HTMLElement).style.animation = '';
  }
}

// ── Nav leave badges ──────────────────────────────────────────────────────────

const LEAVE_SECTION_IDS = ['s-adm-leaves', 's-mgr-leaves', 's-emp-leave'];
const _sbBadgeLastLabel = new Map<string, string>();

function _setSbBadge(btn: HTMLButtonElement, count: number) {
  const key   = btn.dataset['section'] ?? btn.id;
  const label = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  if (_sbBadgeLastLabel.get(key) === label) return;
  _sbBadgeLastLabel.set(key, label);
  let b = btn.querySelector<HTMLElement>('.sb-nav-badge');
  if (count > 0) {
    if (!b) {
      b = document.createElement('span');
      b.className = 'sb-nav-badge';
      b.style.animation = 'none';
      btn.appendChild(b);
      b.offsetWidth; // reflow
    }
    b.textContent = label;
    b.style.animation = 'none'; b.offsetWidth; b.style.animation = '';
    b.classList.remove('sb-badge-bounce'); void b.offsetWidth; b.classList.add('sb-badge-bounce');
  } else {
    if (b) b.remove();
  }
}

// ── Module matrix (Superadmin) ────────────────────────────────────────────────
// Called by the superadmin console Modules tab after toggling a module permission.
// In a future phase this will rebuild the sidebar live; for now it's a no-op
// stub so the section can import it without errors.
export function setModuleMatrix(_matrix: unknown): void {
  // TODO: rebuild sidebar from updated module matrix without requiring re-login
}

export function refreshNavBadges(unreadLeaveCount: number): void {
  ['#sidebarMenu', '#topTabs'].forEach(sel => {
    document.querySelectorAll<HTMLButtonElement>(`${sel} button[data-section]`).forEach(btn => {
      if (LEAVE_SECTION_IDS.includes(btn.dataset['section'] ?? '')) {
        _setSbBadge(btn, unreadLeaveCount);
      }
    });
  });
}
