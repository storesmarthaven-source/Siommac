/**
 * src/lib/appState.ts
 *
 * Shared state bus — ported from assets/js/state.js.
 *
 * Single source of truth for all cross-module state.
 * Identical API to the legacy window.AppState:
 *   AppState.get(key)       → current value
 *   AppState.set(key, val)  → update + notify listeners
 *   AppState.on(key, fn)    → subscribe; returns unsubscribe()
 *   AppState.seed(obj)      → bulk-set on login
 *   AppState.reset()        → wipe all mutable state on logout
 *
 * Also registers itself on window.AppState so app.js and any remaining
 * vanilla scripts continue to work unchanged during the transition.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

type StoreValue =
  | string | number | boolean | null | undefined
  | object | unknown[] | Record<string, unknown>;

interface Store {
  // ── Session ────────────────────────────────────────────────────────────────
  currentUser:             string | null;
  currentUserId:           string | number | null;
  currentFullName:         string | null;
  currentDeptId:           string | null;
  currentRole:             string | null;
  currentColorScheme:      string;
  currentLayoutMode:       string;

  // ── Attendance / camera ────────────────────────────────────────────────────
  cameraStream:            MediaStream | null;
  currentAttendanceAction: string | null;
  capturedPhotoData:       string | null;
  currentLocationData:     object | null;
  locationWatchId:         number | null;
  attendanceZones:         unknown[];
  userLocation:            { lat: number; lng: number; accuracy: number } | null;

  // ── Shared data lists ──────────────────────────────────────────────────────
  departments:             unknown[];
  employees:               unknown[];
  projectSites:            unknown[];
  _totalActiveEmployees:   number;

  // ── Live map ───────────────────────────────────────────────────────────────
  map:                     object | null;
  userMarker:              object | null;
  liveMarkers:             unknown[];
  _liveClusterGroup:       object | null;
  liveData:                unknown[];
  _mapViewSet:             boolean;
  _selectedSiteId:         string;
  _siteLayerMap:           Record<string, unknown>;
  _activeEmpMarker:        object | null;

  // ── Photo cache ────────────────────────────────────────────────────────────
  _photoCache:             Record<string, string>;

  // ── Misc ───────────────────────────────────────────────────────────────────
  lastSyncTime:            string | null;
  syncInterval:            ReturnType<typeof setInterval> | null;
  _currentProfileImage:    string | null;

  // Allow arbitrary extra keys written by app.js / legacy scripts
  [key: string]: StoreValue;
}

const _store: Store = {
  currentUser:             null,
  currentUserId:           null,
  currentFullName:         null,
  currentDeptId:           null,
  currentRole:             null,
  currentColorScheme:      'navy',
  currentLayoutMode:       'sidebar',

  cameraStream:            null,
  currentAttendanceAction: null,
  capturedPhotoData:       null,
  currentLocationData:     null,
  locationWatchId:         null,
  attendanceZones:         [],
  userLocation:            null,

  departments:             [],
  employees:               [],
  projectSites:            [],
  _totalActiveEmployees:   0,

  map:                     null,
  userMarker:              null,
  liveMarkers:             [],
  _liveClusterGroup:       null,
  liveData:                [],
  _mapViewSet:             false,
  _selectedSiteId:         '',
  _siteLayerMap:           {},
  _activeEmpMarker:        null,

  _photoCache:             {},

  lastSyncTime:            null,
  syncInterval:            null,
  _currentProfileImage:    null,
};

type Listener = (val: StoreValue) => void;
const _listeners: Record<string, Set<Listener>> = {};

function get(key: string): StoreValue {
  return _store[key];
}

function set(key: string, val: StoreValue): void {
  _store[key] = val;
  const fns = _listeners[key];
  if (fns) {
    fns.forEach(fn => { try { fn(val); } catch { /* swallow listener errors */ } });
  }
}

/** Subscribe to a key change. Returns an unsubscribe function. */
function on(key: string, fn: Listener): () => void {
  _listeners[key] ??= new Set();
  _listeners[key].add(fn);
  return () => { _listeners[key]?.delete(fn); };
}

/** Bulk-set on login. */
function seed(obj: Partial<Store>): void {
  Object.keys(obj).forEach(k => set(k, (obj as Record<string, StoreValue>)[k]));
}

/** Reset all mutable state on logout. */
function reset(): void {
  set('currentUser',             null);
  set('currentUserId',           null);
  set('currentFullName',         null);
  set('currentDeptId',           null);
  set('currentRole',             null);
  set('cameraStream',            null);
  set('currentAttendanceAction', null);
  set('capturedPhotoData',       null);
  set('currentLocationData',     null);
  set('locationWatchId',         null);
  set('attendanceZones',         []);
  set('userLocation',            null);
  set('departments',             []);
  set('employees',               []);
  set('projectSites',            []);
  set('_totalActiveEmployees',   0);
  set('map',                     null);
  set('userMarker',              null);
  set('liveMarkers',             []);
  set('_liveClusterGroup',       null);
  set('liveData',                []);
  set('_mapViewSet',             false);
  set('_selectedSiteId',         '');
  set('_siteLayerMap',           {});
  set('_activeEmpMarker',        null);
  set('_photoCache',             {});
  set('lastSyncTime',            null);
  set('syncInterval',            null);
  set('_currentProfileImage',    null);
}

export const AppState = { get, set, on, seed, reset };

// ── Register on window so app.js / legacy scripts keep working ────────────────
(window as unknown as Record<string, unknown>).AppState = AppState;
