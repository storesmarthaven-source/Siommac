// Signed URL helpers for private Supabase Storage buckets.
// Profile photos: persisted in app_users (stable across cold starts, SW-cacheable).
// Attendance photos: in-memory cache (short-lived, not worth persisting).

import { sb } from './db';

const SIGNED_TTL            = 86_400;                          // 24 h in seconds
const SIGNED_REFRESH_BEFORE = 3_600;                           // regenerate when < 1 h remaining
const SIGNED_CACHE_TTL_MS   = (SIGNED_TTL - 1_800) * 1_000;

interface CachedUrl {
  url:       string;
  expiresAt: number;
}

const _attendanceUrlCache = new Map<string, CachedUrl>();

function noPhoto(v: string | null | undefined): boolean {
  return !v || v.trim() === '' || v === '__removed__';
}

async function getSignedUrl(bucket: string, pathOrUrl: string): Promise<string> {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;

  const cacheKey = `${bucket}:${pathOrUrl}`;
  const cached   = _attendanceUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data, error } = await sb.storage.from(bucket).createSignedUrl(pathOrUrl, SIGNED_TTL);
  if (error || !data) {
    console.warn('[photos] signed url fail', bucket, pathOrUrl, error?.message);
    return '';
  }

  _attendanceUrlCache.set(cacheKey, {
    url:       data.signedUrl,
    expiresAt: Date.now() + SIGNED_CACHE_TTL_MS,
  });
  return data.signedUrl;
}

// Returns a stable signed URL for a profile photo.
// Reads the cached value from app_users; regenerates only when < 1 h from expiry.
async function getProfileSignedUrl(userId: string, imagePath: string | null | undefined): Promise<string> {
  if (!imagePath || noPhoto(imagePath)) return '';
  if (/^https?:\/\//.test(imagePath)) return imagePath;

  const { data: row } = await sb
    .from('app_users')
    .select('signed_url, signed_url_expires_at')
    .eq('id', userId)
    .maybeSingle<{ signed_url: string | null; signed_url_expires_at: string | null }>();

  const now       = Date.now();
  const expiresAt = row?.signed_url_expires_at ? new Date(row.signed_url_expires_at).getTime() : 0;
  const stillValid = row?.signed_url && expiresAt > now + SIGNED_REFRESH_BEFORE * 1000;

  if (stillValid) return row!.signed_url!;

  const { data, error } = await sb.storage
    .from('profile-photos')
    .createSignedUrl(imagePath, SIGNED_TTL);
  if (error || !data) {
    console.warn('[photos] profile signed url fail', imagePath, error?.message);
    return '';
  }

  const newExpiry = new Date(now + SIGNED_TTL * 1000).toISOString();
  await sb
    .from('app_users')
    .update({ signed_url: data.signedUrl, signed_url_expires_at: newExpiry })
    .eq('id', userId);

  return data.signedUrl;
}

interface AttendancePhotoRecord {
  check_in_photo_url?:  string | null;
  checkInPhotoUrl?:     string | null;
  check_out_photo_url?: string | null;
  checkOutPhotoUrl?:    string | null;
  [key: string]: unknown;
}

async function resolveAttendancePhotos<T extends AttendancePhotoRecord>(rec: T): Promise<T & { checkInPhotoUrl: string; checkOutPhotoUrl: string }> {
  const [inUrl, outUrl] = await Promise.all([
    getSignedUrl('attendance-photos', rec.check_in_photo_url  ?? rec.checkInPhotoUrl  ?? ''),
    getSignedUrl('attendance-photos', rec.check_out_photo_url ?? rec.checkOutPhotoUrl ?? ''),
  ]);
  return { ...rec, checkInPhotoUrl: inUrl, checkOutPhotoUrl: outUrl };
}

async function resolveAttendancePhotosBatch<T extends AttendancePhotoRecord>(
  rows: T[],
): Promise<(T & { checkInPhotoUrl: string; checkOutPhotoUrl: string })[]> {
  return Promise.all((rows ?? []).map(r => resolveAttendancePhotos(r)));
}

export { noPhoto, getSignedUrl, getProfileSignedUrl, resolveAttendancePhotos, resolveAttendancePhotosBatch };
