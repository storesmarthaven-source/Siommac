/**
 * src/components/sections/Profile/MyProfileSection.tsx
 *
 * My Profile — v76 mockup faithfully ported to real data.
 *
 * Layout: two-column grid on desktop (profile column left, account card right).
 * All data is from real API calls; fields with no backend source are omitted.
 * Photo modal wires Cropper.js + server-side AI enhance (OpenAI, key is
 * backend-only). Styling under the `.mp76` scope in profilePage.css.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { PageHeader } from '@ui';
import { useSessionStore, toast } from '@store';
import {
  fetchMyProfile,
  fetchMyActivity,
  updateMyProfile,
  updateMyPassword,
  uploadMyProfilePhoto,
  removeMyProfilePhoto,
  enhanceMyProfilePhoto,
} from './api';
import type { ProfileData, ActivityEvent } from './types';
import './profilePage.css';

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function capRole(r: string | null | undefined): string {
  if (!r) return '—';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function initials(name: string, username: string): string {
  const src = (name || username || '?').trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return src.charAt(0).toUpperCase();
}

function b64ToFile(b64: string, mimeType: string, filename: string): File {
  const byteString = atob(b64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new File([ab], filename, { type: mimeType });
}

// ── Inline SVG icons (zero FA dependency, scope-safe) ────────────────────────

const IcoUser = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
const IcoShield = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IcoBell = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);
const IcoLogOut = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
);
const IcoMail = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
);
const IcoPhone = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l.91-1.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
);
const IcoBriefcase = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
);
const IcoBuilding = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);
const IcoId = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="16" y2="10"/><line x1="12" y1="14" x2="16" y2="14"/><circle cx="8" cy="10" r="1"/><circle cx="8" cy="14" r="1"/></svg>
);
const IcoKey = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
);
const IcoLock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const IcoCamera = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
);
const IcoSparkles = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
);
const IcoUpload = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
);
const IcoCheck = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20 6L9 17l-5-5"/></svg>
);
const IcoX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IcoHistory = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 3v5h5"/></svg>
);
const IcoChevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 9l6 6 6-6"/></svg>
);
const IcoClock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);
const IcoInfo = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
);
const IcoCrop = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>
);
const IcoTrash = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
);

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spin({ dark }: { dark?: boolean }): VNode {
  return <span class={`mp76-spinner${dark ? ' dark' : ''}`} aria-hidden="true" />;
}

// ── Modal backdrop / container ────────────────────────────────────────────────
function Modal({
  open, onClose, children, cls = '',
}: {
  open: boolean; onClose: () => void; children: VNode | VNode[]; cls?: string;
}): VNode {
  // Close on backdrop click
  const handleBackdrop = useCallback(
    (e: MouseEvent) => { if ((e.target as HTMLElement).classList.contains('mp76-modal-backdrop')) onClose(); },
    [onClose],
  );
  if (!open) return <></>;
  return (
    <div class="mp76-modal-backdrop open" onClick={handleBackdrop} role="dialog" aria-modal="true">
      <div class={`mp76-modal ${cls}`}>
        {children}
      </div>
    </div>
  );
}

// ── Password change modal ─────────────────────────────────────────────────────
function ChangePasswordModal({
  open, onClose, username, fullName,
}: {
  open: boolean; onClose: () => void; username: string; fullName: string;
}): VNode {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setOldPwd(''); setNewPwd(''); setConfirmPwd(''); setSaving(false); setError('');
  }, []);

  const handleClose = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  const handleSubmit = useCallback(async () => {
    setError('');
    if (!oldPwd)               { setError('Enter your current password.'); return; }
    if (!newPwd)               { setError('Enter a new password.'); return; }
    if (newPwd.length < 8)    { setError('New password must be at least 8 characters.'); return; }
    if (newPwd !== confirmPwd) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      await updateMyPassword({ username, fullName, oldPassword: oldPwd, newPassword: newPwd });
      reset();
      onClose();
      toast.success('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed. Check your current password.');
    } finally {
      setSaving(false);
    }
  }, [oldPwd, newPwd, confirmPwd, username, fullName, reset, onClose]);

  return (
    <Modal open={open} onClose={handleClose}>
      <div class="mp76-modal-head">
        <div class="mp76-modal-title-wrap">
          <div class="mp76-modal-icon"><IcoKey /></div>
          <div class="mp76-modal-title">
            <strong>Change Password</strong>
            <span>Update the password for your account</span>
          </div>
        </div>
        <button type="button" class="mp76-modal-close" onClick={handleClose} aria-label="Close"><IcoX /></button>
      </div>

      <div class="mp76-modal-body">
        <div class="mp76-security-form-grid">
          <div class="mp76-security-form-row">
            <label><IcoLock /> Current Password</label>
            <input
              type="password" value={oldPwd} autocomplete="current-password"
              placeholder="Enter your current password"
              onInput={e => setOldPwd((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="mp76-security-form-row">
            <label><IcoKey /> New Password</label>
            <input
              type="password" value={newPwd} autocomplete="new-password"
              placeholder="Minimum 8 characters"
              onInput={e => setNewPwd((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="mp76-security-form-row">
            <label><IcoKey /> Confirm New Password</label>
            <input
              type="password" value={confirmPwd} autocomplete="new-password"
              placeholder="Repeat new password"
              onInput={e => setConfirmPwd((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class={`mp76-modal-error${error ? ' show' : ''}`}>{error}</div>

        <div class="mp76-help-box">
          <strong>Password requirements</strong>
          <div class="mp76-check-list">
            <span><IcoCheck /> At least 8 characters long</span>
            <span><IcoCheck /> Different from your current password</span>
            <span><IcoCheck /> You will remain signed in after changing</span>
          </div>
        </div>
      </div>

      <div class="mp76-modal-footer">
        <button type="button" class="mp76-modal-btn" onClick={handleClose} disabled={saving}>Cancel</button>
        <button type="button" class="mp76-modal-btn primary" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? <><Spin /> Updating…</> : 'Update Password'}
        </button>
      </div>
    </Modal>
  );
}

// ── Logout confirmation modal ─────────────────────────────────────────────────
function LogoutModal({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const logout = useSessionStore(s => s.logout);
  const [busy, setBusy] = useState(false);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try { await logout(); }
    finally { setBusy(false); }
  }, [logout]);

  return (
    <Modal open={open} onClose={onClose} cls="logout-modal">
      <div class="mp76-modal-head">
        <div class="mp76-modal-title-wrap">
          <div class="mp76-modal-icon"><IcoLogOut /></div>
          <div class="mp76-modal-title">
            <strong>Sign Out</strong>
            <span>End your current session</span>
          </div>
        </div>
        <button type="button" class="mp76-modal-close" onClick={onClose} aria-label="Close"><IcoX /></button>
      </div>

      <div class="mp76-modal-body">
        <div class="mp76-logout-panel">
          <div class="mp76-logout-panel-icon"><IcoLogOut /></div>
          <div>
            <p class="mp76-logout-warning-copy">Are you sure you want to sign out?</p>
            <p class="mp76-logout-support-copy">Any unsaved changes will be lost. You can sign back in at any time.</p>
          </div>
        </div>

        <div class="mp76-session-box">
          <IcoClock />
          <span>Your session data will be cleared from this device upon signing out.</span>
        </div>
      </div>

      <div class="mp76-modal-footer">
        <button type="button" class="mp76-modal-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" class="mp76-modal-btn danger" onClick={() => void handleLogout()} disabled={busy}>
          {busy ? <><Spin /> Signing out…</> : <><IcoLogOut /> Sign Out</>}
        </button>
      </div>
    </Modal>
  );
}

// ── Lightweight canvas-based square cropper ───────────────────────────────────

/** Draws the image centered+letterboxed on the canvas, with an interactive
 *  square crop overlay that the user can drag/resize. Returns the crop square
 *  in image-space coordinates via getCropBlob(). */
interface CanvasCropper {
  destroy: () => void;
  getCropBlob: () => Promise<Blob>;
}

function initCanvasCropper(img: HTMLImageElement, canvas: HTMLCanvasElement): CanvasCropper {
  const ctx = canvas.getContext('2d')!;
  const CW = canvas.width;
  const CH = canvas.height;

  // Fit image into canvas (letterbox)
  const scale = Math.min(CW / img.naturalWidth, CH / img.naturalHeight);
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;
  const ox = (CW - iw) / 2;
  const oy = (CH - ih) / 2;

  // Initial crop square = largest square that fits in the image area
  const side = Math.min(iw, ih) * 0.85;
  let cx = ox + (iw - side) / 2;
  let cy = oy + (ih - side) / 2;
  let cs = side;

  type DragMode = 'none' | 'move' | 'resize-br';
  let drag: DragMode = 'none';
  let dragStartX = 0, dragStartY = 0, dragStartCx = 0, dragStartCy = 0, dragStartCs = 0;

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(img, ox, oy, iw, ih);

    // Dim outside crop
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, CW, cy);
    ctx.fillRect(0, cy + cs, CW, CH - cy - cs);
    ctx.fillRect(0, cy, cx, cs);
    ctx.fillRect(cx + cs, cy, CW - cx - cs, cs);

    // Crop border
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cs, cs);

    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + (cs / 3) * i, cy);
      ctx.lineTo(cx + (cs / 3) * i, cy + cs);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + (cs / 3) * i);
      ctx.lineTo(cx + cs, cy + (cs / 3) * i);
      ctx.stroke();
    }

    // Resize handle (bottom-right)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + cs, cy + cs, 7, 0, Math.PI * 2);
    ctx.fill();

    // Corner handles
    const hs = 10;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const corners: Array<[number, number]> = [[cx, cy], [cx + cs - hs, cy], [cx, cy + cs - hs]];
    for (const [hx, hy] of corners) ctx.fillRect(hx, hy, hs, hs);
  }

  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

  function onMouseDown(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    dragStartX = mx; dragStartY = my;
    dragStartCx = cx; dragStartCy = cy; dragStartCs = cs;

    // Resize handle hit test
    const dist = Math.hypot(mx - (cx + cs), my - (cy + cs));
    if (dist <= 14) { drag = 'resize-br'; return; }

    // Move hit test
    if (mx >= cx && mx <= cx + cs && my >= cy && my <= cy + cs) { drag = 'move'; return; }
    drag = 'none';
  }

  function onMouseMove(e: MouseEvent) {
    if (drag === 'none') return;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const dx = mx - dragStartX;
    const dy = my - dragStartY;

    if (drag === 'move') {
      cx = clamp(dragStartCx + dx, ox, ox + iw - cs);
      cy = clamp(dragStartCy + dy, oy, oy + ih - cs);
    } else if (drag === 'resize-br') {
      const newSize = clamp(dragStartCs + Math.max(dx, dy), 40, Math.min(iw, ih));
      cx = clamp(dragStartCx, ox, ox + iw - newSize);
      cy = clamp(dragStartCy, oy, oy + ih - newSize);
      cs = newSize;
    }
    draw();
  }

  function onMouseUp() { drag = 'none'; }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);

  draw();

  return {
    destroy() {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
    },
    getCropBlob(): Promise<Blob> {
      // Map canvas crop coords back to image-space
      const srcX = (cx - ox) / scale;
      const srcY = (cy - oy) / scale;
      const srcS = cs / scale;
      const out = document.createElement('canvas');
      out.width = 512; out.height = 512;
      const oc = out.getContext('2d')!;
      oc.drawImage(img, srcX, srcY, srcS, srcS, 0, 0, 512, 512);
      return new Promise<Blob>((resolve, reject) => {
        out.toBlob(b => b ? resolve(b) : reject(new Error('Crop failed')), 'image/webp', 0.90);
      });
    },
  };
}

// ── Change Photo modal ────────────────────────────────────────────────────────

type PhotoSelection = 'original' | 'enhanced';

function ChangePhotoModal({
  open, onClose, currentUrl, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  currentUrl: string;
  onSaved: (newUrl: string) => void;
}): VNode {
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const cropperRef    = useRef<CanvasCropper | null>(null);
  const cropImgRef    = useRef<HTMLImageElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const removeBtnRef  = useRef<HTMLButtonElement>(null);

  const [rawFile, setRawFile]             = useState<File | null>(null);
  const [rawDataUrl, setRawDataUrl]       = useState('');           // preview of original
  const [croppedBlob, setCroppedBlob]     = useState<Blob | null>(null);
  const [croppedUrl, setCroppedUrl]       = useState('');           // object url for cropped
  const [cropperActive, setCropperActive] = useState(false);

  const [enhancedB64, setEnhancedB64]     = useState('');           // base64 of AI output
  const [enhancedUrl, setEnhancedUrl]     = useState('');           // data url for enhanced
  const [enhancing, setEnhancing]         = useState(false);
  const [enhanceError, setEnhanceError]   = useState('');

  const [selected, setSelected]           = useState<PhotoSelection>('original');
  const [uploading, setUploading]         = useState(false);

  // Revoke object URLs on cleanup
  useEffect(() => {
    if (!open) {
      // Destroy cropper if modal closed mid-flow
      if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }
      // Revoke blobs
      if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
      if (enhancedUrl.startsWith('blob:')) URL.revokeObjectURL(enhancedUrl);
      setRawFile(null); setRawDataUrl('');
      setCroppedBlob(null); setCroppedUrl('');
      setCropperActive(false);
      setEnhancedB64(''); setEnhancedUrl('');
      setEnhancing(false); setEnhanceError('');
      setSelected('original'); setUploading(false);
    }
  // We only want to run cleanup when `open` flips to false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── File picker ──
  const handlePickFile = useCallback(() => { fileInputRef.current?.click(); }, []);

  const handleFileChange = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    // Validate type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are supported.');
      return;
    }
    // Validate size (10 MB UI limit — server also validates)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image exceeds 10 MB. Please choose a smaller image.');
      return;
    }

    // Destroy previous cropper
    if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }
    setCropperActive(false);
    if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
    setCroppedBlob(null); setCroppedUrl('');
    setEnhancedB64(''); setEnhancedUrl(''); setEnhanceError('');
    setSelected('original');
    setRawFile(file);

    // Read as data URL for the preview / cropper
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    setRawDataUrl(url);
    // Reset file input so the same file can be re-selected
    (e.target as HTMLInputElement).value = '';
  }, [croppedUrl]);

  // ── Canvas cropper init ──
  const initCropper = useCallback(() => {
    const img    = cropImgRef.current;
    const canvas = cropCanvasRef.current;
    if (!img || !canvas || !rawDataUrl) return;
    if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }

    const runInit = () => {
      const CANVAS_SIZE = 380;
      canvas.width  = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      cropperRef.current = initCanvasCropper(img, canvas);
      setCropperActive(true);
    };

    if (img.complete && img.naturalWidth > 0) {
      runInit();
    } else {
      img.onload = runInit;
    }
  }, [rawDataUrl]);

  const handleApplyCrop = useCallback(async () => {
    if (!cropperRef.current) return;
    try {
      const blob = await cropperRef.current.getCropBlob();
      if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
      const url = URL.createObjectURL(blob);
      setCroppedBlob(blob);
      setCroppedUrl(url);
      cropperRef.current.destroy();
      cropperRef.current = null;
      setCropperActive(false);
    } catch {
      toast.error('Crop failed. Try again.');
    }
  }, [croppedUrl]);

  const handleCancelCrop = useCallback(() => {
    cropperRef.current?.destroy();
    cropperRef.current = null;
    setCropperActive(false);
  }, []);

  // ── AI enhance ──
  const handleEnhance = useCallback(async () => {
    // Build a File from whichever image is available: cropped → raw
    let sourceFile: File | null = null;
    if (croppedBlob) {
      sourceFile = new File([croppedBlob], 'cropped.webp', { type: 'image/webp' });
    } else if (rawFile) {
      sourceFile = rawFile;
    }
    if (!sourceFile) { toast.error('Select a photo first.'); return; }

    setEnhancing(true);
    setEnhanceError('');
    setEnhancedB64('');
    if (enhancedUrl.startsWith('blob:')) URL.revokeObjectURL(enhancedUrl);
    setEnhancedUrl('');

    try {
      const result = await enhanceMyProfilePhoto(sourceFile);
      const dataUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
      setEnhancedB64(result.imageBase64);
      setEnhancedUrl(dataUrl);
      setSelected('enhanced');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Photo enhancement failed.';
      setEnhanceError(msg);
    } finally {
      setEnhancing(false);
    }
  }, [croppedBlob, rawFile, enhancedUrl]);

  // ── Upload + commit ──
  const handleUse = useCallback(async () => {
    let fileToUpload: File | null = null;

    if (selected === 'enhanced' && enhancedB64) {
      fileToUpload = b64ToFile(enhancedB64, 'image/png', 'enhanced-profile.png');
    } else if (croppedBlob) {
      fileToUpload = new File([croppedBlob], 'profile.webp', { type: 'image/webp' });
    } else if (rawFile) {
      fileToUpload = rawFile;
    }

    if (!fileToUpload) { toast.error('No photo selected.'); return; }

    setUploading(true);
    try {
      const { profileImage } = await uploadMyProfilePhoto(fileToUpload);
      onSaved(profileImage);
      toast.success('Profile photo updated.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }, [selected, enhancedB64, croppedBlob, rawFile, onSaved, onClose]);

  const handleRemove = useCallback(async () => {
    setUploading(true);
    try {
      const { profileImage } = await removeMyProfilePhoto();
      onSaved(profileImage ?? '');
      toast.success('Profile photo removed.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove photo.');
    } finally {
      setUploading(false);
    }
  }, [onSaved, onClose]);

  // Which image to show in the "Original" preview panel
  const originalDisplayUrl = croppedUrl || rawDataUrl || currentUrl;
  const hasPhoto = !!(rawFile || rawDataUrl);

  return (
    <Modal open={open} onClose={onClose} cls="mp76-photo-modal">
      <div class="mp76-modal-head">
        <div class="mp76-modal-title-wrap">
          <div class="mp76-modal-icon"><IcoCamera /></div>
          <div class="mp76-modal-title">
            <strong>Change Profile Photo</strong>
            <span>Upload and enhance your profile picture</span>
          </div>
        </div>
        <button type="button" class="mp76-modal-close" onClick={onClose} aria-label="Close"><IcoX /></button>
      </div>

      <div class="mp76-modal-body">
        <div class="mp76-clean-photo-layout">

          {/* ── Upload + Rules row ── */}
          <div class="mp76-clean-photo-top">
            {/* Left: drop zone */}
            <div class="mp76-clean-photo-panel">
              <div class="mp76-clean-photo-panel-head">
                <div class="mp76-clean-photo-title">
                  <IcoUpload />
                  <div>
                    <strong>Upload Photo</strong>
                    <span>Choose a clear photo — you can crop and enhance it below</span>
                  </div>
                </div>
              </div>
              <div class="mp76-clean-photo-panel-body">
                <div class="mp76-clean-upload-drop" onClick={handlePickFile}>
                  <IcoUpload />
                  <strong>Click to upload</strong>
                  <span>or drag and drop</span>
                  <span class="mp76-clean-browse-btn">Browse Files</span>
                </div>
              </div>
            </div>

            {/* Right: guidelines */}
            <div class="mp76-clean-photo-panel">
              <div class="mp76-clean-photo-panel-head">
                <div class="mp76-clean-photo-title">
                  <IcoInfo />
                  <div>
                    <strong>Photo Guidelines</strong>
                    <span>Best practices for an approved profile photo</span>
                  </div>
                </div>
              </div>
              <div class="mp76-clean-photo-panel-body">
                <div class="mp76-clean-rules-card">
                  <strong><IcoCamera /> Requirements</strong>
                  <ul>
                    <li>JPG or PNG, max 10 MB</li>
                    <li>Clear face, neutral expression</li>
                    <li>Professional attire where possible</li>
                    <li>Good lighting, plain background preferred</li>
                    <li>Will be cropped to a square (1:1)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* ── Preview + compare row (shown once a file is picked) ── */}
          {hasPhoto && (
            <div class="mp76-clean-photo-compare-grid">
              {/* Original / Crop panel */}
              <div class={`mp76-clean-preview-card${selected === 'original' ? ' selected' : ''}`}
                   onClick={() => !cropperActive && setSelected('original')}
                   style={{ cursor: cropperActive ? 'default' : 'pointer' }}>
                <div class="mp76-clean-preview-head">
                  <strong><IcoUser /> Original</strong>
                  {croppedUrl
                    ? <span class="mp76-clean-status-pill ready">Cropped</span>
                    : <span class="mp76-clean-status-pill">Preview</span>}
                </div>

                {/* Hidden img used as source for the canvas cropper */}
                <img
                  ref={cropImgRef}
                  src={rawDataUrl}
                  alt=""
                  style={{ display: 'none', position: 'absolute' }}
                  aria-hidden="true"
                />

                <div class="mp76-clean-photo-stage" style={cropperActive ? { display: 'block', padding: 0 } : undefined}>
                  {cropperActive
                    ? (
                      <canvas
                        ref={cropCanvasRef}
                        style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair' }}
                      />
                    )
                    : originalDisplayUrl
                      ? <img src={originalDisplayUrl} alt="Original preview" />
                      : <div class="mp76-photo-stage-empty"><IcoUser /><span>No image selected</span></div>
                  }
                </div>

                {/* Crop toolbar */}
                <div class="mp76-inline-crop-toolbar" hidden={!rawDataUrl}>
                  <span class="mp76-inline-crop-note">
                    <strong>Crop &amp; Adjust</strong>
                    <span>{cropperActive ? 'Drag the box to reposition. Drag the corner handle to resize. Then apply.' : 'Click Crop to adjust the square framing.'}</span>
                  </span>
                  <div class="mp76-inline-crop-actions">
                    {cropperActive ? (
                      <>
                        <button type="button" class="mp76-crop-btn primary" style={{ gridColumn: 'span 2' }}
                          onClick={() => void handleApplyCrop()} title="Apply crop"><IcoCheck /></button>
                        <button type="button" class="mp76-crop-btn" style={{ gridColumn: 'span 2' }}
                          onClick={handleCancelCrop} title="Cancel crop"><IcoX /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" class="mp76-crop-btn" onClick={initCropper} title="Start crop"><IcoCrop /></button>
                        <button type="button" class="mp76-crop-btn" onClick={handlePickFile} title="Change photo"><IcoUpload /></button>
                        <button type="button" class="mp76-crop-btn" style={{ gridColumn: 'span 2' }}
                          onClick={() => void handleEnhance()} disabled={enhancing}
                          title="Generate AI enhanced version">
                          <IcoSparkles />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* AI Enhanced panel */}
              <div class={`mp76-clean-preview-card${selected === 'enhanced' ? ' selected' : ''}`}
                   onClick={() => enhancedUrl && setSelected('enhanced')}
                   style={{ cursor: enhancedUrl ? 'pointer' : 'default' }}>
                <div class="mp76-clean-preview-head">
                  <strong><IcoSparkles /> AI Enhanced</strong>
                  {enhancedUrl
                    ? <span class="mp76-clean-status-pill ready">Ready</span>
                    : <span class="mp76-clean-status-pill">{enhancing ? 'Processing…' : 'Not generated'}</span>}
                </div>

                <div class="mp76-clean-photo-stage" style={{ position: 'relative' }}>
                  {enhancedUrl
                    ? <img src={enhancedUrl} alt="AI enhanced preview" />
                    : (
                      <div class="mp76-photo-stage-empty">
                        {enhancing
                          ? <><div class="mp76-ai-spinner" /><span>Enhancing…</span></>
                          : <><IcoSparkles /><span>Generate an AI-enhanced version using the button on the left</span></>
                        }
                      </div>
                    )
                  }
                  {enhancing && (
                    <div class="mp76-ai-loading show">
                      <div>
                        <div class="mp76-ai-spinner" />
                        <span>Enhancing…</span>
                      </div>
                    </div>
                  )}
                </div>

                <div class="mp76-enhance-strip">
                  <div class="mp76-enhance-copy">
                    <div class="mp76-enhance-icon"><IcoSparkles /></div>
                    <div>
                      <strong>AI Photo Enhancement</strong>
                      <span>Improves lighting, background, and clarity using the SIOMAC photo model — your identity is preserved.</span>
                    </div>
                  </div>
                  <div class="mp76-enhance-tags">
                    <em>Professional background</em>
                    <em>Lighting correction</em>
                    <em>Identity preserved</em>
                  </div>
                  <div class="mp76-generate-row">
                    <button
                      type="button"
                      class="mp76-modal-btn primary"
                      style={{ flex: 1 }}
                      onClick={() => void handleEnhance()}
                      disabled={enhancing || !hasPhoto}
                    >
                      {enhancing ? <><Spin /> Enhancing…</> : <><IcoSparkles /> Generate AI Preview</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error from enhance */}
          <div class={`mp76-photo-error${enhanceError ? ' show' : ''}`}>
            {enhanceError}
          </div>

          {/* Review note */}
          {hasPhoto && (
            <div class="mp76-review-note">
              <IcoInfo />
              <span>
                Click the panel you want to use, then click <strong>Use Selected Photo</strong>.
                {selected === 'original' ? ' Currently using the original/cropped version.' : ' Currently using the AI-enhanced version.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div class="mp76-modal-footer" style={{ flexWrap: 'wrap', gap: '10px' }}>
        {currentUrl && (
          <button
            type="button"
            class="mp76-modal-btn"
            style={{ marginRight: 'auto', color: '#b42318', borderColor: '#fecaca' }}
            ref={removeBtnRef}
            onClick={() => void handleRemove()}
            disabled={uploading}
          >
            <IcoTrash /> Remove Photo
          </button>
        )}
        <button type="button" class="mp76-modal-btn" onClick={onClose} disabled={uploading}>Cancel</button>
        <button
          type="button"
          class="mp76-modal-btn primary"
          onClick={() => void handleUse()}
          disabled={uploading || !hasPhoto}
        >
          {uploading ? <><Spin /> Uploading…</> : 'Use Selected Photo'}
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={e => void handleFileChange(e)}
      />
    </Modal>
  );
}

// ── Activity icon map ─────────────────────────────────────────────────────────
function ActivityIcon({ icon }: { icon: string }): VNode {
  const approved = icon === 'fa-check-circle';
  return (
    <div class={`compact-activity-icon${approved ? ' approved' : ''}`}>
      {approved ? <IcoCheck /> : icon.includes('sign-out') ? <IcoLogOut /> : icon.includes('calendar') ? <IcoClock /> : <IcoHistory />}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function MyProfileSection(): VNode {
  const session        = useSessionStore();
  const setProfileImg  = useSessionStore(s => s.setProfileImage);

  const username  = session.username  ?? '';
  const fullName  = session.fullName  ?? '';
  const role      = session.role      ?? '';
  const storedImg = session.profileImage ?? '';

  // ── Profile data ──
  const [profile, setProfile] = useState<ProfileData>({
    fullName, username, email: '', phone: '',
    department: '', position: '', employeeNumber: '',
    profileImage: storedImg, role,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);

  // ── Activity data ──
  const [activity, setActivity]         = useState<ActivityEvent[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  // ── Inline editable form state (account card) ──
  const [formName, setFormName]   = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  // ── Access panel toggle ──
  const [accessOpen, setAccessOpen] = useState(true);

  // ── Modals ──
  const [photoModalOpen, setPhotoModalOpen]     = useState(false);
  const [pwdModalOpen, setPwdModalOpen]         = useState(false);
  const [logoutModalOpen, setLogoutModalOpen]   = useState(false);

  // ── Load profile ──
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingProfile(true);

    fetchMyProfile(username, ctrl.signal)
      .then(u => {
        if (cancelled) return;
        const p: ProfileData = {
          fullName: u.fullName || fullName, username,
          email: u.email || '', phone: u.phone || '',
          department: u.department || '', position: u.position || '',
          employeeNumber: u.employeeNumber || '',
          profileImage: u.profileImage || storedImg, role,
        };
        setProfile(p);
        setFormName(p.fullName);
        setFormEmail(p.email);
        setFormPhone(p.phone);
        if (u.profileImage && u.profileImage !== storedImg) setProfileImg(u.profileImage);
      })
      .catch(() => {
        if (!cancelled) {
          setFormName(fullName); setFormEmail(''); setFormPhone('');
        }
      })
      .finally(() => { if (!cancelled) setLoadingProfile(false); });

    return () => { cancelled = true; ctrl.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // ── Load activity ──
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingActivity(true);
    fetchMyActivity(ctrl.signal)
      .then(evts => { if (!cancelled) setActivity(evts); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingActivity(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  // ── Save account info ──
  const handleSaveInfo = useCallback(async () => {
    if (!formName.trim()) { toast.error('Full name is required.'); return; }
    if (!formEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) {
      toast.error('A valid email address is required.'); return;
    }
    setSavingInfo(true);
    try {
      const result = await updateMyProfile({
        username, fullName: formName.trim(), email: formEmail.trim(), phone: formPhone,
        profileImageBase64: '', removeProfileImage: false, oldPassword: '', newPassword: '',
      });
      setProfile(p => ({ ...p, fullName: result.fullName, email: formEmail.trim(), phone: formPhone }));
      toast.success('Account information updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSavingInfo(false);
    }
  }, [username, formName, formEmail, formPhone]);

  // ── After photo saved from modal ──
  const handlePhotoSaved = useCallback((newUrl: string) => {
    setProfile(p => ({ ...p, profileImage: newUrl }));
    setProfileImg(newUrl);
  }, [setProfileImg]);

  // ── Derived ──
  const avatarInitials = initials(profile.fullName, username);
  const photoUrl       = profile.profileImage || storedImg;
  const displayName    = profile.fullName || fullName || username;

  return (
    <div class="mp76">
      <PageHeader icon="fa-user" title="My Profile" sub="Manage your personal information and account security." />

      <div class="mp76-grid-top">

        {/* ═══════════════════ LEFT COLUMN ═══════════════════ */}
        <div class="mp76-profile-column">

          {/* ── Dark profile card ── */}
          <div class="card profile-card">

            {/* Card header strip */}
            <div class="profile-card-top">
              <span class="profile-card-title">
                <IcoUser />
                Employee Profile
              </span>
            </div>

            <div class="profile-card-main">

              {/* Entity: photo + identity */}
              <div class="profile-entity">
                <div
                  class="profile-photo"
                  onClick={() => setPhotoModalOpen(true)}
                  title="Change profile photo"
                  style={photoUrl ? { background: '#1b2d54' } : undefined}
                >
                  {photoUrl
                    ? <img src={photoUrl} alt={displayName} />
                    : avatarInitials}
                </div>

                <div class="profile-identity">
                  <div class="profile-name-line">
                    {loadingProfile
                      ? <div class="mp76-skel" style={{ width: '140px', height: '22px' }} />
                      : <h2>{displayName}</h2>}
                    <span class="profile-status-badge">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>
                      Active
                    </span>
                  </div>

                  {loadingProfile ? (
                    <div class="mp76-skel" style={{ width: '100px', height: '16px' }} />
                  ) : (
                    <div class="profile-ref">{capRole(role)}</div>
                  )}

                  {loadingProfile ? null : (
                    <div class="profile-meta">
                      {profile.department && (
                        <span>
                          <IcoBuilding />
                          {profile.department}
                        </span>
                      )}
                      {profile.position && profile.department && <span class="profile-sep">·</span>}
                      {profile.position && (
                        <span>
                          <IcoBriefcase />
                          {profile.position}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Stats grid — real fields only */}
              {!loadingProfile && (
                <div class="profile-stats profile-facts">
                  {profile.department && (
                    <div class="profile-stat">
                      <small>
                        <IcoBuilding />
                        Department
                      </small>
                      <div class="profile-stat-line"><strong>{profile.department}</strong></div>
                    </div>
                  )}
                  {profile.employeeNumber && (
                    <div class="profile-stat">
                      <small>
                        <IcoId />
                        Employee ID
                      </small>
                      <div class="profile-stat-line"><strong>{profile.employeeNumber}</strong></div>
                    </div>
                  )}
                  {profile.position && (
                    <div class="profile-stat">
                      <small>
                        <IcoBriefcase />
                        Position
                      </small>
                      <div class="profile-stat-line"><strong>{profile.position}</strong></div>
                    </div>
                  )}
                  {profile.email && (
                    <div class="profile-stat">
                      <small>
                        <IcoMail />
                        Email
                      </small>
                      <div class="profile-stat-line"><strong style={{ wordBreak: 'break-all' }}>{profile.email}</strong></div>
                    </div>
                  )}
                </div>
              )}

              {/* Access profile panel (collapsible) — shows role + username only since we have no permissions list */}
              <div class={`profile-panel profile-access-panel pad${accessOpen ? '' : ' is-collapsed'}`}>
                <button
                  type="button"
                  class="profile-panel-toggle"
                  onClick={() => setAccessOpen(v => !v)}
                  aria-expanded={accessOpen}
                >
                  <div class="profile-panel-head">
                    <span class="profile-panel-title">
                      <IcoShield />
                      Access Profile
                    </span>
                    <span class="profile-access-chevron"><IcoChevron /></span>
                  </div>
                </button>

                <div class="profile-access-collapse">
                  <ul class="profile-access-list redesigned-access-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    <li class="profile-access-item">
                      <span class="access-icon">
                        <IcoUser />
                      </span>
                      <span class="access-copy">
                        <strong>Role</strong>
                        <span>{capRole(role)}</span>
                      </span>
                      <span class="access-status enabled">Active</span>
                    </li>
                    <li class="profile-access-item">
                      <span class="access-icon">
                        <IcoId />
                      </span>
                      <span class="access-copy">
                        <strong>Username</strong>
                        <span>{username || '—'}</span>
                      </span>
                      <span class="access-status enabled">Verified</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Photo action */}
              <div class="profile-actions single-action">
                <button
                  type="button"
                  class="profile-action"
                  onClick={() => setPhotoModalOpen(true)}
                >
                  <IcoCamera />
                  Change Profile Photo
                </button>
              </div>

            </div>{/* /profile-card-main */}
          </div>{/* /profile-card */}

          {/* ── Recent Activity (white card) ── */}
          <div class="card compact-profile-activity">
            <div class="compact-activity-head">
              <span class="compact-activity-title">
                <IcoHistory />
                Recent Activity
              </span>
              {!loadingActivity && (
                <span class="compact-activity-count">{activity.length} events</span>
              )}
            </div>

            {loadingActivity ? (
              <div style={{ display: 'grid', gap: '10px' }}>
                {[1, 2, 3].map(i => (
                  <div key={i} class="mp76-skel-light" style={{ height: '56px', borderRadius: '12px' }} />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.82rem', padding: '12px 0', textAlign: 'center' }}>
                No recent activity recorded.
              </div>
            ) : (
              <div class="compact-activity-table">
                {activity.map((ev, i) => (
                  <div key={i} class="compact-activity-row">
                    <ActivityIcon icon={ev.icon} />
                    <div class="compact-activity-content">
                      <div class="compact-activity-copy">
                        <strong>{ev.title}</strong>
                        <span>{ev.date}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>{/* /profile-column */}

        {/* ═══════════════════ RIGHT COLUMN ═══════════════════ */}
        <div class="card account-security-card">
          <div class="card-body">

            {/* ── Account information ── */}
            <div class="card-header card-header-start">
              <span class="card-title">
                <IcoUser />
                Account Information
              </span>
              <p class="card-desc">Update your personal details. Department, position and username are managed by HR.</p>
            </div>

            <div class="field-grid">
              {/* Editable: Full Name */}
              <div class="field">
                <label for="mp76-fullname">Full Name</label>
                <div class="input-icon">
                  <IcoUser />
                  <input
                    id="mp76-fullname"
                    type="text"
                    class="mp76-editable"
                    value={formName}
                    placeholder="Your full name"
                    onInput={e => setFormName((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>

              {/* Readonly: Employee ID */}
              <div class="field">
                <label for="mp76-empid">Employee ID</label>
                <div class="input-icon">
                  <IcoId />
                  <input
                    id="mp76-empid"
                    type="text"
                    value={profile.employeeNumber || (loadingProfile ? '…' : '—')}
                    readonly
                    tabIndex={-1}
                  />
                </div>
              </div>

              {/* Editable: Email */}
              <div class="field">
                <label for="mp76-email">Email Address</label>
                <div class="input-icon">
                  <IcoMail />
                  <input
                    id="mp76-email"
                    type="email"
                    class="mp76-editable"
                    value={formEmail}
                    placeholder="your@email.com"
                    onInput={e => setFormEmail((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>

              {/* Editable: Phone */}
              <div class="field">
                <label for="mp76-phone">Phone Number</label>
                <div class="input-icon">
                  <IcoPhone />
                  <input
                    id="mp76-phone"
                    type="tel"
                    class="mp76-editable"
                    value={formPhone}
                    placeholder="(868) xxx-xxxx"
                    onInput={e => setFormPhone((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>

              {/* Readonly: Department */}
              <div class="field">
                <label for="mp76-dept">Department</label>
                <div class="input-icon">
                  <IcoBuilding />
                  <input
                    id="mp76-dept"
                    type="text"
                    value={profile.department || (loadingProfile ? '…' : '—')}
                    readonly
                    tabIndex={-1}
                  />
                </div>
              </div>

              {/* Readonly: Position */}
              <div class="field">
                <label for="mp76-pos">Position</label>
                <div class="input-icon">
                  <IcoBriefcase />
                  <input
                    id="mp76-pos"
                    type="text"
                    value={profile.position || (loadingProfile ? '…' : '—')}
                    readonly
                    tabIndex={-1}
                  />
                </div>
              </div>

              {/* Readonly: Username */}
              <div class="field">
                <label for="mp76-uname">Username</label>
                <div class="input-icon">
                  <IcoUser />
                  <input
                    id="mp76-uname"
                    type="text"
                    value={username || '—'}
                    readonly
                    tabIndex={-1}
                  />
                </div>
              </div>

              {/* Readonly: Role */}
              <div class="field">
                <label for="mp76-role">Role</label>
                <div class="input-icon">
                  <IcoShield />
                  <input
                    id="mp76-role"
                    type="text"
                    value={capRole(role)}
                    readonly
                    tabIndex={-1}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                class="btn-sm"
                onClick={() => void handleSaveInfo()}
                disabled={savingInfo}
              >
                {savingInfo ? <><Spin /> Saving…</> : 'Save Changes'}
              </button>
            </div>

            {/* ── Divider ── */}
            <div class="account-security-divider" />

            {/* ── Security & Session block ── */}
            <div class="account-security-block">
              <div class="account-section-title">
                <span><IcoShield /> Security &amp; Session</span>
              </div>

              {/* Change password row */}
              <div class="security-row">
                <div>
                  <div class="font-medium text-sm">Password</div>
                  <div class="text-muted text-sm" style={{ marginTop: '2px' }}>Change the password for your account</div>
                </div>
                <button
                  type="button"
                  class="btn-sm"
                  onClick={() => setPwdModalOpen(true)}
                >
                  <IcoKey />
                  Change Password
                </button>
              </div>

              {/* Two-factor auth row — deferred, shown as informational */}
              <div class="security-row" style={{ opacity: 0.72 }}>
                <div>
                  <div class="font-medium text-sm">Two-Factor Authentication</div>
                  <div class="text-muted text-sm" style={{ marginTop: '2px' }}>
                    Manage 2FA via the Security settings page
                  </div>
                </div>
                <span class="mp76-clean-status-pill">In Security Settings</span>
              </div>

              {/* Sign out row */}
              <div class="logout-box">
                <div class="flex items-center gap-3">
                  <IcoClock />
                  <div>
                    <div class="font-medium text-sm">Sign Out</div>
                    <div class="text-muted text-sm" style={{ marginTop: '2px' }}>End your current session on this device</div>
                  </div>
                </div>
                <button
                  type="button"
                  class="logout-btn"
                  onClick={() => setLogoutModalOpen(true)}
                >
                  <IcoLogOut />
                  Sign Out
                </button>
              </div>
            </div>

            {/* ── Notifications block — informational only (no backend yet) ── */}
            <div class="account-notifications-block">
              <div class="account-section-title account-notification-title">
                <span><IcoBell /> Notifications</span>
              </div>
              <p class="account-notification-note">
                Notification preferences are managed system-wide. The settings below reflect your current configuration.
              </p>
              <div class="account-notification-list">
                <div class="account-notification-row">
                  <div>
                    <strong>System Alerts</strong>
                    <span>Important ERP system notifications and updates</span>
                  </div>
                  <div class="switch on" aria-label="System alerts enabled" title="Managed system-wide">
                    <span class="thumb" />
                  </div>
                </div>
                <div class="account-notification-row">
                  <div>
                    <strong>Leave &amp; Attendance</strong>
                    <span>Reminders for leave approvals, attendance and shifts</span>
                  </div>
                  <div class="switch on" aria-label="Leave notifications enabled" title="Managed system-wide">
                    <span class="thumb" />
                  </div>
                </div>
                <div class="account-notification-row">
                  <div>
                    <strong>Workflow Updates</strong>
                    <span>Approvals, rejections and task assignments</span>
                  </div>
                  <div class="switch on" aria-label="Workflow notifications enabled" title="Managed system-wide">
                    <span class="thumb" />
                  </div>
                </div>
              </div>
              <div class="account-simple-note">
                <strong>Note</strong>
                <span>Per-category notification preferences can be configured in Settings → Notifications.</span>
              </div>
            </div>

          </div>{/* /card-body */}
        </div>{/* /account-security-card */}

      </div>{/* /grid-top */}

      {/* ── Modals ── */}
      <ChangePhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        currentUrl={photoUrl}
        onSaved={handlePhotoSaved}
      />
      <ChangePasswordModal
        open={pwdModalOpen}
        onClose={() => setPwdModalOpen(false)}
        username={username}
        fullName={profile.fullName}
      />
      <LogoutModal
        open={logoutModalOpen}
        onClose={() => setLogoutModalOpen(false)}
      />
    </div>
  );
}
