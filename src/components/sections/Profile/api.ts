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
  position:       string;
  employeeNumber: string;
  profileImage:   string;
}

interface RawAttRow {
  date:     string;
  checkIn:  string | null;
  checkOut: string | null;
}

interface RawLeaveRow {
  id:        string;
  type:      string;
  appliedOn: string;
  from?:     string;
  status:    string;
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
  const [attRows, leaveRows] = await Promise.all([
    apiPost<{ success: boolean }>('getMyHistory',  {}, signal ? { signal } : undefined).catch(() => null),
    apiPost<{ success: boolean }>('getMyLeaves',   {}, signal ? { signal } : undefined).catch(() => null),
  ]);

  const events: ActivityEvent[] = [];

  // These endpoints return array-directly or {success,data:[]} — normalise via unknown
  const rawAtt: unknown    = attRows;
  const rawLeave: unknown  = leaveRows;

  const attData: RawAttRow[] = Array.isArray(rawAtt)
    ? (rawAtt as unknown as RawAttRow[])
    : (rawAtt && Array.isArray((rawAtt as Record<string, unknown>)['data'])
        ? ((rawAtt as Record<string, unknown>)['data'] as RawAttRow[])
        : []);

  attData.slice(0, 15).forEach(r => {
    if (r.checkIn)  events.push({ icon: 'fa-sign-in-alt',  title: 'Clocked In',  date: r.date + ', ' + fmtLocalTime(r.checkIn),  raw: new Date(r.checkIn)  });
    if (r.checkOut) events.push({ icon: 'fa-sign-out-alt', title: 'Clocked Out', date: r.date + ', ' + fmtLocalTime(r.checkOut), raw: new Date(r.checkOut) });
  });

  const leaveData: RawLeaveRow[] = Array.isArray(rawLeave)
    ? (rawLeave as unknown as RawLeaveRow[])
    : (rawLeave && Array.isArray((rawLeave as Record<string, unknown>)['data'])
        ? ((rawLeave as Record<string, unknown>)['data'] as RawLeaveRow[])
        : []);

  leaveData.slice(0, 10).forEach(r => {
    const status = r.status || '';
    const label  = status === 'Approved' ? 'Leave Approved' : status === 'Rejected' ? 'Leave Rejected' : 'Leave Requested';
    const icon   = status === 'Approved' ? 'fa-check-circle' : status === 'Rejected' ? 'fa-times-circle' : 'fa-calendar-plus';
    const dateRaw = r.appliedOn || r.from || '';
    events.push({ icon, title: label + (r.type ? ` (${r.type})` : ''), date: fmtActivity(dateRaw), raw: new Date(dateRaw) });
  });

  events.sort((a, b) => b.raw.getTime() - a.raw.getTime());
  return events.slice(0, 15);
}

export interface UpdateProfilePayload {
  username:           string;
  fullName:           string;
  email:              string;
  phone:              string;
  profileImageBase64: string;
  removeProfileImage: boolean;
  oldPassword:        string;
  newPassword:        string;
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

/** Full flow: resize → presign → PUT both → commit. Returns the new public URL + version. */
export async function uploadMyProfilePhoto(file: File): Promise<{ profileImage: string; profileImageVersion: number }> {
  const [avatarBlob, thumbBlob] = await Promise.all([
    resizeImageToWebp(file, 512, 0.86),
    resizeImageToWebp(file, 96, 0.82),
  ]);

  const pres = await apiPost<UploadUrlResponse>('profile-photo/upload-url', { mimeType: 'image/webp' });
  if (!pres.success || !pres.data) throw new Error(pres.message ?? 'Could not start upload');
  const { version, avatar, thumbnail, maxSizeBytes } = pres.data;
  if (avatarBlob.size > maxSizeBytes) throw new Error('Image is too large');

  await Promise.all([putToSignedUrl(avatar.uploadUrl, avatarBlob), putToSignedUrl(thumbnail.uploadUrl, thumbBlob)]);

  const commit = await apiPost<{ success: boolean; message?: string; data?: { profileImage: string; profileImageVersion: number } }>(
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

export async function updateMyPassword(
  payload: { username: string; fullName: string; oldPassword: string; newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateMyProfile',
    {
      ...payload,
      profileImageBase64: '',
      removeProfileImage: false,
    } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Update failed');
}
