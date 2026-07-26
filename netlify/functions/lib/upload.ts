// lib/upload.ts — Supabase Storage upload helpers
//
// Two upload strategies:
//
// 1. createUploadUrl()  — PREFERRED (Phase 2)
//    Returns a short-lived presigned POST URL. The frontend uploads the file
//    directly to Supabase Storage — the Lambda never holds image bytes.
//    Call this from the route handler; the client uploads, then sends back the
//    storage path for the DB record.
//
// 2. uploadBase64()     — LEGACY / server-side only
//    Accepts a base64 data-URI in the request body and uploads from Lambda.
//    Still used for: auto-checkout (no client), branding logo, any server-
//    initiated upload. Not recommended for user photo uploads.

import { sb } from './db';

// ── Shared constants ──────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

// Document/evidence attachments (HSE) — images plus common office/PDF formats.
const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

const MAX_BASE64_BYTES  = 8 * 1024 * 1024;   // raw string length guard
const MAX_BINARY_BYTES  = 6 * 1024 * 1024;   // decoded buffer guard
const PRESIGN_TTL_SECS  = 300;               // 5-minute window to upload

// ── 1. Presigned upload URL ───────────────────────────────────────────────────

interface UploadUrlResult {
  uploadUrl: string;   // PUT to this URL directly from the browser
  token:     string;   // opaque Supabase upload token (may differ per SDK version)
  path:      string;   // storage path — store this in the DB after upload
}

/**
 * Generate a presigned upload URL for a private bucket.
 * The client calls PUT on `uploadUrl` with the raw binary file as the body
 * (Content-Type: the file's MIME type, no JSON wrapping).
 * After the upload succeeds the client sends `path` back to the API so it can
 * be stored in the DB row.
 *
 * @param bucket   Supabase storage bucket name
 * @param name     Base name for the file (safe chars only — will be sanitised)
 * @param mimeType MIME type the client will upload (validated server-side)
 */
async function createUploadUrl(bucket: string, name: string, mimeType: string): Promise<UploadUrlResult> {
  const ext = ALLOWED_IMAGE_TYPES[mimeType.toLowerCase()];
  if (!ext) throw new Error(`Unsupported image type: ${mimeType}. Allowed: jpeg, png, webp`);

  const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const path     = `${safeName}_${Date.now()}.${ext}`;

  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message ?? 'unknown'}`);

  return {
    uploadUrl: data.signedUrl,
    token:     data.token,
    path,
  };
}

// ── 2. Legacy base64 upload (server-side) ────────────────────────────────────

/**
 * Upload a base64 data-URI to the given Supabase Storage bucket.
 * Returns the stored path (private buckets) or a public URL (branding bucket).
 * @deprecated For user photo uploads, prefer createUploadUrl() + client-side PUT.
 */
async function uploadBase64(bucket: string, base64: string, name: string): Promise<string> {
  if (!base64) return '';
  const str = String(base64);

  if (str.length > MAX_BASE64_BYTES) throw new Error('Image too large (max 6 MB)');

  const m    = str.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = ((m ? m[1] : 'image/jpeg') as string).toLowerCase().trim();
  const rawExtract = m ? m[2] : str.split('base64,').pop();
  if (!rawExtract) throw new Error('Invalid base64 image data: could not extract encoded bytes');
  const raw = rawExtract;

  const ext = ALLOWED_IMAGE_TYPES[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}. Allowed: jpeg, png, webp`);

  const safeName = String(name).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const path     = `${safeName}_${Date.now()}.${ext}`;

  const buffer = Buffer.from(raw, 'base64');
  if (buffer.byteLength > MAX_BINARY_BYTES) throw new Error('Image too large (max 6 MB)');

  const { error } = await sb.storage
    .from(bucket)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw error;

  if (bucket === 'branding') {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
  return path;
}

/**
 * Presigned upload URL for an HSE document/evidence attachment. Same flow as
 * createUploadUrl but with the broader document MIME allowlist.
 */
async function createAttachmentUploadUrl(bucket: string, name: string, mimeType: string): Promise<UploadUrlResult & { ext: string }> {
  const ext = ALLOWED_ATTACHMENT_TYPES[mimeType.toLowerCase()];
  if (!ext) throw new Error(`Unsupported file type: ${mimeType}`);

  const safeName = name.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 80);
  const path     = `${safeName}_${Date.now()}.${ext}`;

  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message ?? 'unknown'}`);

  return { uploadUrl: data.signedUrl, token: data.token, path, ext };
}

export { createUploadUrl, createAttachmentUploadUrl, uploadBase64 };
export type { UploadUrlResult };
