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
import { resolvePermission } from '@lib/permissions';
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
import { useTotpStatus } from '@api/security';
import { TotpSetupModal, TotpDisableModal } from '@/components/sections/Settings/SettingsSection';
import './profilePage.css';

// ── Tiny helpers ──────────────────────────────────────────────────────────────

/** The "(868) " area code is permanent — the user only edits the 7 local digits.
 *  Strips any leading 868/1868 from pasted/loaded numbers, then formats the
 *  remainder as (868) xxx-xxxx while typing; caps at 7 local digits. */
function formatPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('1868')) digits = digits.slice(4);
  else if (digits.startsWith('868')) digits = digits.slice(3);
  digits = digits.slice(0, 7);
  if (digits.length === 0) return '(868) ';
  if (digits.length <= 3) return `(868) ${digits}`;
  return `(868) ${digits.slice(0, 3)}-${digits.slice(3)}`;
}

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

/* True Feather-style outline icons — built from open paths/lines/polylines, so
   they MUST be stroked (fill="none"), never filled. Forcing `fill` on these in
   CSS renders them invisible (lines have zero fill area) or as wrong blobs. */
const IcoUser = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
const IcoShield = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IcoBell = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
);
const IcoLogOut = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
);
const IcoMail = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
);
const IcoPhone = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l.91-1.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
);
const IcoMapPin = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);
const IcoBriefcase = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
);
const IcoBuilding = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);

/* ── Solid (filled) icons ported verbatim from the v76 reference mockup.
   Used inside the navy profile card (class `profile-solid-icon`) + access rows. ── */
const SolActiveCheck = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.15 13.15-3.5-3.5 1.4-1.4 2.1 2.1 4.4-4.4 1.4 1.4-5.8 5.8Z"/></svg>
);
const SolBriefcase = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v1h3.25A2.75 2.75 0 0 1 21 7.75V10H3V7.75A2.75 2.75 0 0 1 5.75 5H9V4Zm2 1h2V4a1 1 0 1 0-2 0v1Zm10 7v5.25A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25V12h7v1a1 1 0 1 0 2 0v-1h9Z"/></svg>
);
const SolBuilding = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 21V5.75A2.75 2.75 0 0 1 7.75 3h8.5A2.75 2.75 0 0 1 19 5.75V21h2v1H3v-1h2Zm4-13h2V6H9v2Zm4 0h2V6h-2v2Zm-4 4h2v-2H9v2Zm4 0h2v-2h-2v2Zm-4 4h2v-2H9v2Zm4 0h2v-2h-2v2Z"/></svg>
);
const SolPin = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.75A2.75 2.75 0 1 1 12 6.25a2.75 2.75 0 0 1 0 5.5Z"/></svg>
);
const SolIdCard = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5.75 4h12.5A2.75 2.75 0 0 1 21 6.75v10.5A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25V6.75A2.75 2.75 0 0 1 5.75 4Zm1.75 4.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Zm9-.5a1 1 0 1 0 0 2h1.25a1 1 0 1 0 0-2H16.5Zm0 4a1 1 0 1 0 0 2h1.25a1 1 0 1 0 0-2H16.5ZM7 16.5h6a3 3 0 0 0-6 0Z"/></svg>
);
const SolUserCheck = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0v1H5v-1Zm13.5-8.5 1.1 1.1 2.15-2.15 1.05 1.05-3.2 3.2-2.15-2.15 1.05-1.05Z"/></svg>
);
const SolUser = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"/></svg>
);
const SolMail = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/></svg>
);
const SolPhone = () => (
  <svg class="profile-solid-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2Z"/></svg>
);
const SolShieldLock = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 1 3 3v1h2.25A2.75 2.75 0 0 1 20 9.75v7.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25v-7.5A2.75 2.75 0 0 1 6.75 7H9V6a3 3 0 0 1 3-3Zm-1 4h2V6a1 1 0 1 0-2 0v1Z"/></svg>
);
const SolChevron = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z"/></svg>
);
const SolGrid = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/></svg>
);
const SolShieldCheck = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 4 5.5v6.25C4 16.7 7.38 21.33 12 22c4.62-.67 8-5.3 8-10.25V5.5L12 2Zm-1 14-3.5-3.5 1.4-1.4 2.1 2.1 4.4-4.4 1.4 1.4L11 16Z"/></svg>
);
const SolClipboard = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 2h6a2 2 0 0 1 2 2h2a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2-2Zm0 2v2h6V4H9Zm-2 7h7V9H7v2Zm0 4h5v-2H7v2Zm9.2 4.2 4.6-4.6-1.4-1.4-3.2 3.2-1.4-1.4-1.4 1.4 2.8 2.8Z"/></svg>
);
const SolCheck = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6L21 7.9 19.6 6.5 9.5 16.6Z"/></svg>
);
/* Change-Photo dialog icons — ported VERBATIM from the v76 reference. All are
   solid (filled); the shared dialog containers stroke icons, so force fill via
   an inline !important style (inline !important beats the container rules). */
const DLG_ICO = 'fill:currentColor !important;stroke:none !important';
const DlgIco = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" style={DLG_ICO}><path d={d} style={DLG_ICO} /></svg>
);
// exact reference paths
const IC_CAMERA   = 'M9.5 4 8.25 6H5.75A2.75 2.75 0 0 0 3 8.75v8.5A2.75 2.75 0 0 0 5.75 20h12.5A2.75 2.75 0 0 0 21 17.25v-8.5A2.75 2.75 0 0 0 18.25 6h-2.5L14.5 4h-5ZM12 17a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z';
const IC_CLOSE    = 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z';
const IC_UPLOAD   = 'M12 3 7 8h3v5h4V8h3l-5-5ZM5 14h2v4h10v-4h2v4.25A1.75 1.75 0 0 1 17.25 20H6.75A1.75 1.75 0 0 1 5 18.25V14Z';
const IC_IMAGE    = 'M4 6.75A2.75 2.75 0 0 1 6.75 4h10.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25V6.75ZM8.5 9.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm9.5 7.25-4.2-4.2a1 1 0 0 0-1.42 0L10.75 14.2l-.65-.65a1 1 0 0 0-1.42 0L6 16.25v1h12v-.5Z';
const IC_BROWSE   = 'M5 20h14a2 2 0 0 0 2-2v-5h-2v5H5v-5H3v5a2 2 0 0 0 2 2Zm8-16h-2v8.17L8.41 9.59 7 11l5 5 5-5-1.41-1.41L13 12.17V4Z';
const IC_SHIELD   = 'M12 2 4 5.5V11c0 5.2 3.4 9.8 8 11 4.6-1.2 8-5.8 8-11V5.5L12 2Zm3.7 7.7-4.6 4.6-2.3-2.3 1.4-1.4.9.9 3.2-3.2 1.4 1.4Z';
const IC_WINDOW   = 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm2 0v14h12V5H6Zm2 2h8v2H8V7Zm0 4h8v2H8v-2Zm0 4h5v2H8v-2Z';
const IC_USER     = 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-9 9a9 9 0 0 1 18 0v1H3v-1Z';
const IC_SPARK_AI = 'M12 2 9.7 8.2 4 10.5l5.7 2.3L12 19l2.3-6.2 5.7-2.3-5.7-2.3L12 2Z';
const IC_SPARK_E  = 'M12 2 9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5L12 2Z';
const IC_SPARK_S  = 'M12 2 14.15 7.85 20 10l-5.85 2.15L12 18l-2.15-5.85L4 10l5.85-2.15L12 2Zm6 13 1.1 3 2.9 1-2.9 1-1.1 3-1.1-3-2.9-1 2.9-1 1.1-3Z';
const IC_ZOUT     = 'M5 11h14v2H5v-2Z';
const IC_ZIN      = 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z';
const IC_RESET    = 'M12 5a7 7 0 1 1-6.32 4H3l3.6-3.6L10.2 9H7.85A5 5 0 1 0 12 7V5Z';
const IC_CHECK    = 'M9.55 15.15 5.8 11.4l-1.4 1.4 5.15 5.15L20.1 7.4 18.7 6 9.55 15.15Z';
const IC_INFO     = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z';
const SolX = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>
);
const IcoId = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="16" y2="10"/><line x1="12" y1="14" x2="16" y2="14"/><circle cx="8" cy="10" r="1"/><circle cx="8" cy="14" r="1"/></svg>
);
const IcoKey = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
);
const IcoLock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const IcoCamera = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
);
const IcoCheck = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IcoX = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IcoHistory = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 3v5h5"/></svg>
);
const IcoClock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
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
      await updateMyPassword({ oldPassword: oldPwd, newPassword: newPwd });
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
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  getCropBlob: () => Promise<Blob>;
  hideGuides: () => void;
}

/**
 * Zoom + pan square cropper (Cropper.js-style, matches the v76 reference):
 * the image "covers" a square viewport; drag to pan, Zoom In/Out to scale,
 * Reset to re-fit. The visible square viewport IS the 1:1 crop.
 */
function initCanvasCropper(img: HTMLImageElement, canvas: HTMLCanvasElement): CanvasCropper {
  const ctx = canvas.getContext('2d')!;
  const CW = canvas.width;
  const CH = canvas.height;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const minScale = Math.max(CW / iw, CH / ih);   // cover-fit (image always fills the square)
  const maxScale = minScale * 6;
  let scale = minScale;
  let offX  = (CW - iw * scale) / 2;
  let offY  = (CH - ih * scale) / 2;
  let showGuides = true;

  function clampOffsets() {
    const w = iw * scale, h = ih * scale;
    offX = w <= CW ? (CW - w) / 2 : clamp(offX, CW - w, 0);
    offY = h <= CH ? (CH - h) / 2 : clamp(offY, CH - h, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(img, offX, offY, iw * scale, ih * scale);

    // Circular crop guide overlay (darkened mask + rule-of-thirds grid + ring)
    // — a framing aid for positioning, hidden once the crop is applied so the
    // final result reads clean.
    if (!showGuides) return;

    const cx = CW / 2, cy = CH / 2, r = Math.min(CW, CH) / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.18)';
    ctx.beginPath();
    ctx.rect(0, 0, CW, CH);
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    // Rule-of-thirds guide lines, clipped to the circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo((CW / 3) * i, 0); ctx.lineTo((CW / 3) * i, CH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (CH / 3) * i); ctx.lineTo(CW, (CH / 3) * i); ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.98)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function zoomBy(delta: number) {
    showGuides = true;
    const prev = scale;
    scale = clamp(scale * (1 + delta), minScale, maxScale);
    // zoom toward the centre of the viewport
    const cx = CW / 2, cy = CH / 2;
    offX = cx - (cx - offX) * (scale / prev);
    offY = cy - (cy - offY) * (scale / prev);
    clampOffsets(); draw();
  }

  let dragging = false, sx = 0, sy = 0, ox0 = 0, oy0 = 0;
  function pt(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (CW / r.width), y: (e.clientY - r.top) * (CH / r.height) };
  }
  function onDown(e: MouseEvent) { const p = pt(e); dragging = true; sx = p.x; sy = p.y; ox0 = offX; oy0 = offY; }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    showGuides = true;
    const p = pt(e);
    offX = ox0 + (p.x - sx); offY = oy0 + (p.y - sy);
    clampOffsets(); draw();
  }
  function onUp() { dragging = false; }
  function onWheel(e: WheelEvent) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.08 : -0.08); }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  draw();

  return {
    destroy() {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    },
    zoomIn()  { zoomBy(0.1); },
    zoomOut() { zoomBy(-0.1); },
    reset()   { showGuides = true; scale = minScale; offX = (CW - iw * scale) / 2; offY = (CH - ih * scale) / 2; draw(); },
    hideGuides() { showGuides = false; draw(); },
    getCropBlob(): Promise<Blob> {
      // The visible square viewport maps back to image space.
      const srcX = -offX / scale;
      const srcY = -offY / scale;
      const srcW = CW / scale;
      const srcH = CH / scale;
      const out = document.createElement('canvas');
      out.width = 512; out.height = 512;
      const oc = out.getContext('2d')!;
      oc.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 512, 512);
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

  const [rawFile, setRawFile]             = useState<File | null>(null);
  const [rawDataUrl, setRawDataUrl]       = useState('');           // preview of original
  const [croppedBlob, setCroppedBlob]     = useState<Blob | null>(null);
  const [croppedUrl, setCroppedUrl]       = useState('');           // object url for cropped
  const [cropperActive, setCropperActive] = useState(false);

  const [enhancedB64, setEnhancedB64]     = useState('');           // base64 of AI output
  const [enhancedUrl, setEnhancedUrl]     = useState('');           // data url for enhanced
  const [enhancing, setEnhancing]         = useState(false);
  const [enhanceError, setEnhanceError]   = useState('');
  const [revisionCount, setRevisionCount] = useState(0);            // AI revisions generated this session (max 3)

  const [selected, setSelected]           = useState<PhotoSelection>('original');
  const [uploading, setUploading]         = useState(false);

  // Reviewers (superadmin/admin/hr_manager, or anyone granted the key) self-approve:
  // their photo change applies to the live avatar immediately, no pending review.
  // Same resolution the backend commit route uses (userCan → hr.employees.photo_approve).
  const role                = useSessionStore(s => s.role);
  const rolePermissions     = useSessionStore(s => s.rolePermissions);
  const permissionOverrides = useSessionStore(s => s.permissionOverrides);
  const canSelfApprove = role
    ? resolvePermission('hr.employees.photo_approve', { role, rolePermissions, overrides: permissionOverrides })
    : false;

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
      setRevisionCount(0);
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
    // Validate size (8 MB UI limit — matches the "under 8 MB" copy; the image
    // is resized to webp before upload, so this only guards the source read).
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image exceeds 8 MB. Please choose a smaller image.');
      return;
    }

    // Destroy previous cropper
    if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }
    setCropperActive(false);
    if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
    setCroppedBlob(null); setCroppedUrl('');
    setEnhancedB64(''); setEnhancedUrl(''); setEnhanceError('');
    setSelected('original');
    setRevisionCount(0);
    setRawFile(file);

    // Read as data URL for the preview / cropper
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    setRawDataUrl(url);
    setCropperActive(true);   // auto-open the zoom/pan cropper on upload
    // Reset file input so the same file can be re-selected
    (e.target as HTMLInputElement).value = '';
  }, [croppedUrl]);

  // ── Canvas cropper (zoom/pan) ──
  const mountCropper = useCallback(() => {
    const img    = cropImgRef.current;
    const canvas = cropCanvasRef.current;
    if (!img || !canvas || !rawDataUrl || cropperRef.current) return;
    const runInit = () => {
      if (!cropCanvasRef.current || cropperRef.current) return;
      canvas.width = 380; canvas.height = 380;
      cropperRef.current = initCanvasCropper(img, canvas);
    };
    if (img.complete && img.naturalWidth > 0) runInit();
    else img.onload = runInit;
  }, [rawDataUrl]);

  // Auto-open the cropper whenever the canvas mounts for a loaded photo.
  useEffect(() => {
    if (cropperActive && rawDataUrl) mountCropper();
  }, [cropperActive, rawDataUrl, mountCropper]);

  const handleZoomIn    = useCallback(() => cropperRef.current?.zoomIn(), []);
  const handleZoomOut   = useCallback(() => cropperRef.current?.zoomOut(), []);
  const handleResetCrop = useCallback(() => cropperRef.current?.reset(), []);

  const handleApplyCrop = useCallback(async () => {
    if (!cropperRef.current) return;
    try {
      const blob = await cropperRef.current.getCropBlob();
      if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
      setCroppedBlob(blob);
      setCroppedUrl(URL.createObjectURL(blob));
      setSelected('original');
      // Keep the cropper live for further adjustment (matches the reference Cropper.js UX),
      // but drop the rule-of-thirds guide lines now that the crop is final.
      cropperRef.current.hideGuides();
      toast.success('Crop applied.');
    } catch {
      toast.error('Crop failed. Try again.');
    }
  }, [croppedUrl]);

  // ── AI enhance (up to 3 revisions per upload) ──
  const handleEnhance = useCallback(async () => {
    if (revisionCount >= 3) { toast.error('Maximum of 3 AI revisions reached — upload a new photo to try again.'); return; }
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
      setRevisionCount(n => Math.min(3, n + 1));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Photo enhancement failed.';
      setEnhanceError(msg);
    } finally {
      setEnhancing(false);
    }
  }, [croppedBlob, rawFile, enhancedUrl, revisionCount]);

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
      const result = await uploadMyProfilePhoto(fileToUpload);
      if (result.pending) {
        // Review gate — the live avatar does NOT change until a reviewer approves
        // it in Employee Master, so don't optimistically swap the displayed photo.
        toast.success('Photo submitted for review. It will update your profile once approved.');
      } else {
        // Reviewer self-approve — applied to the live avatar now; reflect it.
        onSaved(result.profileImage);
        toast.success('Profile photo updated.');
      }
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
  const hasPhoto = !!(rawFile || rawDataUrl);
  // Showing the account's existing photo (pre-loaded), no new upload yet
  const showingCurrentPhoto = !hasPhoto && !!currentUrl;
  const originalDisplayUrl = rawDataUrl || currentUrl;

  // Top-right overlay X on the Original image: clears an in-progress upload
  // (back to the current photo) or, if none, deletes the account's photo.
  const handleRemoveOverlay = useCallback(async () => {
    if (hasPhoto) {
      if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null; }
      setCropperActive(false);
      if (croppedUrl.startsWith('blob:')) URL.revokeObjectURL(croppedUrl);
      setCroppedBlob(null); setCroppedUrl('');
      if (enhancedUrl.startsWith('blob:')) URL.revokeObjectURL(enhancedUrl);
      setEnhancedB64(''); setEnhancedUrl(''); setEnhanceError('');
      setSelected('original'); setRevisionCount(0);
      setRawFile(null); setRawDataUrl('');
      return;
    }
    await handleRemove();
  }, [hasPhoto, croppedUrl, enhancedUrl, handleRemove]);

  return (
    <Modal open={open} onClose={onClose} cls="mp76-photo-modal">
      <div class="mp76-modal-head">
        <div class="mp76-modal-title-wrap">
          <div class="mp76-modal-icon"><DlgIco d={IC_CAMERA} /></div>
          <div class="mp76-modal-title">
            <strong>Change Profile Photo</strong>
            <span>Upload a photo, crop it manually, generate up to three AI revisions, then submit the selected version for HR review.</span>
          </div>
        </div>
        <button type="button" class="mp76-modal-close" onClick={onClose} aria-label="Close"><DlgIco d={IC_CLOSE} /></button>
      </div>

      <div class="mp76-modal-body">
        <div class="mp76-clean-photo-layout">

          {/* ── Upload Photo panel (drop zone + requirements + AI generate) ── */}
          <div class="mp76-clean-photo-top">
            <div class="mp76-clean-photo-panel">
              <div class="mp76-clean-photo-panel-head">
                <div class="mp76-clean-photo-title">
                  <DlgIco d={IC_UPLOAD} />
                  <div>
                    <strong>Upload Photo</strong>
                    <span>Use a clear JPG or PNG under 8 MB.</span>
                  </div>
                </div>
              </div>
              <div class="mp76-clean-photo-panel-body">
                <div class="mp76-clean-upload-drop" onClick={handlePickFile}>
                  <DlgIco d={IC_IMAGE} />
                  <strong>Select Employee Photo</strong>
                  <span>{showingCurrentPhoto ? 'Upload a new photo to replace your current one.' : 'Original preview appears immediately after upload.'}</span>
                  <span class="mp76-clean-browse-btn"><DlgIco d={IC_BROWSE} />Browse Photo</span>
                </div>

                <div class="mp76-clean-rules-card">
                  <strong><DlgIco d={IC_SHIELD} /> Photo Requirements</strong>
                  <ul>
                    <li>Face visible, centered, and well lit</li>
                    <li>No sunglasses or face covering</li>
                    <li>Plain or low-distraction background preferred</li>
                  </ul>
                </div>

                <div class="mp76-generate-row">
                  <button
                    type="button"
                    class="mp76-modal-btn primary"
                    onClick={() => void handleEnhance()}
                    disabled={enhancing || !croppedUrl || revisionCount >= 3}
                  >
                    {enhancing ? <><Spin /> Enhancing…</> : 'Generate AI Preview'}
                  </button>
                  <div class="mp76-revision-line">
                    <span>AI Revisions</span>
                    <div class="mp76-revision-tabs" aria-label="AI photo revisions">
                      {[1, 2, 3].map(n => (
                        <button
                          type="button"
                          class={`mp76-revision-tab${revisionCount >= n ? ' active' : ''}`}
                          disabled
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div class="mp76-review-note">
                  <DlgIco d={IC_INFO} />
                  {canSelfApprove
                    ? <span>Your new profile photo will be <strong>applied immediately</strong>.</span>
                    : <span>Selected photos are submitted as <strong>Pending Review</strong>. HR approval is required before the profile image becomes official.</span>}
                </div>
              </div>
            </div>

            {/* ── Compare Versions panel — always visible, empty states when no photo yet ── */}
            <div class="mp76-clean-photo-panel">
              <div class="mp76-clean-photo-panel-head">
                <div class="mp76-clean-photo-title">
                  <DlgIco d={IC_WINDOW} />
                  <div>
                    <strong>Compare Versions</strong>
                    <span>Choose original or AI enhanced before submitting.</span>
                  </div>
                </div>
              </div>
              <div class="mp76-clean-photo-panel-body">
                <div class="mp76-clean-photo-compare-grid">
                  {/* Original / Crop panel */}
                  <div class={`mp76-clean-preview-card${selected === 'original' ? ' selected' : ''}`}
                       onClick={() => hasPhoto && setSelected('original')}
                       style={{ cursor: hasPhoto ? 'pointer' : 'default' }}>
                    <div class="mp76-clean-preview-head">
                      <strong><DlgIco d={IC_USER} /> Original</strong>
                      {croppedUrl
                        ? <em class="mp76-clean-status-pill ready">Cropped</em>
                        : <em class="mp76-clean-status-pill">{hasPhoto ? 'Preview' : showingCurrentPhoto ? 'Current' : 'Waiting'}</em>}
                    </div>

                    {/* Hidden img = source for the canvas cropper */}
                    <img ref={cropImgRef} src={rawDataUrl} alt="" style={{ display: 'none', position: 'absolute' }} aria-hidden="true" />

                    <div class={`mp76-clean-photo-stage${hasPhoto ? ' has-cropper' : ''}`}>
                      {hasPhoto
                        ? <canvas ref={cropCanvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: 'grab' }} />
                        : showingCurrentPhoto
                          ? <img src={originalDisplayUrl} alt="Current profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <div class="mp76-photo-stage-empty"><DlgIco d={IC_USER} /><span>Upload a photo to preview</span></div>}
                      {(hasPhoto || showingCurrentPhoto) && (
                        <button
                          type="button"
                          class="mp76-photo-remove-overlay"
                          onClick={e => { e.stopPropagation(); void handleRemoveOverlay(); }}
                          disabled={uploading}
                          aria-label={hasPhoto ? 'Clear selected photo' : 'Remove current photo'}
                          title={hasPhoto ? 'Clear selected photo' : 'Remove current photo'}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {hasPhoto && (
                      <div class="mp76-inline-crop-toolbar">
                        <div class="mp76-inline-crop-note">
                          <div class="mp76-inline-crop-copy">
                            <strong>Manual Crop</strong>
                            <span>Adjust the photo in the preview, then apply the crop before generating the AI preview.</span>
                          </div>
                        </div>
                        <div class="mp76-inline-crop-actions">
                          <button type="button" class="mp76-manual-crop-btn" onClick={handleZoomOut} aria-label="Zoom Out" title="Zoom Out"><DlgIco d={IC_ZOUT} /></button>
                          <button type="button" class="mp76-manual-crop-btn" onClick={handleZoomIn} aria-label="Zoom In" title="Zoom In"><DlgIco d={IC_ZIN} /></button>
                          <button type="button" class="mp76-manual-crop-btn" onClick={handleResetCrop} aria-label="Reset Crop" title="Reset Crop"><DlgIco d={IC_RESET} /></button>
                          <button type="button" class="mp76-manual-crop-btn primary" onClick={() => void handleApplyCrop()} aria-label="Apply Crop" title="Apply Crop"><DlgIco d={IC_CHECK} /></button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* AI Enhanced panel */}
                  <div class={`mp76-clean-preview-card${selected === 'enhanced' ? ' selected' : ''}`}
                       onClick={() => enhancedUrl && setSelected('enhanced')}
                       style={{ cursor: enhancedUrl ? 'pointer' : 'default' }}>
                    <div class="mp76-clean-preview-head">
                      <strong><DlgIco d={IC_SPARK_AI} /> AI Enhanced</strong>
                      {enhancedUrl
                        ? <em class="mp76-clean-status-pill ready">Ready</em>
                        : <em class="mp76-clean-status-pill">{enhancing ? 'Processing…' : 'Not Generated'}</em>}
                    </div>

                    <div class="mp76-clean-photo-stage" style={{ position: 'relative' }}>
                      {enhancedUrl
                        ? <img src={enhancedUrl} alt="AI enhanced preview" />
                        : (
                          <div class="mp76-photo-stage-empty">
                            <DlgIco d={IC_SPARK_E} /><span>Generate preview after upload</span>
                          </div>
                        )
                      }
                      {enhancing && (
                        <div class="mp76-ai-loading show">
                          <div>
                            <div class="mp76-ai-spinner" />
                            <span>Enhancing employee photo…</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* AI Enhancement info strip — sits below the compare grid, not tied to any one card */}
                <div class="mp76-enhance-strip">
                  <div class="mp76-enhance-copy">
                    <div class="mp76-enhance-icon"><DlgIco d={IC_SPARK_S} /></div>
                    <div>
                      <strong>AI Enhancement Applied</strong>
                      <span>Standardizes crop, lighting, background, and profile framing while preserving identity.</span>
                    </div>
                  </div>
                  <div class="mp76-enhance-tags">
                    <em>Centered Crop</em>
                    <em>Lighting</em>
                    <em>Clean Background</em>
                  </div>
                </div>

                {/* Error from enhance */}
                <div class={`mp76-photo-error${enhanceError ? ' show' : ''}`}>
                  {enhanceError}
                </div>

                {/* Use Original / Use AI Enhanced — selects which version Submit for Review uploads */}
                <div class="mp76-clean-photo-actions">
                  <button
                    type="button"
                    class={`mp76-modal-btn${selected === 'original' ? ' primary' : ''}`}
                    onClick={() => setSelected('original')}
                    disabled={!hasPhoto}
                  >
                    Use Original
                  </button>
                  <button
                    type="button"
                    class={`mp76-modal-btn${selected === 'enhanced' ? ' primary' : ''}`}
                    onClick={() => setSelected('enhanced')}
                    disabled={!enhancedUrl}
                  >
                    Use AI Enhanced
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div class="mp76-modal-footer" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <button type="button" class="mp76-modal-btn" onClick={onClose} disabled={uploading}>Cancel</button>
        <button
          type="button"
          class="mp76-modal-btn primary"
          onClick={() => void handleUse()}
          disabled={uploading || !hasPhoto}
        >
          {uploading ? <><Spin /> Uploading…</> : (canSelfApprove ? 'Apply Photo' : 'Submit for Review')}
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
  const approved = icon === 'photo' || icon === 'profile' || icon === 'password' || icon === 'security-on';
  const glyph =
    icon === 'photo' || icon === 'photo-removed' ? <IcoCamera /> :
    icon === 'password'                          ? <IcoKey />    :
    icon === 'security-on' || icon === 'security-off' || icon === 'security' ? <IcoShield /> :
    icon === 'profile'                           ? <IcoUser />   :
                                                     <IcoHistory />;
  return (
    <div class={`compact-activity-icon${approved ? ' approved' : ''}`}>
      {glyph}
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
    department: '', site: '', manager: '', position: '', employeeNumber: '',
    profileImage: storedImg, role,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);

  // ── Activity data ──
  const [activity, setActivity]         = useState<ActivityEvent[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  // ── Inline editable form state (account card) ──
  const [formName, setFormName]   = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('(868) ');
  const [savingInfo, setSavingInfo] = useState(false);

  // ── Access panel toggle ──
  const [accessOpen, setAccessOpen] = useState(true);

  // ── Modals ──
  const [photoModalOpen, setPhotoModalOpen]     = useState(false);
  const [pwdModalOpen, setPwdModalOpen]         = useState(false);
  const [logoutModalOpen, setLogoutModalOpen]   = useState(false);
  const [totpSetupOpen, setTotpSetupOpen]       = useState(false);
  const [totpDisableOpen, setTotpDisableOpen]   = useState(false);

  // ── Two-factor authentication — real state from the authenticated 2FA API ──
  const { data: totpStatus, isLoading: totpStatusLoading, refetch: refetchTotpStatus } = useTotpStatus();

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
          department: u.department || '', site: u.site || '', manager: u.manager || '',
          position: u.position || '',
          employeeNumber: u.employeeNumber || '',
          profileImage: u.profileImage || storedImg, role,
        };
        setProfile(p);
        setFormName(p.fullName);
        setFormEmail(p.email);
        setFormPhone(formatPhoneInput(p.phone));
        if (u.profileImage && u.profileImage !== storedImg) setProfileImg(u.profileImage);
      })
      .catch(() => {
        if (!cancelled) {
          setFormName(fullName); setFormEmail(''); setFormPhone('(868) ');
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
    // "(868) " with no local digits means no phone on file — don't save a bare prefix.
    const phoneToSave = formPhone.replace(/\D/g, '').length > 3 ? formPhone : '';
    setSavingInfo(true);
    try {
      const result = await updateMyProfile({
        username, fullName: formName.trim(), email: formEmail.trim(), phone: phoneToSave,
        profileImageBase64: '', removeProfileImage: false,
      });
      setProfile(p => ({ ...p, fullName: result.fullName, email: formEmail.trim(), phone: phoneToSave }));
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
      <PageHeader icon="fa-user" title="My Profile" sub="Manage your personal information and account security." hidePill />

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
                    {/* Superadmin is a platform account, not an HR-tracked employee —
                        an "Active" employee-status badge doesn't apply to it. */}
                    {role !== 'superadmin' && (
                      <span class="profile-status-badge">
                        <SolActiveCheck />
                        Active
                      </span>
                    )}
                  </div>

                  {loadingProfile ? (
                    <div class="mp76-skel" style={{ width: '100px', height: '16px' }} />
                  ) : (
                    <div class="profile-ref">{capRole(role)}</div>
                  )}

                  {loadingProfile ? null : (
                    <div class="profile-meta">
                      {profile.position && (
                        <span>
                          <SolBriefcase />
                          {profile.position}
                        </span>
                      )}
                      {profile.position && profile.department && <span class="profile-sep">·</span>}
                      {profile.department && (
                        <span>
                          <SolBuilding />
                          {profile.department}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Stats grid. Superadmin is a platform account with no HR record, so
                  Job Site/Department/Employee ID/Manager are all meaningless for it —
                  show account-level facts instead. Everyone else gets the stable 2×2
                  (Job Site · Department · Employee ID · Manager), "—" for unset fields
                  so the grid never collapses to a lonely box. */}
              {!loadingProfile && (
                <div class="profile-stats profile-facts">
                  {role === 'superadmin' ? (
                    <>
                      <div class="profile-stat">
                        <small><SolUser />Username</small>
                        <div class="profile-stat-line"><strong>{username || '—'}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolShieldCheck />Role</small>
                        <div class="profile-stat-line"><strong>{capRole(role)}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolMail />Email</small>
                        <div class="profile-stat-line"><strong style={{ wordBreak: 'break-all' }}>{profile.email || '—'}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolPhone />Phone</small>
                        <div class="profile-stat-line"><strong>{profile.phone || '—'}</strong></div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div class="profile-stat">
                        <small><SolPin />Job Site</small>
                        <div class="profile-stat-line"><strong>{profile.site || '—'}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolBuilding />Department</small>
                        <div class="profile-stat-line"><strong>{profile.department || '—'}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolIdCard />Employee ID</small>
                        <div class="profile-stat-line"><strong>{profile.employeeNumber || '—'}</strong></div>
                      </div>
                      <div class="profile-stat">
                        <small><SolUserCheck />Manager</small>
                        <div class="profile-stat-line"><strong>{profile.manager || '—'}</strong></div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Access profile panel (collapsible) — module access derived from the
                  signed-in user's real role (not mocked). */}
              <div class={`profile-panel profile-access-panel pad${accessOpen ? '' : ' is-collapsed'}`}>
                <button
                  type="button"
                  class="profile-panel-toggle"
                  onClick={() => setAccessOpen(v => !v)}
                  aria-expanded={accessOpen}
                >
                  <div class="profile-panel-head">
                    <span class="profile-panel-title">
                      <SolShieldLock />
                      Access Profile
                    </span>
                    <span class="profile-access-chevron" aria-hidden="true"><SolChevron /></span>
                  </div>
                </button>

                <div class="profile-access-collapse">
                  <div class="profile-panel-note">Dashboard and module access assigned to this account.</div>
                  <div class="profile-access-list redesigned-access-list">
                    {(() => {
                      const managerial = ['admin', 'superadmin', 'manager'].includes(role) || role.endsWith("_manager");
                      const isAdmin    = ['admin', 'superadmin'].includes(role);
                      const rows = [
                        { icon: <SolGrid />,        title: 'Employee Dashboard', desc: 'Self-service profile, security, and documents', on: true },
                        { icon: <SolClipboard />,   title: 'Manager Approvals',  desc: 'Team approvals and workflow sign-off',        on: managerial },
                        { icon: <SolShieldCheck />, title: 'Administration',     desc: 'System settings, users, roles, and security', on: isAdmin },
                      ];
                      return rows.map(r => (
                        <div class={`profile-access-item ${r.on ? 'access-enabled' : 'access-disabled'}`}>
                          <span class={`access-icon${r.on ? '' : ' disabled-icon'}`} aria-hidden="true">{r.icon}</span>
                          <div class="access-copy">
                            <strong>{r.title}</strong>
                            <span>{r.desc}</span>
                          </div>
                          <span class={`access-status ${r.on ? 'enabled' : 'disabled'}`}>
                            {r.on ? <SolCheck /> : <SolX />}
                            {r.on ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
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
                    maxLength={14}
                    onInput={e => setFormPhone(formatPhoneInput((e.target as HTMLInputElement).value))}
                  />
                </div>
              </div>

              {/* Department / Position / Job Site / Manager — HR-record fields that
                  don't apply to superadmin (a platform account, not an employee). */}
              {role !== 'superadmin' && (
                <>
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

                  <div class="field">
                    <label for="mp76-site">Job Site</label>
                    <div class="input-icon">
                      <IcoMapPin />
                      <input
                        id="mp76-site"
                        type="text"
                        value={profile.site || (loadingProfile ? '…' : '—')}
                        readonly
                        tabIndex={-1}
                      />
                    </div>
                  </div>

                  <div class="field">
                    <label for="mp76-manager">Manager</label>
                    <div class="input-icon">
                      <IcoUser />
                      <input
                        id="mp76-manager"
                        type="text"
                        value={profile.manager || (loadingProfile ? '…' : '—')}
                        readonly
                        tabIndex={-1}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Readonly: Company (real value from company branding settings) */}
              <div class="field">
                <label for="mp76-company">Company</label>
                <div class="input-icon">
                  <IcoBuilding />
                  <input
                    id="mp76-company"
                    type="text"
                    value={session.companyName || '—'}
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

              {/* Two-factor auth row — real state from the authenticated 2FA API.
                  Mandatory roles (admin/manager, per security policy) can't disable
                  it here, so it's shown informationally. Superadmin is ALSO routed
                  to Settings regardless of the mandatory flag — account security for
                  a platform-level account shouldn't be a casual inline toggle here.
                  Everyone else gets a real, working switch backed by the same
                  setup/disable flow as Settings (which already gates Disable behind
                  the same mandatory check, server-side). */}
              <div class="security-row">
                <div>
                  <div class="font-medium text-sm">Two-Factor Authentication</div>
                  <div class="text-muted text-sm" style={{ marginTop: '2px' }}>
                    {totpStatus?.mandatory || role === 'superadmin'
                      ? 'Manage via the Security settings page'
                      : 'Require a second verification step at sign in'}
                  </div>
                </div>
                {totpStatusLoading ? (
                  <span class="mp76-clean-status-pill">Loading…</span>
                ) : totpStatus?.mandatory || role === 'superadmin' ? (
                  <span class="mp76-clean-status-pill">In Security Settings</span>
                ) : (
                  <div
                    class={`switch${totpStatus?.enabled ? '' : ' off'}`}
                    role="button"
                    tabIndex={0}
                    aria-label={totpStatus?.enabled ? 'Disable two-factor authentication' : 'Set up two-factor authentication'}
                    onClick={() => (totpStatus?.enabled ? setTotpDisableOpen(true) : setTotpSetupOpen(true))}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); totpStatus?.enabled ? setTotpDisableOpen(true) : setTotpSetupOpen(true); } }}
                  >
                    <span class="thumb" />
                  </div>
                )}
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

              {/* Security Review note */}
              <div class="account-simple-note">
                <strong>Security Review</strong>
                <span>Password changes, two-factor updates, and logout events are recorded for employee account auditing.</span>
              </div>

              {/* ── Notifications block — informational (preferences managed system-wide) ── */}
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
              </div>{/* /account-notifications-block */}
            </div>{/* /account-security-block */}

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
      {totpSetupOpen && (
        <TotpSetupModal
          onClose={() => setTotpSetupOpen(false)}
          onEnabled={() => { void refetchTotpStatus(); setTotpSetupOpen(false); }}
        />
      )}
      {totpDisableOpen && (
        <TotpDisableModal
          onClose={() => setTotpDisableOpen(false)}
          onDisabled={() => { void refetchTotpStatus(); setTotpDisableOpen(false); }}
        />
      )}
    </div>
  );
}
