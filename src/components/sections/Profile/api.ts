/**
 * src/components/sections/Profile/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { ProfileData, ActivityEvent } from './types';

interface RawEmployee {
  fullName:       string;
  email:          string;
  phone:          string;
  department:     string;
  site:           string;
  manager:        string;
  position:       string;
  employeeNumber: string;
  profileImage:   string;
}

interface RawActivityRow {
  eventType: string;
  createdAt: string;
  payload:   unknown;
}

/** Real, known self-account event types → friendly title + icon key. */
const ACTIVITY_LABELS: Record<string, { title: string; icon: string }> = {
  'auth.profile_photo.submitted':        { title: 'Profile Photo Submitted for Review', icon: 'photo' },
  'auth.profile_photo.approved':         { title: 'Profile Photo Approved',             icon: 'photo' },
  'auth.profile_photo.rejected':         { title: 'Profile Photo Rejected',             icon: 'photo-removed' },
  'auth.profile_photo.updated':          { title: 'Profile Photo Updated',              icon: 'photo' },
  'auth.profile_photo.removed':          { title: 'Profile Photo Removed',              icon: 'photo-removed' },
  'auth.profile.updated':                { title: 'Profile Information Updated',        icon: 'profile' },
  'auth.password.changed':               { title: 'Password Changed',                   icon: 'password' },
  'auth.totp.enabled':                   { title: 'Two-Factor Authentication Enabled',  icon: 'security-on' },
  'auth.totp.disabled':                  { title: 'Two-Factor Authentication Disabled', icon: 'security-off' },
  'auth.totp.backup_codes_regenerated':  { title: 'Backup Codes Regenerated',           icon: 'security' },
};

function humanizeEventType(eventType: string): string {
  const last = eventType.split('.').pop() ?? eventType;
  return last.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

export async function fetchMyProfile(username: string, signal?: AbortSignal): Promise<RawEmployee> {
  const res = await apiPost<{ success: boolean; data: RawEmployee; message?: string }>(
    'getEmployeeByUsername',
    { username } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Cannot load profile');
  return res.data;
}

function fmtLocalTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function fmtActivity(d: string | undefined): string {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return (
      dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' +
      dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  } catch { return d; }
}

export async function fetchMyActivity(signal?: AbortSignal): Promise<ActivityEvent[]> {
  const res = await apiPost<{ success: boolean; data?: RawActivityRow[]; message?: string }>(
    'getMyRecentActivity', {}, signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Cannot load recent activity');

  return (res.data ?? []).map(r => {
    const known = ACTIVITY_LABELS[r.eventType];
    const raw = new Date(r.createdAt);
    return {
      icon:  known?.icon ?? 'generic',
      title: known?.title ?? humanizeEventType(r.eventType),
      date:  fmtActivity(r.createdAt),
      raw,
    };
  });
}

export interface UpdateProfilePayload {
  username:           string;
  fullName:           string;
  email:              string;
  phone:              string;
  profileImageBase64: string;
  removeProfileImage: boolean;
}

export interface UpdateProfileResult {
  fullName:     string;
  profileImage: string;
}

export async function updateMyProfile(
  payload: UpdateProfilePayload,
  signal?: AbortSignal,
): Promise<UpdateProfileResult> {
  const res = await apiPost<{ success: boolean; fullName?: string; profileImage?: string; message?: string }>(
    'updateMyProfile',
    payload as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Update failed');
  return { fullName: res.fullName ?? payload.fullName, profileImage: res.profileImage ?? '' };
}

// ── Profile photo: presigned direct upload to the public avatars bucket ───────

/** Resize/crop an image File to a square WEBP blob of the given side length. */
export async function resizeImageToWebp(file: File, size: number, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side   = Math.min(bitmap.width, bitmap.height);          // center-crop to square
  const sx     = (bitmap.width  - side) / 2;
  const sy     = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', quality));
  if (!blob) throw new Error('Image conversion failed');
  return blob;
}

interface UploadUrlSlot { path: string; uploadUrl: string; publicUrl: string }
interface UploadUrlResponse {
  success: boolean; message?: string;
  data?: { version: number; avatar: UploadUrlSlot; thumbnail: UploadUrlSlot; maxSizeBytes: number };
}

async function putToSignedUrl(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'content-type': 'image/webp', 'x-upsert': 'true' } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** Full flow: resize → presign → PUT both → commit. The commit does NOT change the
 *  live avatar — it stays pending until an authorized reviewer approves it from the
 *  Employee Master profile drawer. Returns the pending thumb URL (for a "submitted"
 *  confirmation only) + `pending: true`. */
export async function uploadMyProfilePhoto(file: File): Promise<{ profileImage: string; profileImageVersion: number; pending: boolean }> {
  const [avatarBlob, thumbBlob] = await Promise.all([
    resizeImageToWebp(file, 512, 0.86),
    resizeImageToWebp(file, 96, 0.82),
  ]);

  const pres = await apiPost<UploadUrlResponse>('profile-photo/upload-url', { mimeType: 'image/webp' });
  if (!pres.success || !pres.data) throw new Error(pres.message ?? 'Could not start upload');
  const { version, avatar, thumbnail, maxSizeBytes } = pres.data;
  if (avatarBlob.size > maxSizeBytes) throw new Error('Image is too large');

  await Promise.all([putToSignedUrl(avatar.uploadUrl, avatarBlob), putToSignedUrl(thumbnail.uploadUrl, thumbBlob)]);

  const commit = await apiPost<{ success: boolean; message?: string; data?: { profileImage: string; profileImageVersion: number; pending: boolean } }>(
    'profile-photo/commit',
    { version, avatarPath: avatar.path, avatarPublicUrl: avatar.publicUrl, thumbPath: thumbnail.path, thumbPublicUrl: thumbnail.publicUrl },
  );
  if (!commit.success || !commit.data) throw new Error(commit.message ?? 'Could not save photo');
  return commit.data;
}

/**
 * Server-side AI enhancement: sends the image as base64 to the backend
 * (which calls OpenAI with the server-side API key — the key never touches the client).
 * Returns the enhanced image as a base64 PNG string for the caller to preview.
 * To persist, call uploadMyProfilePhoto with a File built from the base64.
 *
 * If the backend is not configured (OPENAI_API_KEY missing) the returned
 * `data` is null and `message` explains why — the UI surfaces this honestly.
 */
export async function enhanceMyProfilePhoto(
  file: File,
): Promise<{ imageBase64: string; mimeType: string }> {
  // Convert to base64 for the JSON body
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await apiPost<{
    success: boolean;
    message?: string;
    data?: { imageBase64: string; mimeType: string };
  }>('profile-photo/enhance', { imageBase64: base64, mimeType: file.type });
  if (!res.success || !res.data) throw new Error(res.message ?? 'Photo enhancement failed');
  return res.data;
}

export async function removeMyProfilePhoto(): Promise<{ profileImage: string | null; profileImageVersion: number }> {
  const res = await apiPost<{ success: boolean; message?: string; data?: { profileImage: string | null; profileImageVersion: number } }>(
    'profile-photo/remove', {},
  );
  if (!res.success || !res.data) throw new Error(res.message ?? 'Could not remove photo');
  return res.data;
}

/** Change the current user's password via the canonical /auth/password/change
 *  route — the ONLY password path. It verifies the current password, rotates the
 *  security stamp (invalidating trusted devices), revokes other sessions, and is
 *  rate-limited. `updateMyProfile` intentionally no longer touches passwords. */
export async function updateMyPassword(
  payload: { oldPassword: string; newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'auth/password/change',
    { currentPassword: payload.oldPassword, newPassword: payload.newPassword } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Password change failed');
}
