/**
 * src/components/livemap/LiveMapModule.ts
 *
 * Pure-TS port of assets/js/live-map.js.
 *
 * Implements the same public API as the original IIFE and registers itself on
 * window.LiveMap so app.js and any remaining vanilla callers keep working
 * unchanged during the migration.
 *
 * NOTE: Several helpers (`_markLoaded`, `_skelOnce`, `setSkel`, `skelList`,
 * `_countUp`, `_patchPhotoCache`, `checkStatus`, `displayProjectSites`) still
 * live in legacy scripts (nav.js / app.js) that are loaded before this module.
 * They are called via window with optional chaining so the module degrades
 * gracefully if those globals are not yet present.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { AppState }             from '@lib/appState';
import { scheduleHdrBadgeSync } from '@components/nav';

// ── Leaflet type shim ─────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const L: any;

// ── Legacy-global helper shims ────────────────────────────────────────────────
type Win = Window & typeof globalThis & Record<string, any>;
const w = (): Win => window as Win;

/** window.api() — injected by api.js */
function api(action: string, params: Record<string, unknown>): Promise<any> {
  return w().api?.(action, params) ?? Promise.resolve({ success: false });
}

/** window.apiSwr() — injected by api.js */
function apiSwr(
  action:  string,
  params:  Record<string, unknown>,
  opts:    { onData?: (res: any) => void; onError?: (err: any) => void },
): void {
  w().apiSwr?.(action, params, opts);
}

// ── Local utility helpers (no external dep) ───────────────────────────────────

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function fmtLocalTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Delegate to legacy _markLoaded(sectionId) if present. */
function markLoaded(sectionId: string): void {
  w()._markLoaded?.(sectionId);
}

/** Delegate to legacy _skelOnce(sectionId, fn) if present. */
function skelOnce(sectionId: string, fn: () => void): void {
  if (typeof w()._skelOnce === 'function') {
    w()._skelOnce(sectionId, fn);
  } else {
    fn(); // fall through if legacy not loaded yet
  }
}

function setSkel(id: string, html: string): void {
  w().setSkel?.(id, html) ?? (() => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  })();
}

function skelList(n: number): string {
  return w().skelList?.(n) ?? '';
}

function countUp(el: HTMLElement | null, target: number, suffix = '', prefix = '', thousands = false): void {
  if (!el) return;
  if (typeof w()._countUp === 'function') {
    w()._countUp(el, target, suffix, prefix, thousands);
  } else {
    el.textContent = (prefix || '') + String(target) + (suffix || '');
  }
}

function patchPhotoCache(userId: string | number | undefined, photoUrl: string): void {
  if (!userId) return;
  // Update AppState photo cache (used by avatar components)
  const cache = AppState.get('_photoCache') as Record<string, string>;
  cache[String(userId)] = photoUrl;
  AppState.set('_photoCache', cache);
  // Also delegate to legacy global if present
  w()._patchPhotoCache?.(userId, photoUrl);
}

// ── Module-local state ────────────────────────────────────────────────────────

let _liveDataHash   = '';
let _empOverlayEl:  HTMLElement | null = null;

// ── Public functions ──────────────────────────────────────────────────────────

function getCurrentLocation(): Promise<{
  latitude: number; longitude: number; accuracy: number;
  timestamp: string; fallback?: boolean;
}> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy:  pos.coords.accuracy,
        timestamp: new Date().toISOString(),
      }),
      () => resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

function verifyLocation(_userLocation: unknown): {
  verified: boolean; distance: number; nearestLocation: { name: string }; message: string;
} {
  // Testing stub — always verified
  return { verified: true, distance: 50, nearestLocation: { name: 'Test Location' }, message: 'Location verified successfully' };
}

function initializeMap(): void {
  try {
    const mapElement = document.getElementById('map');
    if (!mapElement) return;

    // Destroy existing map instance
    let lmap = AppState.get('map') as any;
    if (lmap?._container) { lmap.remove(); lmap = null; AppState.set('map', null); }

    const defaultCenter: [number, number] = [10.6549, -61.5019];

    // Request geolocation early to trigger browser permission prompt
    if (navigator.geolocation && !AppState.get('userLocation')) {
      navigator.geolocation.getCurrentPosition(
        pos => AppState.set('userLocation', {
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
        () => { /* denied — keep fallback */ },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    }

    lmap = L.map('map', { center: defaultCenter, zoom: 11, zoomAnimation: false });
    AppState.set('map', lmap);

    // Clicking the map background dismisses any open employee overlay
    lmap.on('click', () => {
      if (_empOverlayEl) {
        _removeLiveEmpOverlay();
        const active = AppState.get('_activeEmpMarker') as any;
        if (active) { lmap.removeLayer(active); AppState.set('_activeEmpMarker', null); }
        lmap.off('move zoom', _repositionLiveEmpOverlay);
      }
    });

    // CartoDB Positron tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &amp; CartoDB',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(lmap);

    // Fetch project sites, draw zones and pins, then fit view
    api('listProjectSites', {}).then(res => {
      const sites = (res?.success && res.data) || [];
      const attendanceZones = AppState.get('attendanceZones') as any[];
      attendanceZones.forEach(z => { try { lmap.removeLayer(z); } catch (_) { /* empty */ } });
      AppState.set('attendanceZones', []);

      const liveData = AppState.get('liveData') as any[];

      sites.forEach((site: any) => {
        if (!site.latitude || !site.longitude) return;

        const initHtml = _buildSitePopupHtml(site, liveData);
        const popupOpts = {
          className:       'siomac-popup',
          maxWidth:        260,
          minWidth:        220,
          offset:          L.point(160, 0),
          autoPan:         true,
          autoPanPadding:  L.point(20, 20),
        };

        // Radius circle zone
        const zone = L.circle([site.latitude, site.longitude], {
          color: '#1b2d54', fillColor: '#1b2d54',
          fillOpacity: 0.08, radius: site.radius || 200, weight: 2,
          dashArray: '6 4',
        }).addTo(lmap);
        zone.bindPopup(initHtml, popupOpts);
        zone.on('click', () => _selectLiveSite(site.id, site.name));
        zone._siteId = site.id;
        const az = AppState.get('attendanceZones') as any[];
        az.push(zone);
        AppState.set('attendanceZones', az);

        // Building-pin marker at centre
        const buildingMarker = L.marker([site.latitude, site.longitude], {
          icon: L.divIcon({
            className: 'lm-building-marker',
            html:      '<div class="lm-building-pin"><i class="fas fa-building"></i></div>',
            iconSize:  [36, 36],
            iconAnchor:[18, 18],
          }),
        }).addTo(lmap);
        buildingMarker.bindPopup(initHtml, popupOpts);
        buildingMarker.on('click', () => _selectLiveSite(site.id, site.name));
        buildingMarker._siteId = site.id;
        const az2 = AppState.get('attendanceZones') as any[];
        az2.push(buildingMarker);
        AppState.set('attendanceZones', az2);

        // Store refs for popup refresh
        const slm = AppState.get('_siteLayerMap') as Record<string, unknown>;
        slm[site.id] = { zone, marker: buildingMarker, site };
        AppState.set('_siteLayerMap', slm);
      });

      // Fit to zones on first load
      if (!AppState.get('_mapViewSet')) {
        const azFinal = AppState.get('attendanceZones') as any[];
        if (azFinal.length) {
          try { lmap.fitBounds(L.featureGroup(azFinal).getBounds().pad(0.25), { animate: false }); } catch (_) { /* empty */ }
        }
        AppState.set('_mapViewSet', true);
      }

      // Rebuild markers from any already-fetched live data
      const ld2 = AppState.get('liveData') as any[];
      if (ld2 && ld2.length) plotLiveEmployees(ld2);

      _populateSiteSelect();
      _initCustomSelect();
      _refreshSitePopups();

      if (AppState.get('userLocation')) updateUserLocationOnMap();
    });

  } catch (error) {
    console.error('[LiveMap] initializeMap error:', error);
  }
}

// ── Site popup HTML ───────────────────────────────────────────────────────────

function _buildSitePopupHtml(site: any, rows: any[]): string {
  const siteRows   = (rows || []).filter((r: any) => String(r.siteId) === String(site.id));
  const total      = siteRows.filter((r: any) => !r.isCheckedOut).length;
  const late       = siteRows.filter((r: any) => r.status === 'late' && !r.isCheckedOut).length;
  const checkedOut = siteRows.filter((r: any) => r.isCheckedOut).length;
  return `<div class="lm-site-popup-card">
    <div class="lm-site-popup-banner">
      <div class="lm-site-popup-building-icon"><i class="fas fa-building"></i></div>
      <div class="lm-site-popup-info">
        <div class="lm-site-popup-name">${escapeHtml(site.name)}</div>
        ${site.address ? `<div class="lm-site-popup-addr">${escapeHtml(site.address)}</div>` : ''}
      </div>
    </div>
    <div class="lm-site-popup-stats">
      <div class="lm-site-popup-stat">
        <span class="lm-site-popup-stat-val">${total}</span>
        <span class="lm-site-popup-stat-lbl">On Site</span>
      </div>
      <div class="lm-site-popup-divider"></div>
      <div class="lm-site-popup-stat">
        <span class="lm-site-popup-stat-val lm-sps-gold">${late}</span>
        <span class="lm-site-popup-stat-lbl">Late</span>
      </div>
      <div class="lm-site-popup-divider"></div>
      <div class="lm-site-popup-stat">
        <span class="lm-site-popup-stat-val lm-sps-gray">${checkedOut}</span>
        <span class="lm-site-popup-stat-lbl">Out</span>
      </div>
    </div>
  </div>`;
}

function _refreshSitePopups(): void {
  const slm = AppState.get('_siteLayerMap') as Record<string, any>;
  Object.values(slm).forEach(({ zone, marker, site }: any) => {
    const liveData = AppState.get('liveData') as any[];
    const html = _buildSitePopupHtml(site, liveData);
    if (zone)   zone.setPopupContent(html);
    if (marker) marker.setPopupContent(html);

    // Update building-pin colour: green when active employees on site
    if (marker) {
      const hasActive = (liveData || []).some((r: any) => String(r.siteId) === String(site.id) && !r.isCheckedOut);
      const pinColor  = hasActive ? '#2E7D32' : '#1b2d54';
      const pinIcon = L.divIcon({
        className:  'lm-building-marker',
        html:       `<div class="lm-building-pin" style="background:${pinColor};box-shadow:0 2px 8px ${hasActive ? 'rgba(46,125,50,0.45)' : 'rgba(27,45,84,0.4)'}"><i class="fas fa-building"></i></div>`,
        iconSize:   [36, 36],
        iconAnchor: [18, 18],
      });
      marker.setIcon(pinIcon);
    }
  });
}

// ── Site selection ────────────────────────────────────────────────────────────

function _selectLiveSite(siteId: string | number, _siteName?: string): void {
  AppState.set('_selectedSiteId', String(siteId));
  _hideActiveEmpMarker();
  _syncCustomSelectTrigger(String(siteId));
  _updateSiteMarkerZIndex();
  _populateSiteSelect();
  renderLivePanel(AppState.get('liveData') as any[]);
}

function _clearLiveSite(): void {
  AppState.set('_selectedSiteId', '');
  _hideActiveEmpMarker();
  _syncCustomSelectTrigger('');
  _updateSiteMarkerZIndex();
  _populateSiteSelect();
  renderLivePanel(AppState.get('liveData') as any[]);
}

function _updateSiteMarkerZIndex(): void {
  const selected = String(AppState.get('_selectedSiteId') || '');
  const slm = AppState.get('_siteLayerMap') as Record<string, any>;
  Object.entries(slm).forEach(([id, { marker }]: [string, any]) => {
    if (!marker) return;
    marker.setZIndexOffset(String(id) === selected ? 500 : 0);
  });
}

// ── Custom dropdown ───────────────────────────────────────────────────────────

function _populateSiteSelect(): void {
  const dropdown  = document.getElementById('lmCustomSelectDropdown');
  const hiddenSel = document.getElementById('lmSiteSelect') as HTMLSelectElement | null;
  if (!dropdown) return;

  const current  = String(AppState.get('_selectedSiteId') || '');
  const liveData = AppState.get('liveData') as any[];
  const slm      = AppState.get('_siteLayerMap') as Record<string, any>;

  const sites = Object.values(slm)
    .map(({ site }: any) => site)
    .sort((a: any, b: any) => {
      const aActive = (liveData || []).some((r: any) => !r.isCheckedOut && String(r.siteId) === String(a.id));
      const bActive = (liveData || []).some((r: any) => !r.isCheckedOut && String(r.siteId) === String(b.id));
      if (aActive === bActive) return (a.name || '').localeCompare(b.name || '');
      return aActive ? -1 : 1;
    });

  dropdown.innerHTML = '';
  sites.forEach((site: any) => {
    const isActive = (liveData || []).some((r: any) => !r.isCheckedOut && String(r.siteId) === String(site.id));
    const opt = document.createElement('div');
    opt.className  = 'lm-cs-option' + (String(site.id) === current ? ' selected' : '');
    opt.dataset.value = site.id;
    opt.innerHTML = `
      <div class="lm-cs-opt-icon ${isActive ? 'lm-cs-opt-icon-active' : 'lm-cs-opt-icon-inactive'}">
        <i class="fas fa-building"></i>
      </div>
      <div class="lm-cs-opt-text">
        <div class="lm-cs-opt-name">${escapeHtml(site.name)}</div>
      </div>
      ${isActive
        ? '<span class="lm-cs-dot lm-cs-dot-green"></span>'
        : '<span class="lm-cs-dot lm-cs-dot-gray"></span>'}`;
    dropdown.appendChild(opt);
  });

  _syncCustomSelectTrigger(current, sites);

  if (hiddenSel) {
    hiddenSel.innerHTML =
      '<option value=""></option>' +
      sites.map((s: any) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    hiddenSel.value = current;
  }
}

function _syncCustomSelectTrigger(val: string, sites?: any[]): void {
  const label = document.getElementById('lmCustomSelectLabel');
  const dot   = document.getElementById('lmCsTriggerDot');
  if (!label) return;

  if (!val) {
    label.textContent = 'All Sites';
    if (dot) dot.className = 'lm-cs-dot lm-cs-dot-empty';
    return;
  }

  const liveData = AppState.get('liveData') as any[];
  const allSites = sites ?? Object.values(AppState.get('_siteLayerMap') as Record<string, any>).map((e: any) => e.site);
  const site     = allSites.find((s: any) => String(s.id) === String(val));
  const isActive = (liveData || []).some((r: any) => !r.isCheckedOut && String(r.siteId) === String(val));

  label.textContent = site ? site.name : val;
  if (dot) dot.className = `lm-cs-dot ${isActive ? 'lm-cs-dot-green' : 'lm-cs-dot-gray'}`;
}

function _initCustomSelect(): void {
  const wrap = document.getElementById('lmCustomSelect') as any;
  if (!wrap || wrap._csInited) return;
  wrap._csInited = true;

  document.getElementById('lmCustomSelectTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = wrap.classList.toggle('open');
    if (isOpen) {
      const trigger  = document.getElementById('lmCustomSelectTrigger');
      const dropdown = document.getElementById('lmCustomSelectDropdown');
      if (trigger && dropdown) {
        const rect = trigger.getBoundingClientRect();
        dropdown.style.top   = (rect.bottom + 4) + 'px';
        dropdown.style.left  = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
      }
    }
  });

  document.getElementById('lmCustomSelectDropdown')?.addEventListener('click', e => {
    const opt = (e.target as Element).closest<HTMLElement>('.lm-cs-option');
    if (!opt) return;
    wrap.classList.remove('open');
    const val = opt.dataset.value ?? '';
    const hiddenSel = document.getElementById('lmSiteSelect') as HTMLSelectElement | null;
    if (hiddenSel) {
      hiddenSel.value = val;
      hiddenSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  document.addEventListener('click', () => wrap.classList.remove('open'));
}

// ── User location marker ──────────────────────────────────────────────────────

function updateUserLocationOnMap(): void {
  const userLocation = AppState.get('userLocation') as { lat: number; lng: number; accuracy: number; fallback?: boolean } | null;
  const lmap = AppState.get('map') as any;
  if (!userLocation || !lmap) return;
  if (!userLocation.lat || !userLocation.lng || userLocation.fallback) return;

  const existingMarker = AppState.get('userMarker') as any;
  if (existingMarker) lmap.removeLayer(existingMarker);

  const newMarker = L.marker([userLocation.lat, userLocation.lng], {
    icon: L.divIcon({
      className: 'user-location-marker',
      html:      '<div style="background:#2ecc71;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>',
      iconSize:  [24, 24],
      iconAnchor:[12, 12],
    }),
  }).addTo(lmap).bindPopup('Your current location');
  AppState.set('userMarker', newMarker);
}

// ── Active employee marker ────────────────────────────────────────────────────

function _hideActiveEmpMarker(): void {
  const active = AppState.get('_activeEmpMarker') as any;
  const lmap   = AppState.get('map') as any;
  if (active && lmap) { try { lmap.removeLayer(active); } catch (_) { /* empty */ } }
  AppState.set('_activeEmpMarker', null);
}

// ── Notification banner ───────────────────────────────────────────────────────

function showNotification(message: string, type: string): void {
  const notification = document.getElementById('notification');
  if (!notification) return;
  notification.textContent = message;
  notification.className   = `notification ${type} show`;
  setTimeout(() => notification.classList.remove('show'), 5000);
}

// ── Live attendance loading ───────────────────────────────────────────────────

function loadLiveAttendance(): void {
  skelOnce('s-projectMap', () => setSkel('liveEmployeesList', skelList(3)));
  const currentRole  = AppState.get('currentRole')  as string | null;
  const currentDeptId = AppState.get('currentDeptId') as string | null;
  const scope = currentRole === 'admin' ? 'all' : (currentDeptId || 'all');

  apiSwr('getLiveAttendance', { scope }, {
    onData: (res: any) => {
      const fresh: any[] = (res?.success && res.data) || [];
      const hash = fresh.length
        ? fresh.map((r: any) => `${r.id}|${r.checkInLat}|${r.checkInLng}|${r.checkOutLat}|${r.checkOutLng}|${r.status}|${r.isCheckedOut}`).join(';')
        : '__empty__';
      const markersNeedUpdate = hash !== _liveDataHash;
      AppState.set('liveData', fresh);
      markLoaded('s-projectMap');
      scheduleHdrBadgeSync();

      if (markersNeedUpdate) {
        _liveDataHash = hash;
        fresh.forEach((r: any) => {
          if (r.profileImage) { patchPhotoCache(r.userId || r.username, r.profileImage); new Image().src = r.profileImage; }
          if (r.checkInPhotoUrl)  { new Image().src = r.checkInPhotoUrl; }
          if (r.checkOutPhotoUrl) { new Image().src = r.checkOutPhotoUrl; }
        });
        plotLiveEmployees(AppState.get('liveData') as any[]);
        renderLivePanel(AppState.get('liveData') as any[]);

        // Re-render project site cards if that section is active
        const projectSites = AppState.get('projectSites') as any[];
        if (projectSites.length) {
          const activeSec = document.querySelector('.app-section.active');
          if (activeSec?.id === 's-adm-projects') {
            w().displayProjectSites?.(projectSites);
          }
        }
      } else {
        renderLivePanel(AppState.get('liveData') as any[]);
        _refreshSitePopups();
      }
    },
  });
}

function _clearLiveMarkers(): void {
  AppState.set('liveMarkers', []);
}

// ── Plot employee markers ─────────────────────────────────────────────────────

function plotLiveEmployees(rows: any[]): void {
  const lmap = AppState.get('map') as any;
  if (!lmap) return;
  _clearLiveMarkers();

  rows.forEach((row: any) => {
    const lat = row.checkOutLat || row.checkInLat;
    const lng = row.checkOutLng || row.checkInLng;
    if (lat == null || lng == null) return;

    const color   = row.isCheckedOut ? '#6c757d' : (row.status === 'late' ? '#fbbc04' : '#34a853');
    const initial = (row.fullName || '?').charAt(0).toUpperCase();
    const markerHtml = row.profileImage
      ? `<div style="width:52px;height:52px;border-radius:50%;border:3px solid ${color};box-shadow:0 2px 8px rgba(0,0,0,.4);overflow:hidden;"><img src="${row.profileImage}" style="width:100%;height:100%;object-fit:cover;" onerror="if(this.parentElement)this.parentElement.innerHTML='<div style=\\'width:52px;height:52px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:white;font-weight: var(--font-weight-bold);font-size:20px;\\'>${initial}</div>'"></div>`
      : `<div style="background:${color};width:52px;height:52px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-weight: var(--font-weight-bold);font-size:20px;">${initial}</div>`;

    const marker: any = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'live-emp-marker', html: markerHtml, iconSize: [52, 52], iconAnchor: [26, 26] }),
      zIndexOffset: 1000,
    });

    // Preload photos
    const selfieUrl = row.checkOutPhotoUrl || row.checkInPhotoUrl || '';
    if (selfieUrl)       { const pre = new Image(); pre.src = selfieUrl; }
    if (row.profileImage){ const pr  = new Image(); pr.src  = row.profileImage; }

    marker._liveUserId = row.userId;
    marker._liveRow    = row;

    const liveMarkers = AppState.get('liveMarkers') as any[];
    liveMarkers.push(marker);
    AppState.set('liveMarkers', liveMarkers);
    // Markers are NOT added to the map — they appear on demand via focusLiveEmployee
  });

  // If an employee overlay is open, silently refresh its card content
  const activeEmpMarker = AppState.get('_activeEmpMarker') as any;
  if (activeEmpMarker && lmap) {
    const liveMarkers = AppState.get('liveMarkers') as any[];
    const stillExists = liveMarkers.find((m: any) => m._liveUserId === activeEmpMarker._liveUserId);
    if (stillExists) {
      activeEmpMarker._liveRow = stillExists._liveRow;
      if (stillExists !== activeEmpMarker) {
        const idx = liveMarkers.indexOf(stillExists);
        if (idx !== -1) liveMarkers[idx] = activeEmpMarker;
        activeEmpMarker._liveUserId = stillExists._liveUserId;
        AppState.set('liveMarkers', liveMarkers);
      }
      if (_empOverlayEl) {
        const cardEl = _empOverlayEl.querySelector('.lm-emp-overlay-card');
        if (cardEl) cardEl.innerHTML = _buildEmpOverlayHtml(activeEmpMarker._liveRow);
      }
    } else {
      _removeLiveEmpOverlay();
      lmap.removeLayer(activeEmpMarker);
      AppState.set('_activeEmpMarker', null);
      lmap.off('move zoom', _repositionLiveEmpOverlay);
    }
  }
}

// ── Render live panel ─────────────────────────────────────────────────────────

function renderLivePanel(rows: any[]): void {
  _refreshSitePopups();
  _populateSiteSelect();

  const listEl = document.getElementById('liveEmployeesList');
  if (!listEl) return;

  // Strip skeleton / empty-state nodes (no data-id)
  Array.from(listEl.children).forEach(c => {
    if (!(c as HTMLElement).dataset.id) listEl.removeChild(c);
  });

  if (!AppState.get('_selectedSiteId')) {
    const allCheckedIn = rows.filter((r: any) => !r.isCheckedOut).length;
    const allLate      = rows.filter((r: any) => r.status === 'late' && !r.isCheckedOut).length;
    const allOnSite    = rows.filter((r: any) => !r.isCheckedOut && r.checkInLat != null).length;
    countUp(document.getElementById('liveActiveCount'),    allCheckedIn);
    countUp(document.getElementById('liveCheckedInCount'), allCheckedIn);
    countUp(document.getElementById('liveLateCount'),      allLate);
    countUp(document.getElementById('liveOnSiteCount'),    allOnSite);
    listEl.innerHTML = '<div class="lm-emp-empty"><i class="fas fa-map-pin"></i>Tap a job site on the map to view live activity</div>';
    return;
  }

  const siteRows  = rows.filter((r: any) => String(r.siteId) === String(AppState.get('_selectedSiteId')));
  const checkedIn = siteRows.filter((r: any) => !r.isCheckedOut).length;
  const late      = siteRows.filter((r: any) => r.status === 'late' && !r.isCheckedOut).length;
  const onSite    = siteRows.filter((r: any) => !r.isCheckedOut && r.checkInLat != null).length;

  countUp(document.getElementById('liveActiveCount'),    checkedIn);
  countUp(document.getElementById('liveCheckedInCount'), checkedIn);
  countUp(document.getElementById('liveLateCount'),      late);
  countUp(document.getElementById('liveOnSiteCount'),    onSite);

  const sorted = siteRows.slice().sort((a: any, b: any) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));

  if (!sorted.length) {
    listEl.innerHTML = '<div class="lm-emp-empty"><i class="fas fa-users-slash"></i>No check-ins at this site today</div>';
    return;
  }

  function liveEmpRowHtml(r: any): string {
    const initial   = (r.fullName || '?').charAt(0).toUpperCase();
    const dotCls    = r.isCheckedOut ? 'lm-dot-gray' : (r.status === 'late' ? 'lm-dot-orange' : 'lm-dot-green');
    const statusTxt = r.isCheckedOut ? 'Checked Out' : (r.status === 'late' ? 'Late' : 'Checked In');
    const meta      = r.lastSeen ? `${statusTxt} · ${fmtLocalTime(r.lastSeen)}` : statusTxt;
    return `<div class="lm-emp-item" data-id="${r.userId}">
      <div class="lm-emp-avatar" data-uid="${r.userId}">${escapeHtml(initial)}</div>
      <div class="lm-emp-info">
        <div class="lm-emp-name">${escapeHtml(r.fullName || '—')}</div>
        <div class="lm-emp-status"><span class="lm-dot ${dotCls}"></span> ${meta}</div>
      </div>
      <i class="fas fa-chevron-right lm-emp-chevron"></i>
    </div>`;
  }
  function liveEmpRowKey(r: any): string {
    return (r.isCheckedOut ? 'out' : r.status) + '|' + (r.lastSeen || '');
  }

  // In-place DOM diff — only update changed rows to avoid CSS animation replay
  const existingById = new Map<string, HTMLElement>();
  listEl.querySelectorAll('[data-id]').forEach(el => existingById.set((el as HTMLElement).dataset.id!, el as HTMLElement));
  const seen = new Set(sorted.map((r: any) => String(r.userId)));
  existingById.forEach((el, id) => {
    if (!seen.has(id) && el.parentNode === listEl) listEl.removeChild(el);
  });

  sorted.forEach((r: any, i: number) => {
    const id  = String(r.userId);
    const key = liveEmpRowKey(r);
    let el    = existingById.get(id) ?? null;

    if (!el) {
      const tmp = document.createElement('div');
      tmp.innerHTML = liveEmpRowHtml(r);
      el = tmp.firstElementChild as HTMLElement;
      el.dataset.rowKey = key;
      listEl.appendChild(el);
    } else if (el.dataset.rowKey !== key) {
      const tmp = document.createElement('div');
      tmp.innerHTML = liveEmpRowHtml(r);
      const fresh = tmp.firstElementChild as HTMLElement;
      fresh.dataset.rowKey = key;
      el.replaceWith(fresh);
      existingById.set(id, fresh);
      el = fresh;
    }

    const expectedNext = listEl.children[i] as HTMLElement | undefined;
    if (expectedNext !== el) listEl.insertBefore(el, expectedNext ?? null);
  });

  // Preload profile photos into avatars off-screen (no layout shift)
  sorted.forEach((r: any) => {
    const src = r.profileImage || r.checkInPhotoUrl || '';
    if (!src) return;
    const avatarEl = listEl.querySelector<HTMLElement>(`.lm-emp-avatar[data-uid="${r.userId}"]`);
    if (!avatarEl) return;
    const img = new Image();
    img.onload = () => {
      avatarEl.textContent = '';
      avatarEl.style.padding = '0';
      const imgEl = document.createElement('img');
      imgEl.src = src;
      imgEl.alt = (r.fullName || '?').charAt(0).toUpperCase();
      imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
      avatarEl.appendChild(imgEl);
    };
    img.src = src;
  });
}

// ── Employee overlay (animated line + card) ───────────────────────────────────

function _removeLiveEmpOverlay(): void {
  if (_empOverlayEl) { _empOverlayEl.remove(); _empOverlayEl = null; }
}

function _buildEmpOverlayHtml(row: any): string {
  const initial     = (row.fullName || '?').charAt(0).toUpperCase();
  const profile     = row.profileImage || '';
  const selfie      = row.checkOutPhotoUrl || row.checkInPhotoUrl || '';
  const statusCls   = row.isCheckedOut ? 'out' : (row.status === 'late' ? 'late' : 'in');
  const statusLabel = row.isCheckedOut ? 'Checked Out' : (row.status === 'late' ? 'Late Arrival' : 'Checked In');
  const statusIcon  = row.isCheckedOut ? 'fa-sign-out-alt' : (row.status === 'late' ? 'fa-clock' : 'fa-check-circle');
  const statusColor = row.isCheckedOut ? '#546E7A' : (row.status === 'late' ? '#E65100' : '#2E7D32');
  const statusBg    = row.isCheckedOut ? '#ECEFF4'  : (row.status === 'late' ? '#FFF3E0' : '#E8F5E9');
  const avatarHtml  = profile
    ? `<img src="${profile}" alt="${initial}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.35);flex-shrink:0;" onerror="this.outerHTML='<div style=\\'width:42px;height:42px;border-radius:50%;background:var(--siomac-red);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight: var(--font-weight-bold);color:white;flex-shrink:0;\\'>${initial}</div>'">`
    : `<div style="width:42px;height:42px;border-radius:50%;background:var(--siomac-red);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight: var(--font-weight-bold);color:white;flex-shrink:0;">${initial}</div>`;
  const navLat = row.checkInLat || row.checkOutLat || '';
  const navLng = row.checkInLng || row.checkOutLng || '';
  const navBtn = (navLat && navLng)
    ? `<a href="https://www.google.com/maps?q=${navLat},${navLng}" target="_blank" class="lm-popup-btn lm-popup-btn-outline"><i class="fas fa-directions"></i> Navigate</a>`
    : `<span class="lm-popup-btn lm-popup-btn-outline" style="opacity:.45;pointer-events:none;"><i class="fas fa-directions"></i> Navigate</span>`;

  return `
    <div class="lm-popup-card" style="margin:0;">
      <div class="lm-popup-site-banner">
        <div class="lm-popup-building-icon"><i class="fas fa-building"></i></div>
        <div class="lm-popup-site-info">
          <div class="lm-popup-site-name">${row.siteName ? escapeHtml(row.siteName) : 'On Site'}</div>
          <span class="lm-popup-status-pill" style="background:${statusBg};color:${statusColor};margin-top:6px;display:inline-flex;">
            <i class="fas ${statusIcon}"></i> ${statusLabel}
          </span>
        </div>
      </div>
      <div class="lm-popup-emp-row">
        ${avatarHtml}
        <div class="lm-popup-emp-info">
          <div class="lm-popup-emp-name">${escapeHtml(row.fullName)}</div>
          <div class="lm-popup-emp-meta">${escapeHtml([row.position, row.department].filter(Boolean).join(' · ') || 'Employee')}</div>
          ${row.employeeId ? `<div class="lm-popup-emp-meta"><i class="fas fa-id-badge" style="margin-right:3px;"></i>${escapeHtml(row.employeeId)}</div>` : ''}
        </div>
      </div>
      <div class="lm-popup-times">
        <div class="lm-popup-time-cell">
          <i class="fas fa-sign-in-alt"></i>
          <span class="lm-popup-time-label">In</span>
          <span class="lm-popup-time-val">${row.checkInTime ? fmtLocalTime(row.checkInTime) : '—'}</span>
        </div>
        <div class="lm-popup-time-divider"></div>
        <div class="lm-popup-time-cell">
          <i class="fas fa-sign-out-alt"></i>
          <span class="lm-popup-time-label">Out</span>
          <span class="lm-popup-time-val">${row.checkOutTime ? fmtLocalTime(row.checkOutTime) : '—'}</span>
        </div>
      </div>
      ${selfie ? `<div class="lm-popup-selfie"><img src="${selfie}" alt="Selfie" onerror="if(this.parentElement)this.parentElement.style.display='none'"></div>` : ''}
      <div class="lm-popup-footer">
        ${navBtn}
        <button class="lm-popup-btn lm-popup-btn-primary" onclick="document.getElementById('liveEmployeesList').querySelector('[data-uid=\\'${escapeHtml(String(row.userId))}\\']')?.scrollIntoView({behavior:'smooth',block:'nearest'})"><i class="fas fa-user"></i> View</button>
      </div>
    </div>`;
}

function _showLiveEmpOverlay(marker: any): void {
  _removeLiveEmpOverlay();
  const lmap = AppState.get('map') as any;
  if (lmap) lmap.closePopup();
  const row: any = marker._liveRow;
  if (!row) return;

  const mapContainer = lmap.getContainer() as HTMLElement;
  const markerPx     = lmap.latLngToContainerPoint(marker.getLatLng());

  const overlay = document.createElement('div');
  overlay.className        = 'lm-emp-overlay';
  overlay.style.top        = markerPx.y + 'px';
  overlay.style.right      = (mapContainer.offsetWidth - markerPx.x + 26) + 'px';
  overlay.style.transform  = 'translateY(-50%)';
  overlay.style.flexDirection = 'row-reverse';

  overlay.innerHTML = `
    <div class="lm-emp-overlay-dot"></div>
    <div class="lm-emp-overlay-line"></div>
    <div class="lm-emp-overlay-card">${_buildEmpOverlayHtml(row)}</div>`;

  overlay.querySelector('.lm-emp-overlay-card')?.addEventListener('click', e => e.stopPropagation());
  mapContainer.appendChild(overlay);
  _empOverlayEl = overlay;
}

function focusLiveEmployee(userId: string | number): void {
  const lmap = AppState.get('map') as any;
  if (!lmap || !userId) return;

  const liveMarkers = AppState.get('liveMarkers') as any[];
  const marker = liveMarkers.find((m: any) => String(m._liveUserId) === String(userId));
  if (!marker) {
    console.warn('[focusLiveEmployee] no marker for userId:', userId, 'liveMarkers:', liveMarkers.map((m: any) => m._liveUserId));
    return;
  }

  const activeEmpMarker = AppState.get('_activeEmpMarker') as any;

  // Toggle off if same marker clicked again
  if (activeEmpMarker === marker && _empOverlayEl) {
    _removeLiveEmpOverlay();
    AppState.set('_activeEmpMarker', null);
    return;
  }

  _removeLiveEmpOverlay();
  if (activeEmpMarker && activeEmpMarker !== marker) lmap.removeLayer(activeEmpMarker);

  if (!lmap.hasLayer(marker)) marker.addTo(lmap);
  AppState.set('_activeEmpMarker', marker);

  const targetZoom = lmap.getZoom() < 14 ? 15 : lmap.getZoom();
  lmap.setView(marker.getLatLng(), targetZoom, { animate: false });
  _showLiveEmpOverlay(marker);

  lmap.off('move zoom', _repositionLiveEmpOverlay);
  lmap.on('move zoom',  _repositionLiveEmpOverlay);
}

function _repositionLiveEmpOverlay(): void {
  if (!_empOverlayEl || !AppState.get('_activeEmpMarker')) return;
  const lmap            = AppState.get('map') as any;
  const activeEmpMarker = AppState.get('_activeEmpMarker') as any;
  const mapContainer    = lmap.getContainer() as HTMLElement;
  const markerPx        = lmap.latLngToContainerPoint(activeEmpMarker.getLatLng());
  _empOverlayEl.style.top   = markerPx.y + 'px';
  _empOverlayEl.style.right = (mapContainer.offsetWidth - markerPx.x + 26) + 'px';
}

// ── Mark project attendance ───────────────────────────────────────────────────

function markProjectAttendance(): void {
  const userLocation  = AppState.get('userLocation') as { lat: number; lng: number; accuracy: number } | null;
  const currentUser   = AppState.get('currentUser') as string | null;
  const loc = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, accuracy: userLocation.accuracy }
    : null;

  api('markAttendance', { username: currentUser, action: 'Project', photoBase64: '', location: loc })
    .then((res: any) => {
      if (res.success) {
        showNotification('Project attendance marked successfully! ✅', 'success');
        w().checkStatus?.();
      } else {
        showNotification(res.message || 'Failed to mark attendance', 'error');
      }
      w().updateRealTimeStats?.();
    })
    .catch((err: any) => { showNotification(err.message || 'Network error', 'error'); });
}

// ── Public API object ─────────────────────────────────────────────────────────

export const LiveMap = {
  initializeMap,
  loadLiveAttendance,
  renderLivePanel,
  plotLiveEmployees,
  focusLiveEmployee,
  updateUserLocationOnMap,
  markProjectAttendance,
  getCurrentLocation,
  verifyLocation,
  showNotification,
  // Internals exposed for app.js delegation
  _clearLiveSite,
  _selectLiveSite,
  _initCustomSelect,
};

// Register on window so app.js / legacy callers keep working unchanged
(window as Win).LiveMap = LiveMap;
