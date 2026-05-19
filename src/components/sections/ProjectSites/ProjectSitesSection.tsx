/**
 * src/components/sections/ProjectSites/ProjectSitesSection.tsx
 *
 * Port of assets/js/sites.js → Preact.
 *
 * Architecture:
 *   - TanStack Query owns site data + live-attendance data
 *   - Leaflet mini-maps: imperative useEffect + useRef (no virtual DOM for canvas)
 *   - Add/Edit modal: Preact <Modal> with controlled form, Leaflet map picker in useEffect
 *   - Employee picker: pure Preact state (no DOM string injection)
 *   - Delete: <ConfirmDialog>
 *   - Site-popup on mini-map click: Preact state modal (replaces Swal)
 *   - window.LiveMap / window._selectLiveSite used for "Open in Live Map" nav
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, type VNode }                       from 'preact';
import { useState, useEffect, useRef,
         useCallback, useMemo }                from 'preact/hooks';
import { useQuery, useQueryClient,
         useMutation }                         from '@tanstack/preact-query';
import { Modal }                               from '@shared/Modal';
import { ConfirmDialog }                       from '@shared/ConfirmDialog';
import { Spinner }                             from '@shared/Spinner';
import { toast }                               from '@store';
import { useSessionStore }                     from '@store/session';
import {
  listProjectSites,
  getLiveAttendance,
  addProjectSiteApi,
  updateProjectSiteApi,
  deleteProjectSiteApi,
  assignSiteEmployeesApi,
} from './api';
import type {
  ProjectSite,
  EmployeeListItem,
  SiteFormValues,
  SiteFilter,
  LiveRow,
} from './types';
import { EMPTY_FORM } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function countUp(el: HTMLElement | null, n: number, suffix = ''): void {
  if (el) el.textContent = String(n) + suffix;
}

// ── Mini-map hook ─────────────────────────────────────────────────────────────

// Opaque Leaflet handle — we only need remove/on/invalidateSize/addTo on the result.
type LeafletMap = {
  setView:      (c: number[], z: number) => LeafletMap;
  on:           (ev: string, fn: (...args: unknown[]) => void) => LeafletMap;
  once:         (ev: string, fn: () => void) => void;
  remove:       () => void;
  invalidateSize: () => void;
};
type LeafletLayer = { addTo: (m: LeafletMap) => unknown; setLatLng: (c: number[]) => void; setRadius: (r: number) => void };
type LeafletMarker = {
  addTo:      (m: LeafletMap) => LeafletMarker;
  on:         (ev: string, fn: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => void) => void;
  setLatLng:  (c: number[]) => void;
};
type LeafletLib = {
  map:       (el: HTMLElement, opts?: object) => LeafletMap;
  tileLayer: (url: string, opts?: object) => LeafletLayer;
  circle:    (c: number[], opts?: object) => LeafletLayer;
  marker:    (c: number[], opts?: object) => LeafletMarker;
};

function getL(): LeafletLib | undefined {
  return (window as unknown as Record<string, unknown>)['L'] as LeafletLib | undefined;
}

/** Inits a read-only Leaflet mini-map inside a container div, cleaned up on unmount. */
function useMiniMap(
  containerRef: { current: HTMLDivElement | null },
  lat: number,
  lng: number,
  radius: number,
  isActive: boolean,
  onMapClick: () => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !lat || !lng) return;

    // Guard: Leaflet stamps _leaflet_id on initialised elements
    if ((el as unknown as Record<string, unknown>)['_leaflet_id']) return;

    const L = getL();
    if (!L) return;

    let m: LeafletMap | null = null;
    const timer = setTimeout(() => {
      try {
        m = L.map(el, {
          zoomControl: false, dragging: false, scrollWheelZoom: false,
          doubleClickZoom: false, attributionControl: false,
        }).setView([lat, lng], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd', maxZoom: 19,
        }).addTo(m);
        L.circle([lat, lng], {
          radius, color: '#E40C0C', fillColor: '#FFB712', fillOpacity: 0.2, weight: 2,
        }).addTo(m);
        L.marker([lat, lng]).addTo(m);
        m.invalidateSize();
        if (isActive) {
          m.on('click', onMapClick);
          (el as HTMLDivElement).style.cursor = 'pointer';
        }
      } catch (_) { /* Leaflet not ready */ }
    }, 80);

    return () => {
      clearTimeout(timer);
      if (m) { try { m.remove(); } catch (_) {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, radius, isActive]);
}

// ── Site-popup (replaces Swal popup for mini-map click) ──────────────────────

interface SitePopupProps {
  site:     ProjectSite;
  liveRows: LiveRow[];
  onClose:  () => void;
}

function SitePopup({ site, liveRows, onClose }: SitePopupProps): VNode {
  const checkedIn = liveRows.filter(
    r => !r.isCheckedOut && String(r.siteId) === String(site.id),
  );
  const count = checkedIn.length;

  function openInLiveMap(): void {
    onClose();
    const win = window as unknown as Record<string, unknown>;
    const showSection = win['showSection'] as ((s: string) => void) | undefined;
    const selectSite  = win['_selectLiveSite'] as ((id: string, name: string) => void) | undefined;
    if (showSection) showSection('s-projectMap');
    if (selectSite)  selectSite(String(site.id), site.name);
  }

  return (
    <Modal open onClose={onClose} title={site.name} size="sm">
      <div style="text-align:center;padding:16px 0;">
        <div style="font-size:2.8rem;font-weight:800;color:var(--siomac-navy);line-height:1;">{count}</div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">
          Employee{count !== 1 ? 's' : ''} Currently on Site
        </div>
      </div>
      <div style="display:flex;justify-content:center;gap:8px;margin-top:8px;">
        {site.isActive && (
          <button class="btn btn-primary btn-sm" onClick={openInLiveMap}>
            <i class="fas fa-map-marked-alt" /> Open in Live Map
          </button>
        )}
        <button class="btn btn-outline-secondary btn-sm" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ── Site card ─────────────────────────────────────────────────────────────────

interface SiteCardProps {
  site:       ProjectSite;
  liveRows:   LiveRow[];
  isAdmin:    boolean;
  selected:   boolean;
  onSelect:   (id: string) => void;
  onEdit:     (site: ProjectSite) => void;
  onDelete:   (site: ProjectSite) => void;
}

function SiteCard({
  site, liveRows, isAdmin, selected, onSelect, onEdit, onDelete,
}: SiteCardProps): VNode {
  const mapRef = useRef<HTMLDivElement>(null);
  const lat = Number(site.latitude)  || 0;
  const lng = Number(site.longitude) || 0;
  const rad = Number(site.radius)    || 200;
  const [popupOpen, setPopupOpen] = useState(false);

  useMiniMap(mapRef, lat, lng, rad, !!site.isActive, () => setPopupOpen(true));

  const assigned     = site.assignedEmployees || [];
  const checkedInCt  = liveRows.filter(
    r => !r.isCheckedOut && String(r.siteId) === String(site.id),
  ).length;
  const MAX_AVATARS  = 5;
  const shown        = assigned.slice(0, MAX_AVATARS);
  const overflow     = assigned.length - shown.length;

  function handleCardClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.btn-edit-project') || target.closest('.btn-delete-project')) return;
    onSelect(String(site.id));
  }

  return (
    <div
      class={`ps-card${site.isActive ? '' : ' ps-card--inactive'}${selected ? ' ps-card--selected' : ''}`}
      data-id={site.id}
      onClick={handleCardClick}
      style="cursor:pointer;"
    >
      <div class="ps-card-header">
        <h3><i class="fas fa-hard-hat" /> {site.name}</h3>
        {isAdmin && (
          <div class="card-overlay-actions">
            <button
              class="card-overlay-btn edit btn-edit-project"
              title="Edit site"
              onClick={(e) => { e.stopPropagation(); onEdit(site); }}
            >
              <i class="fas fa-pen" />
            </button>
            <button
              class="card-overlay-btn delete btn-delete-project"
              title="Delete site"
              onClick={(e) => { e.stopPropagation(); onDelete(site); }}
            >
              <i class="fas fa-trash" />
            </button>
          </div>
        )}
      </div>

      <div class="ps-card-body">
        <div class="ps-detail-row">
          <i class="fas fa-location-dot" />
          <span>{site.address || '—'}</span>
        </div>
        <div class="ps-detail-row">
          <i class="fas fa-crosshairs" />
          <span>{lat.toFixed(5)}, {lng.toFixed(5)} · Radius: {rad}m</span>
        </div>
        <div class="ps-detail-row ps-detail-row--last">
          <i class="fas fa-align-left" />
          <span>{site.description || '—'}</span>
        </div>

        {assigned.length > 0 ? (
          <div class="ps-assigned-row">
            <span class="ps-assigned-lbl">
              <i class="fas fa-users" /> {assigned.length} Assigned
            </span>
            <div class="ps-assigned-avatars">
              {shown.map(e => (
                e.photoUrl
                  ? <img key={e.id} class="ps-emp-avatar" src={e.photoUrl} title={e.name} alt={e.name} />
                  : <div key={e.id} class="ps-emp-avatar ps-emp-avatar--initials" title={e.name}>{initials(e.name)}</div>
              ))}
              {overflow > 0 && <div class="ps-emp-avatar ps-emp-avatar--more">+{overflow}</div>}
            </div>
            <span class={`ps-presence-badge${checkedInCt === 0 ? ' ps-presence-badge--empty' : ''}`}>
              <span class="ps-live-dot" />
              <span class="ps-presence-badge__count">
                {checkedInCt}<span class="ps-presence-badge__total"> / {assigned.length}</span>
              </span>
              <span class="ps-presence-badge__label">On Site</span>
            </span>
          </div>
        ) : (
          <div class="ps-assigned-row ps-assigned-empty">
            <i class="fas fa-user-plus" /> No Employees Assigned
          </div>
        )}

        {/* Leaflet mini-map — imperative, not managed by Preact */}
        <div class="ps-mini-map" ref={mapRef} />
      </div>

      {popupOpen && (
        <SitePopup site={site} liveRows={liveRows} onClose={() => setPopupOpen(false)} />
      )}
    </div>
  );
}

// ── Employee picker ───────────────────────────────────────────────────────────

interface EmployeePickerProps {
  all:        EmployeeListItem[];
  selected:   Set<string>;
  onChange:   (next: Set<string>) => void;
}

function EmployeePicker({ all, selected, onChange }: EmployeePickerProps): VNode {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? all.filter(e => e.name.toLowerCase().includes(q)) : all;
  }, [all, search]);

  function toggle(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }

  function remove(id: string): void {
    const next = new Set(selected);
    next.delete(id);
    onChange(next);
  }

  const chips = Array.from(selected).map(id => all.find(e => e.id === id)).filter(Boolean) as EmployeeListItem[];

  return (
    <div class="ps-emp-picker">
      <div class="ps-picker-chips-wrap">
        <span class="ps-picker-count-lbl" id="psEmpPickerCount">
          {chips.length > 0 ? `${chips.length} selected` : 'None selected'}
        </span>
        <div class="ps-picker-chips" id="psEmpPickerSelected">
          {chips.map(emp => (
            <div key={emp.id} class="ps-picker-chip" data-uid={emp.id}>
              {emp.photoUrl
                ? <img class="ps-picker-chip-photo" src={emp.photoUrl} alt="" />
                : <div class="ps-picker-chip-photo ps-picker-chip-photo--initials">{initials(emp.name)}</div>
              }
              <span>{emp.name}</span>
              <button
                class="ps-picker-chip-remove"
                type="button"
                onClick={() => remove(emp.id)}
              >
                <i class="fas fa-times" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <input
        type="text"
        class="form-control mb-2"
        placeholder="Search employees…"
        id="psEmpPickerSearch"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
      />

      <div class="ps-picker-grid" id="psEmpPickerGrid">
        {filtered.length === 0
          ? <div class="ps-picker-empty">No employees found</div>
          : filtered.map(e => {
              const sel = selected.has(e.id);
              return (
                <div
                  key={e.id}
                  class={`ps-picker-item${sel ? ' ps-picker-item--selected' : ''}`}
                  data-uid={e.id}
                  title={e.name}
                  onClick={() => toggle(e.id)}
                >
                  {e.photoUrl
                    ? <img class="ps-picker-photo" src={e.photoUrl} alt={e.name} />
                    : <div class="ps-picker-photo ps-picker-photo--initials">{initials(e.name)}</div>
                  }
                  <div class="ps-picker-name">{e.name}</div>
                  {sel && <div class="ps-picker-check"><i class="fas fa-check" /></div>}
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ── Map picker (Leaflet inside modal) ─────────────────────────────────────────

interface MapPickerProps {
  show:        boolean;
  lat:         string;
  lng:         string;
  radius:      string;
  onCoordsSet: (lat: string, lng: string) => void;
}

function MapPicker({ show, lat, lng, radius, onCoordsSet }: MapPickerProps): VNode {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!show) {
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_) {}
        mapRef.current = null;
      }
      return;
    }

    const el = mapDivRef.current;
    if (!el) return;

    const LL = getL();
    if (!LL) return;

    // Capture non-null reference for use inside setTimeout
    const L: LeafletLib = LL;

    const timer = setTimeout(() => {
      if (mapRef.current) {
        // Already initialised — just invalidate size and pan
        mapRef.current.invalidateSize();
        const existLat = parseFloat(lat);
        const existLng = parseFloat(lng);
        if (existLat && existLng) mapRef.current.setView([existLat, existLng], 16);
        return;
      }

      const existLat = parseFloat(lat) || 0;
      const existLng = parseFloat(lng) || 0;
      const center: number[] = (existLat && existLng)
        ? [existLat, existLng]
        : [10.6549, -61.5019]; // T&T default

      const m = L.map(el, { zoomControl: true }).setView(center, existLat ? 16 : 13);
      mapRef.current = m;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(m);

      let markerInst: LeafletMarker | null = null;
      let circleInst: LeafletLayer | null = null;

      function placePin(plat: number, plng: number): void {
        onCoordsSet(plat.toFixed(6), plng.toFixed(6));
        const rad = parseInt(radius) || 200;
        if (markerInst) {
          markerInst.setLatLng([plat, plng]);
        } else {
          markerInst = L.marker([plat, plng], { draggable: true }).addTo(m);
          markerInst.on('dragend', (e) => {
            const ll = e.target.getLatLng();
            placePin(ll.lat, ll.lng);
          });
        }
        if (circleInst) {
          circleInst.setLatLng([plat, plng]);
          circleInst.setRadius(rad);
        } else {
          // addTo returns `unknown` from the LeafletLayer type; cast explicitly
          circleInst = L.circle([plat, plng], {
            radius: rad, color: '#0074D9', fillColor: '#0074D9', fillOpacity: 0.15, weight: 2,
          }).addTo(m) as unknown as LeafletLayer;
        }
      }

      if (existLat && existLng) placePin(existLat, existLng);

      m.on('click', (e: unknown) => {
        const { lat: plat, lng: plng } = (e as { latlng: { lat: number; lng: number } }).latlng;
        placePin(plat, plng);
      });
    }, 80);

    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  return (
    <div
      id="sitePickerMapWrap"
      style={`display:${show ? '' : 'none'};margin-top:12px;`}
    >
      <div
        id="sitePickerMap"
        ref={mapDivRef}
        style="height:280px;border-radius:8px;overflow:hidden;"
      />
    </div>
  );
}

// ── Add/Edit modal ────────────────────────────────────────────────────────────

interface SiteModalProps {
  open:         boolean;
  editingSite:  ProjectSite | null;
  allEmployees: EmployeeListItem[];
  onClose:      () => void;
  onSaved:      () => void;
}

function SiteModal({ open, editingSite, allEmployees, onClose, onSaved }: SiteModalProps): VNode {
  const [form,         setForm]         = useState<SiteFormValues>(EMPTY_FORM);
  const [pickerSel,    setPickerSel]    = useState<Set<string>>(new Set());
  const [showMap,      setShowMap]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [errors,       setErrors]       = useState<Partial<SiteFormValues>>({});

  // Reset form whenever modal opens
  useEffect(() => {
    if (!open) return;
    setShowMap(false);
    setErrors({});
    if (editingSite) {
      setForm({
        name:        editingSite.name,
        address:     editingSite.address,
        latitude:    String(editingSite.latitude  || ''),
        longitude:   String(editingSite.longitude || ''),
        radius:      String(editingSite.radius    || 200),
        description: editingSite.description || '',
      });
      setPickerSel(new Set((editingSite.assignedEmployees || []).map(e => e.id)));
    } else {
      setForm(EMPTY_FORM);
      setPickerSel(new Set());
    }
  }, [open, editingSite]);

  function field(k: keyof SiteFormValues) {
    return {
      value:   form[k],
      onInput: (e: Event) => setForm(prev => ({ ...prev, [k]: (e.target as HTMLInputElement).value })),
    };
  }

  function coordsSet(lat: string, lng: string): void {
    setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
  }

  function validate(): boolean {
    const errs: Partial<SiteFormValues> = {};
    if (!form.name.trim())    errs.name    = 'Required';
    if (!form.address.trim()) errs.address = 'Required';
    const r = parseFloat(form.radius);
    if (!form.radius || isNaN(r) || r <= 0) errs.radius = 'Must be a positive number';
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    if (!lat || isNaN(lat) || lat < -90  || lat > 90)  errs.latitude  = 'Set location on map';
    if (!lng || isNaN(lng) || lng < -180 || lng > 180) errs.longitude = 'Set location on map';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function save(): Promise<void> {
    if (!validate()) return;
    setSaving(true);
    try {
      const win     = window as unknown as Record<string, unknown>;
      const AppSt   = win['AppState'] as { get: (k: string) => string } | undefined;
      const actorId = AppSt?.get('currentUserId') || '';
      const actorUsername = AppSt?.get('currentUser') || '';

      const payload = {
        name:        form.name.trim(),
        address:     form.address.trim(),
        latitude:    parseFloat(form.latitude),
        longitude:   parseFloat(form.longitude),
        radius:      parseInt(form.radius),
        description: form.description.trim(),
        actorId,
        actorUsername,
      };

      let res;
      if (editingSite) {
        res = await updateProjectSiteApi({ ...payload, id: String(editingSite.id) });
      } else {
        res = await addProjectSiteApi(payload);
      }

      if (!res.success) {
        toast.error(res.message || 'Could not save site');
        return;
      }

      const siteId = res.id || (editingSite ? String(editingSite.id) : null);
      if (siteId) {
        await assignSiteEmployeesApi(siteId, Array.from(pickerSel)).catch(() => {});
      }
      toast.success('Project site saved successfully');
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  function useMyLocation(): void {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
        setShowMap(true);
      },
      (err) => {
        const msg = err.code === 1 ? 'Location permission denied.'
                  : err.code === 2 ? 'Location unavailable.'
                  : 'Location request timed out.';
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const title = editingSite ? 'Edit Project Site' : 'Add Project Site';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={(
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button class="btn btn-danger-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <><i class="fas fa-spinner fa-spin" /> Saving…</> : (editingSite ? 'Update Site' : 'Add Project Site')}
          </button>
        </div>
      ) as VNode}
    >
      <form id="addProjectForm" onSubmit={e => e.preventDefault()}>
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">Project Name *</label>
            <input class={`form-control${errors.name ? ' is-invalid' : ''}`} id="projectName" {...field('name')} />
            {errors.name && <div class="invalid-feedback">{errors.name}</div>}
          </div>
          <div class="col-12">
            <label class="form-label">Address *</label>
            <input class={`form-control${errors.address ? ' is-invalid' : ''}`} id="projectAddress" {...field('address')} />
            {errors.address && <div class="invalid-feedback">{errors.address}</div>}
          </div>
          <div class="col-md-4">
            <label class="form-label">Latitude</label>
            <input class={`form-control${errors.latitude ? ' is-invalid' : ''}`} id="projectLatitude" {...field('latitude')} readOnly />
            {errors.latitude && <div class="invalid-feedback">{errors.latitude}</div>}
          </div>
          <div class="col-md-4">
            <label class="form-label">Longitude</label>
            <input class={`form-control${errors.longitude ? ' is-invalid' : ''}`} id="projectLongitude" {...field('longitude')} readOnly />
            {errors.longitude && <div class="invalid-feedback">{errors.longitude}</div>}
          </div>
          <div class="col-md-4">
            <label class="form-label">Radius (m) *</label>
            <input type="number" class={`form-control${errors.radius ? ' is-invalid' : ''}`} id="projectRadius" {...field('radius')} />
            {errors.radius && <div class="invalid-feedback">{errors.radius}</div>}
          </div>
          <div class="col-12">
            <label class="form-label">Description</label>
            <textarea class="form-control" id="projectDescription" rows={3}
              value={form.description}
              onInput={(e) => setForm(prev => ({ ...prev, description: (e.target as HTMLTextAreaElement).value }))}
            />
          </div>
        </div>

        {/* Coord display badge */}
        {form.latitude && form.longitude && (
          <div id="siteCoordDisplay" style="margin:12px 0;padding:8px 12px;background:#f0f4f8;border-radius:6px;font-size:0.85rem;">
            <i class="fas fa-map-pin" style="color:var(--siomac-red);margin-right:6px;" />
            <span id="siteLatDisplay">{parseFloat(form.latitude).toFixed(6)}</span>,{' '}
            <span id="siteLngDisplay">{parseFloat(form.longitude).toFixed(6)}</span>
          </div>
        )}

        <div style="display:flex;gap:8px;margin:12px 0;">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="pickOnMapBtn"
            onClick={() => setShowMap(v => !v)}>
            <i class="fas fa-map" /> {showMap ? 'Hide Map' : 'Set Location on Map'}
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="useMyLocationBtn"
            onClick={useMyLocation}>
            <i class="fas fa-location-dot" /> Use My Location
          </button>
        </div>

        <MapPicker
          show={showMap}
          lat={form.latitude}
          lng={form.longitude}
          radius={form.radius}
          onCoordsSet={coordsSet}
        />

        <hr />
        <label class="form-label">Assign Employees</label>
        <EmployeePicker
          all={allEmployees}
          selected={pickerSel}
          onChange={setPickerSel}
        />
      </form>
    </Modal>
  );
}

// ── Stats row ─────────────────────────────────────────────────────────────────

interface StatsProps {
  total:          number;
  activeGeofences: number;
  assigned:       number;
  attendance:     number;
}

function StatsRow({ total, activeGeofences, assigned, attendance }: StatsProps): VNode {
  return (
    <div class="ps-stats-row">
      <div class="ps-stat-card">
        <div class="ps-stat-icon"><i class="fas fa-hard-hat" /></div>
        <div class="ps-stat-value" id="psTotalSites">{total}</div>
        <div class="ps-stat-label">Total Sites</div>
      </div>
      <div class="ps-stat-card">
        <div class="ps-stat-icon"><i class="fas fa-map-pin" /></div>
        <div class="ps-stat-value" id="psActiveZones">{activeGeofences}</div>
        <div class="ps-stat-label">Active Geofences</div>
      </div>
      <div class="ps-stat-card">
        <div class="ps-stat-icon"><i class="fas fa-users" /></div>
        <div class="ps-stat-value" id="psAssignedWorkers">{assigned}</div>
        <div class="ps-stat-label">Assigned Workers</div>
      </div>
      <div class="ps-stat-card">
        <div class="ps-stat-icon"><i class="fas fa-chart-line" /></div>
        <div class="ps-stat-value" id="psSiteAttendance">{attendance}</div>
        <div class="ps-stat-label">Site Attendance</div>
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export function ProjectSitesSection(): VNode {
  const qc              = useQueryClient();
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);

  const [filter,       setFilter]       = useState<SiteFilter>('all');
  const [search,       setSearch]       = useState('');
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editingSite,  setEditingSite]  = useState<ProjectSite | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSite | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const sitesQuery = useQuery({
    queryKey: ['projectSites'],
    queryFn:  ({ signal }) => listProjectSites(signal),
    enabled:  isAuthenticated,
  });

  const win   = window as unknown as Record<string, unknown>;
  const AppSt = win['AppState'] as { get: (k: string) => string } | undefined;
  const role  = AppSt?.get('currentRole') || 'admin';
  const scope = role === 'admin' ? 'all' : (AppSt?.get('currentDeptId') || 'all');

  const liveQuery = useQuery({
    queryKey: ['liveAttendance'],
    queryFn:  ({ signal }) => getLiveAttendance(scope, signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled:  isAuthenticated,
  });

  const sites     = sitesQuery.data?.sites     || [];
  const employees = sitesQuery.data?.employees || [];
  const liveRows  = liveQuery.data             || [];
  const isAdmin   = role === 'admin';

  // ── Derive isActive from liveData ───────────────────────────────────────────
  const checkedInSiteIds = useMemo(() => {
    return new Set(
      liveRows.filter(r => !r.isCheckedOut && r.siteId).map(r => String(r.siteId)),
    );
  }, [liveRows]);

  const sitesWithActive: ProjectSite[] = useMemo(() => {
    return sites.map(s => ({ ...s, isActive: checkedInSiteIds.has(String(s.id)) }));
  }, [sites, checkedInSiteIds]);

  // ── Filter + search ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = q
      ? sitesWithActive.filter(s => s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
      : sitesWithActive;
    if (filter === 'active')   list = list.filter(s => s.isActive);
    if (filter === 'inactive') list = list.filter(s => !s.isActive);
    return list;
  }, [sitesWithActive, search, filter]);

  const activePart   = filtered.filter(s => s.isActive);
  const inactivePart = filtered.filter(s => !s.isActive);
  const hasActiveSites = sitesWithActive.some(s => s.isActive);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const activeSites = sitesWithActive.filter(s => s.isActive);
  const selSite     = selectedId
    ? sitesWithActive.find(s => String(s.id) === selectedId)
    : null;

  let assignedStat  = 0;
  let attendanceStat = 0;
  if (selSite && selSite.isActive) {
    const assigned   = (selSite.assignedEmployees || []).length;
    const checkedIn  = liveRows.filter(r => !r.isCheckedOut && String(r.siteId) === String(selSite.id)).length;
    assignedStat  = assigned;
    attendanceStat = assigned > 0 ? Math.round((checkedIn / assigned) * 100) : 0;
  }

  // Active section header stats
  const activeSiteIds  = new Set(activePart.map(s => String(s.id)));
  const onSiteNow      = liveRows.filter(r => !r.isCheckedOut && activeSiteIds.has(String(r.siteId))).length;
  const lateToday      = liveRows.filter(r => !r.isCheckedOut && r.status === 'late' && activeSiteIds.has(String(r.siteId))).length;

  // ── Handlers ────────────────────────────────────────────────────────────────
  function openAdd(): void {
    setEditingSite(null);
    setModalOpen(true);
  }

  function openEdit(site: ProjectSite): void {
    setEditingSite(site);
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingSite(null);
  }

  function onSaved(): void {
    void qc.invalidateQueries({ queryKey: ['projectSites'] });
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const actorId       = AppSt?.get('currentUserId') || '';
      const actorUsername = AppSt?.get('currentUser') || '';
      const res = await deleteProjectSiteApi(String(deleteTarget.id), actorId, actorUsername);
      if (res.success) {
        toast.success('Project site has been deleted.');
        void qc.invalidateQueries({ queryKey: ['projectSites'] });
      } else {
        toast.error(res.message || 'Could not delete');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  function selectSite(id: string): void {
    setSelectedId(prev => prev === id ? null : id);
  }

  // If active filter chosen but no active sites — revert to 'all'
  useEffect(() => {
    if (!hasActiveSites && filter === 'active') setFilter('all');
  }, [hasActiveSites, filter]);

  const isLoading = sitesQuery.isLoading;
  const isError   = sitesQuery.isError;

  return (
    <div>
      {/* Stats */}
      <StatsRow
        total={sitesWithActive.length}
        activeGeofences={activeSites.length}
        assigned={assignedStat}
        attendance={attendanceStat}
      />

      {/* Filters bar */}
      <div class="ps-filters-bar">
        <div class="ps-search-box">
          <i class="fas fa-search" />
          <input
            type="text"
            id="projectSearchInput"
            placeholder="Search by name, location…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="lv-tabs">
          {(['all', 'active', 'inactive'] as SiteFilter[]).map(f => (
            <button
              key={f}
              class={`lv-tab-btn${filter === f ? ' active' : ''}`}
              data-filter={f}
              disabled={f === 'active' && !hasActiveSites}
              style={f === 'active' && !hasActiveSites ? 'opacity:0.4;cursor:not-allowed;' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
        <div class="lv-bar-spacer" />
        <div class="lv-bar-actions">
          {isAdmin && (
            <button class="btn btn-danger-primary btn-sm admin-only" id="addProjectBtn" onClick={openAdd}>
              <i class="fas fa-plus" /> Add Project Site
            </button>
          )}
          <button
            class="btn btn-outline-secondary btn-sm"
            id="refreshProjectsBtn"
            onClick={() => void qc.invalidateQueries({ queryKey: ['projectSites'] })}
          >
            <i class="fas fa-sync-alt" />
          </button>
        </div>
      </div>

      {/* Loading / error states */}
      {isLoading && <div style="padding:40px;text-align:center;"><Spinner /></div>}
      {isError && (
        <p style="color:#b00;padding:16px;font-weight:600;">
          Error: {sitesQuery.error instanceof Error ? sitesQuery.error.message : 'Failed to load project sites'}
        </p>
      )}

      {/* Active sites section */}
      {!isLoading && !isError && (
        <>
          <div
            class={`ps-section ps-section--active${(filter === 'inactive' || !hasActiveSites) ? ' hidden' : ''}`}
            id="psActiveSectionWrap"
          >
            <div class="ps-section-container">
              <div class="ps-section-header">
                <div class="ps-section-icon"><i class="fas fa-map-location-dot" /></div>
                <div class="ps-section-label">
                  <h4 class="ps-section-title">Live Worksites</h4>
                  <div class="ps-section-sub">Locations with active workforce presence</div>
                </div>
                <div class="ps-section-stats">
                  <div class="ps-section-stat">
                    <span class="ps-section-stat-val" id="psActiveSectionCount">{activePart.length}</span>
                    <span class="ps-section-stat-lbl">Sites</span>
                  </div>
                  <div class="ps-section-stat-divider" />
                  <div class="ps-section-stat">
                    <span class="ps-section-stat-val" id="psActiveOnSiteNow">{onSiteNow}</span>
                    <span class="ps-section-stat-lbl">On Site</span>
                  </div>
                  <div class="ps-section-stat-divider" />
                  <div class="ps-section-stat">
                    <span class="ps-section-stat-val" id="psActiveCheckedOutToday">{lateToday}</span>
                    <span class="ps-section-stat-lbl">Late Today</span>
                  </div>
                </div>
              </div>
              <div class="ps-projects-grid" id="psActiveContainer">
                {activePart.map(site => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    liveRows={liveRows}
                    isAdmin={isAdmin}
                    selected={selectedId === String(site.id)}
                    onSelect={selectSite}
                    onEdit={openEdit}
                    onDelete={s => setDeleteTarget(s)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Inactive sites section */}
          <div
            class={`ps-section ps-section--inactive${filter === 'active' ? ' hidden' : ''}`}
            id="psInactiveSectionWrap"
          >
            <div class="ps-section-container">
              <div class="ps-section-header">
                <div class="ps-section-icon"><i class="fas fa-building-circle-xmark" /></div>
                <div class="ps-section-label">
                  <h4 class="ps-section-title">Inactive Sites</h4>
                  <div class="ps-section-sub">No employees currently on-site</div>
                </div>
                <div class="ps-section-stats">
                  <div class="ps-section-stat">
                    <span class="ps-section-stat-val" id="psInactiveSectionCount">{inactivePart.length}</span>
                    <span class="ps-section-stat-lbl">Sites</span>
                  </div>
                </div>
              </div>
              <div class="ps-projects-grid" id="psInactiveContainer">
                {inactivePart.map(site => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    liveRows={liveRows}
                    isAdmin={isAdmin}
                    selected={selectedId === String(site.id)}
                    onSelect={selectSite}
                    onEdit={openEdit}
                    onDelete={s => setDeleteTarget(s)}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add / Edit modal */}
      <SiteModal
        open={modalOpen}
        editingSite={editingSite}
        allEmployees={employees}
        onClose={closeModal}
        onSaved={onSaved}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete Project Site"
        message={`Are you sure you want to delete "${deleteTarget?.name || 'this site'}"?`}
        confirmLabel="Yes, delete it"
        loading={deleting}
      />
    </div>
  );
}
