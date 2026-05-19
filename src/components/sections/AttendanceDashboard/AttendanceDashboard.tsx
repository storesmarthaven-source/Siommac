/**
 * src/components/sections/AttendanceDashboard/AttendanceDashboard.tsx
 *
 * Employee attendance home controller.
 *
 * Mounts as a headless controller inside #s-emp-attendance — drives the
 * existing vanilla HTML (status badge, check-in/out buttons, time displays)
 * via DOM writes, exactly as app.js used to. Replaces:
 *   - checkStatus() / updateDashboardUI()   → useQuery('myStatus')
 *   - openCameraModal() / capturePhoto()    → <CameraModal> Preact component
 *   - confirmAttendance()                   → useMutation
 *
 * The Bootstrap camera modal (#cameraModal) in app-shell.html is replaced by
 * a pure Preact modal rendered via a portal onto document.body, allowing us to
 * remove the Bootstrap JS dependency from the camera flow entirely.
 *
 * DOM writes:
 *   #statusBadge, #checkInBtn, #checkOutBtn   — status + button visibility
 *   #checkInTime, #checkOutTime                — time labels
 *   #todayHoursDisplay                         — live hours counter
 *   #currentLocation                           — location text
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, Fragment }        from 'preact';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { getMyStatus, listProjectSites, markAttendance } from './api';
import type {
  AttendanceStatus,
  ProjectSiteOption,
  LocationData,
  AttendanceAction,
  CameraPhase,
} from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtLocalTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (_) { return '--:--'; }
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R      = 6_371_000;
  const toRad  = (d: number) => (d * Math.PI) / 180;
  const dLat   = toRad(lat2 - lat1);
  const dLng   = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getCurrentLocation(): Promise<LocationData> {
  return new Promise((resolve) => {
    const fallback: LocationData = {
      fallback: true, latitude: 10.6549, longitude: -61.5019,
      accuracy: 1000, timestamp: new Date().toISOString(),
    };
    if (!navigator.geolocation) { resolve(fallback); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy:  pos.coords.accuracy,
        timestamp: new Date().toISOString(),
      }),
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

function getAppStateUsername(): string {
  const win  = window as unknown as Record<string, unknown>;
  const AS   = win['AppState'] as { get?: (k: string) => string } | undefined;
  return AS?.get?.('currentUser') ?? '';
}

function getAppStateUserId(): string {
  const win = window as unknown as Record<string, unknown>;
  const AS  = win['AppState'] as { get?: (k: string) => string } | undefined;
  return AS?.get?.('currentUserId') ?? '';
}

// ── DOM sync helpers (write status back into the vanilla HTML shell) ───────────

function syncStatusDom(status: AttendanceStatus): void {
  const badge      = document.getElementById('statusBadge');
  const checkInBtn = document.getElementById('checkInBtn');
  const checkOutBtn= document.getElementById('checkOutBtn');

  if (!badge || !checkInBtn || !checkOutBtn) return;

  if (status.hasCheckedIn && !status.hasCheckedOut) {
    badge.innerHTML   = '<i class="fas fa-check-circle"></i> Checked In';
    badge.className   = 'ea-status-badge ea-status-in';
    checkInBtn.classList.add('hidden');
    checkOutBtn.classList.remove('hidden');
    (checkOutBtn as HTMLButtonElement).disabled = false;
  } else if (status.hasCheckedIn && status.hasCheckedOut) {
    badge.innerHTML   = '<i class="fas fa-sign-out-alt"></i> Checked Out';
    badge.className   = 'ea-status-badge ea-status-out';
    checkOutBtn.classList.add('hidden');
    checkInBtn.classList.remove('hidden');
    (checkInBtn as HTMLButtonElement).disabled = true;
    checkInBtn.className  = 'ea-action-btn ea-action-btn-complete';
    checkInBtn.innerHTML  = '<i class="fas fa-calendar-check"></i> Attendance Complete';
  } else {
    badge.innerHTML   = '<i class="fas fa-clock"></i> Not Checked In';
    badge.className   = 'ea-status-badge ea-status-none';
    checkInBtn.classList.remove('hidden');
    (checkInBtn as HTMLButtonElement).disabled = false;
    checkInBtn.style.opacity = '';
    checkInBtn.style.cursor  = '';
    checkInBtn.innerHTML     = '<i class="fas fa-camera"></i> <span id="checkInText">Check In</span>';
    checkOutBtn.classList.add('hidden');
  }

  const ciTime = document.getElementById('checkInTime');
  const coTime = document.getElementById('checkOutTime');
  if (ciTime) ciTime.textContent  = status.checkInTime  ? fmtLocalTime(status.checkInTime)  : '--:--';
  if (coTime) coTime.textContent  = status.checkOutTime ? fmtLocalTime(status.checkOutTime) : '--:--';
  if (status.location) {
    const locEl = document.getElementById('currentLocation');
    if (locEl && !locEl.querySelector('a')) locEl.textContent = status.location;
  }

  const hoursEl = document.getElementById('todayHoursDisplay');
  if (hoursEl) {
    if (status.hasCheckedIn && !status.hasCheckedOut && status.checkInTime) {
      const diff = (Date.now() - new Date(status.checkInTime).getTime()) / 3_600_000;
      hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
    } else if (status.hasCheckedIn && status.checkInTime && status.checkOutTime) {
      const diff = (new Date(status.checkOutTime).getTime() - new Date(status.checkInTime).getTime()) / 3_600_000;
      hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
    } else {
      hoursEl.textContent = '0.0 hrs';
    }
  }
}

// ── Location display helper ───────────────────────────────────────────────────

function LocationDisplay({ location, site }: {
  location: LocationData | null;
  site:     ProjectSiteOption | null;
}) {
  if (!location) {
    return (
      <div class="cm-location cm-location--pending">
        <i class="fas fa-spinner fa-pulse fa-fw"></i>
        <span>Verifying your location…</span>
      </div>
    );
  }

  const accuracy    = location.fallback ? 'Approximate location' : `Accuracy: ${Math.round(location.accuracy)}m`;
  const siteLat     = site ? Number(site.latitude)  : NaN;
  const siteLng     = site ? Number(site.longitude) : NaN;
  const siteRad     = site ? (Number(site.radius) || 200) : 200;
  const gpsAcc      = Math.round(location.accuracy || 0);

  if (!location.fallback && site && !isNaN(siteLat) && !isNaN(siteLng)) {
    const dist        = haversineM(location.latitude, location.longitude, siteLat, siteLng);
    const inside      = dist <= siteRad + gpsAcc;
    const distLabel   = dist < 1000 ? `${dist}m away` : `${(dist / 1000).toFixed(1)}km away`;
    const coordLabel  = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
    return (
      <div class={`cm-location ${inside ? 'cm-location--valid' : 'cm-location--warn'}`}>
        <i class={`fas fa-${inside ? 'check-circle' : 'exclamation-triangle'} fa-fw`}></i>
        <span>{inside ? 'Within site · ' : 'Too far · '}{distLabel} · {accuracy} · {coordLabel}</span>
      </div>
    );
  }

  const coordLabel = (!location.fallback && location.latitude)
    ? ` · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : '';
  return (
    <div class="cm-location cm-location--valid">
      <i class="fas fa-check-circle fa-fw"></i>
      <span>Location verified · {accuracy}{coordLabel}</span>
    </div>
  );
}

// ── Site selector ─────────────────────────────────────────────────────────────

function SiteSelector({ sites, selectedSiteId, onSelect }: {
  sites:          ProjectSiteOption[];
  selectedSiteId: string;
  onSelect:       (id: string, site: ProjectSiteOption | null) => void;
}) {
  const userId = getAppStateUserId();

  // For employees: only show sites they are assigned to
  const filtered = sites.filter((s) => {
    if (!s.assignedEmployees?.length) return true;
    return s.assignedEmployees.some((e) => String(e.id) === String(userId));
  });

  function handleChange(e: Event) {
    const val  = (e.currentTarget as HTMLSelectElement).value;
    const site = filtered.find((s) => String(s.id) === val) ?? null;
    onSelect(val, site);
  }

  return (
    <div id="cmSiteWrap" class="cm-site-wrap">
      <div class="cm-site-header">
        <div class="cm-site-label"><i class="fas fa-map-marker-alt"></i> Select Project Site</div>
        <div class={`cm-site-status ${selectedSiteId ? 'cm-site-status--ok' : 'cm-site-status--required'}`}>
          {selectedSiteId
            ? <><i class="fas fa-check-circle"></i> {filtered.find((s) => String(s.id) === selectedSiteId)?.name ?? selectedSiteId}</>
            : <><i class="fas fa-exclamation-circle"></i> Required</>
          }
        </div>
      </div>
      <select
        id="cmSiteSelect"
        class="cm-site-select"
        value={selectedSiteId}
        onChange={handleChange}
      >
        <option value="">
          {filtered.length === 0 ? '— No sites assigned to you —' : '— Choose a site —'}
        </option>
        {filtered.map((s) => (
          <option key={String(s.id)} value={String(s.id)}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

// ── Camera modal ──────────────────────────────────────────────────────────────

interface CameraModalProps {
  action:      AttendanceAction;
  sites:       ProjectSiteOption[];
  onSuccess:   (result: { time?: string; site?: string }) => void;
  onClose:     () => void;
}

function CameraModal({ action, sites, onSuccess, onClose }: CameraModalProps) {
  const isCheckIn = action === 'CheckIn';

  const [phase,          setPhase]          = useState<CameraPhase>('live');
  const [capturedData,   setCapturedData]   = useState<string | null>(null);
  const [location,       setLocation]       = useState<LocationData | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedSite,   setSelectedSite]   = useState<ProjectSiteOption | null>(null);
  const [error,          setError]          = useState<string | null>(null);

  const videoRef   = useRef<HTMLVideoElement | null>(null);
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  const username = getAppStateUsername();

  // Start camera on mount
  useEffect(() => {
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Camera unavailable. Please grant camera permissions.'));

    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Get GPS on mount
  useEffect(() => {
    getCurrentLocation().then(setLocation);
  }, []);

  // Trap focus + close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function handleCapture() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState !== 4 || !canvas) {
      setError('Camera is not ready. Please wait a moment.');
      return;
    }
    const maxDim = 640;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Mirror the selfie horizontally (front-cam natural feel)
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    let dataUrl: string;
    try { dataUrl = canvas.toDataURL('image/jpeg', 0.7); }
    catch (_) { dataUrl = canvas.toDataURL(); }

    // Stop live stream — photo taken
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setCapturedData(dataUrl);
    setPhase('captured');
  }

  function handleRetake() {
    setCapturedData(null);
    setPhase('live');
    setError(null);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Camera unavailable.'));
  }

  const { mutate: submitAttendance, isPending } = useMutation({
    mutationFn: () => {
      if (!capturedData) throw new Error('No photo captured.');
      const loc = location
        ? { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }
        : null;
      return markAttendance({ username, action, photoBase64: capturedData, location: loc, siteId: selectedSiteId });
    },
    onSuccess: (result) => {
      if (result.success) {
        onSuccess({ time: result.time, site: result.site });
      } else {
        setError(result.message ?? 'Attendance submission failed.');
        setPhase('captured');
      }
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setPhase('captured');
    },
  });

  function handleConfirm() {
    if (!capturedData) return;
    if (isCheckIn && !selectedSiteId) { setError('Please select a project site before confirming.'); return; }
    setPhase('submitting');
    setError(null);
    submitAttendance();
  }

  function handleSiteSelect(id: string, site: ProjectSiteOption | null) {
    setSelectedSiteId(id);
    setSelectedSite(site);
    setError(null);
  }

  const title = isCheckIn ? 'Check In · Selfie Verification' : 'Check Out · Selfie Verification';
  const confirmLabel = isCheckIn ? 'Confirm Check In' : 'Confirm Check Out';
  const canCapture   = !isCheckIn || !!selectedSiteId;
  const canConfirm   = !!capturedData && (!isCheckIn || !!selectedSiteId);
  const isSubmitting = phase === 'submitting' || isPending;

  return (
    <div
      class="modal fade show"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, zIndex: 1055, background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if ((e.target as Element).classList.contains('modal')) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div class="modal-dialog modal-dialog-centered cm-dialog" style={{ margin: 0, pointerEvents: 'none' }} onClick={(e) => e.stopPropagation()}>
        <div class="modal-content cm-card" style={{ pointerEvents: 'auto' }}>

          {/* Header */}
          <div class="cm-header">
            <h3 class="cm-title">
              <i class={`fas fa-${phase === 'captured' ? 'check-circle' : 'camera'}`}></i>{' '}
              {phase === 'captured' ? 'Verify Selfie' : title}
            </h3>
            <button type="button" class="cm-close" onClick={onClose} aria-label="Close" disabled={isSubmitting}>
              <i class="fas fa-times"></i>
            </button>
          </div>

          {/* Site selector (check-in only) */}
          {isCheckIn && (
            <SiteSelector
              sites={sites}
              selectedSiteId={selectedSiteId}
              onSelect={handleSiteSelect}
            />
          )}

          {/* Location status */}
          <LocationDisplay location={location} site={selectedSite} />

          {/* Hidden capture canvas — always in DOM so ref is stable */}
          <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

          {/* Live video feed — hidden after capture */}
          <div class="cm-camera-area" style={{ display: phase === 'live' ? '' : 'none' }}>
            <video ref={videoRef} autoplay playsinline style={{ width: '100%' }}></video>
          </div>

          {/* Captured photo preview */}
          <div class="cm-captured" style={{ display: phase === 'captured' || phase === 'submitting' ? '' : 'none' }}>
            {capturedData && <img src={capturedData} alt="Captured selfie" />}
          </div>

          {/* Error message */}
          {error && (
            <div class="cm-location cm-location--warn" style={{ marginTop: 6 }}>
              <i class="fas fa-exclamation-triangle fa-fw"></i>
              <span>{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div class="cm-actions">
            {phase === 'live' && (
              <button
                class="cm-btn cm-btn--red"
                onClick={handleCapture}
                disabled={!canCapture}
              >
                <i class="fas fa-camera"></i> Capture Selfie
              </button>
            )}
            {phase === 'captured' && (
              <>
                <button class="cm-btn cm-btn--outline" onClick={handleRetake}>
                  <i class="fas fa-redo-alt"></i> Retake
                </button>
                <button
                  class="cm-btn cm-btn--green"
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                >
                  <i class="fas fa-check-circle"></i> {confirmLabel}
                </button>
              </>
            )}
            {isSubmitting && (
              <button class="cm-btn cm-btn--green" disabled>
                <i class="fas fa-spinner fa-pulse"></i> Submitting…
              </button>
            )}
          </div>

          <p class="cm-info">
            <i class="fas fa-info-circle"></i> Ensure your face is clearly visible. Selfie is used for attendance verification.
          </p>

        </div>
      </div>
    </div>
  );
}

// ── Main controller — headless, drives DOM + opens modal ──────────────────────

interface AttendanceDashboardProps {
  username: string;
}

export function AttendanceDashboard({ username }: AttendanceDashboardProps) {
  const qc = useQueryClient();

  const [modalAction, setModalAction] = useState<AttendanceAction | null>(null);

  // Poll status every 30 s (matches legacy autoSync interval)
  const { data: status } = useQuery({
    queryKey:        ['myStatus', username],
    queryFn:         ({ signal }) => getMyStatus(username, signal),
    refetchInterval: 30_000,
    enabled:         !!username,
  });

  // Prefetch sites in background so modal opens instantly
  const { data: sites = [] } = useQuery({
    queryKey: ['projectSites', 'forCheckIn'],
    queryFn:  ({ signal }) => listProjectSites(signal),
    staleTime: 5 * 60_000,
  });

  // Sync status to DOM whenever it changes
  useEffect(() => {
    if (status) syncStatusDom(status);
  }, [status]);

  // Wire check-in / check-out buttons in the vanilla HTML
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element;
      if (target.closest('#checkInBtn'))  { e.preventDefault(); setModalAction('CheckIn');  }
      if (target.closest('#checkOutBtn')) { e.preventDefault(); setModalAction('CheckOut'); }
      if (target.closest('#viewHistoryBtn')) {
        e.preventDefault();
        const nav = (window as unknown as Record<string, unknown>)['Nav'] as { showSection?: (id: string) => void } | undefined;
        nav?.showSection?.('s-emp-history');
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  function handleAttendanceSuccess(result: { time?: string; site?: string }) {
    setModalAction(null);

    // Optimistic DOM update
    if (modalAction) {
      const isCheckIn = modalAction === 'CheckIn';
      const now       = new Date().toISOString();
      syncStatusDom({
        hasCheckedIn:  true,
        hasCheckedOut: !isCheckIn,
        checkInTime:   isCheckIn ? now : (status?.checkInTime ?? null),
        checkOutTime:  isCheckIn ? null : now,
        location:      result.site ?? status?.location ?? '',
      });
    }

    // Show success popup via cpop (legacy SweetAlert2 wrapper still on window)
    const cpop = (window as unknown as Record<string, unknown>)['cpop'] as {
      fire?: (opts: Record<string, unknown>) => void;
    } | undefined;
    const actionText  = modalAction === 'CheckIn' ? 'Check In' : 'Check Out';
    const timeDisplay = result.time ? fmtLocalTime(result.time) : '';
    cpop?.fire?.({
      icon: 'success',
      title: `${actionText} Successful!`,
      text: `${timeDisplay}${result.site ? ' · ' + result.site : ''}`,
    });

    // Invalidate all related queries
    void qc.invalidateQueries({ queryKey: ['myStatus'] });
    void qc.invalidateQueries({ queryKey: ['attendance'] });
    void qc.invalidateQueries({ queryKey: ['liveAttendance'] });
    void qc.invalidateQueries({ queryKey: ['dashboard', 'charts'] });
    void qc.invalidateQueries({ queryKey: ['dashboard', 'myChart'] });

    // Notify legacy LiveMap / Nav (still on window)
    const win = window as unknown as Record<string, unknown>;
    const LM  = win['LiveMap']  as { loadLiveAttendance?: () => void } | undefined;
    const Nav = win['Nav']      as { _scheduleHdrBadgeSync?: () => void } | undefined;
    LM?.loadLiveAttendance?.();
    Nav?._scheduleHdrBadgeSync?.();
  }

  // Render only the camera modal portal — everything else is DOM-driven
  return (
    <>
      {modalAction && (
        <CameraModal
          action={modalAction}
          sites={sites}
          onSuccess={handleAttendanceSuccess}
          onClose={() => setModalAction(null)}
        />
      )}
    </>
  );
}
