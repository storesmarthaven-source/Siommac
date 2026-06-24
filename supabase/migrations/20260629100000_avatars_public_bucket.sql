-- ============================================================================
-- Profile Photo Redesign — public avatars bucket + stored public URLs.
--
-- Replaces the private profile-photos + per-user signed-URL cache
-- (app_users.signed_url / signed_url_expires_at) + base64 Lambda upload +
-- "__removed__" sentinel with a PUBLIC avatars bucket and stored public URLs.
-- Avatars are low-sensitivity UI assets; signed URLs stay for genuinely private
-- files (message attachments, HSE evidence, attendance photos).
--
-- ⚠️ MANUAL STEP (Supabase dashboard / not in this file): create a PUBLIC storage
-- bucket named `avatars` (public read). Versioned object paths
-- (`{userId}/avatar-v{n}.webp`) mean a new photo changes the URL, so CDNs/browsers
-- refresh naturally — no cache-busting query string, no signed-URL staleness.
--
-- Additive + idempotent. Legacy columns (profile_image, signed_url,
-- signed_url_expires_at) are KEPT for back-compat; dropped in a later cleanup
-- migration once all readers use the new fields.
-- ============================================================================

alter table public.app_users
  add column if not exists profile_image_url        text,
  add column if not exists profile_image_path       text,
  add column if not exists profile_image_thumb_url  text,
  add column if not exists profile_image_thumb_path text,
  add column if not exists profile_image_version    integer not null default 1,
  add column if not exists profile_image_updated_at timestamptz,
  add column if not exists profile_image_removed_at timestamptz;

-- ── Backfill (Phase 4, run separately / manually) ────────────────────────────
-- For existing app_users.profile_image values:
--   • an http(s) URL  → copy into profile_image_url (+ thumb_url) as-is
--   • '__removed__'    → leave the new url/path fields NULL (no photo)
--   • a private storage path → either copy the object into the avatars bucket and
--     set the public URL, or leave NULL so the user re-uploads (initials fallback).
-- A one-time http-URL backfill is safe to run now; the storage-path copy needs a
-- script with storage access, so it is intentionally NOT performed here.
update public.app_users
   set profile_image_url = profile_image,
       profile_image_thumb_url = profile_image
 where profile_image_url is null
   and profile_image is not null
   and profile_image <> '__removed__'
   and profile_image ~ '^https?://';
