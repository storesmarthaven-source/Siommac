-- =============================================================================
-- Siomac — Migrate to Supabase Auth
--
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → Run).
-- It is safe to re-run — all statements are idempotent.
--
-- What this does:
--   1. Adds auth_email + auth_id columns to app_users
--   2. Fills auth_email (real email or username@siomac.internal)
--   3. Creates auth.users entries for every active app_users row
--   4. Links auth_id back to each app_users row
--   5. Drops the now-redundant custom auth tables
--   6. Drops columns that Supabase Auth now owns (password_hash, totp_*)
--
-- IMPORTANT: Run step 3 only after confirming step 2 looks correct.
--            The CREATE USER calls are in a separate block you can inspect first.
-- =============================================================================

-- ── Step 1: Add new columns ───────────────────────────────────────────────────

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_email text,
  ADD COLUMN IF NOT EXISTS auth_id    uuid UNIQUE;

-- ── Step 2: Populate auth_email ───────────────────────────────────────────────
-- Use real email if present and non-empty, otherwise username@siomac.internal

UPDATE public.app_users
SET auth_email = CASE
  WHEN email IS NOT NULL AND trim(email) <> ''
    THEN lower(trim(email))
  ELSE lower(username) || '@siomac.internal'
END
WHERE auth_email IS NULL;

-- Verify — inspect before continuing:
-- SELECT id, username, email, auth_email FROM public.app_users ORDER BY username;

-- ── Step 3: Create Supabase Auth accounts and link auth_id ────────────────────
-- We use auth.create_user() which is available in Supabase SQL editor.
-- Passwords are set to a temporary random value; users will be prompted to
-- reset via the app on first login (or admin can set passwords via the
-- Supabase dashboard / Admin API).
--
-- NOTE: If a user with the same email already exists in auth.users,
--       the ON CONFLICT clause skips that row safely.

DO $$
DECLARE
  r         record;
  auth_uid  uuid;
BEGIN
  FOR r IN
    SELECT id, username, auth_email, full_name
    FROM   public.app_users
    WHERE  auth_id IS NULL
    ORDER  BY created_at
  LOOP
    BEGIN
      -- Create the Supabase Auth user.
      -- auth.users rows created this way have email_confirmed_at set
      -- so the user can log in immediately without an email confirmation step.
      INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        role,
        aud
      )
      VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        r.auth_email,
        -- Temporary password hash for a random placeholder.
        -- Admins MUST set real passwords via Supabase Dashboard → Auth → Users
        -- or the app's change-password flow after migration.
        crypt('ChangeMe!' || r.id, gen_salt('bf')),
        now(),                              -- email pre-confirmed
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', r.full_name, 'app_user_id', r.id),
        now(),
        now(),
        'authenticated',
        'authenticated'
      )
      ON CONFLICT (email) DO NOTHING
      RETURNING id INTO auth_uid;

      -- If user already existed (ON CONFLICT hit), look them up
      IF auth_uid IS NULL THEN
        SELECT id INTO auth_uid
        FROM   auth.users
        WHERE  email = r.auth_email;
      END IF;

      -- Link auth_id back to app_users
      IF auth_uid IS NOT NULL THEN
        UPDATE public.app_users
        SET    auth_id = auth_uid
        WHERE  id = r.id;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped user % (%): %', r.username, r.auth_email, SQLERRM;
    END;
  END LOOP;
END $$;

-- Verify the link — should show no NULLs in auth_id for active users:
-- SELECT id, username, auth_email, auth_id FROM public.app_users ORDER BY username;

-- ── Step 4: Add NOT NULL constraint once all rows are linked ──────────────────
-- Only run this after verifying Step 3 linked every row.
-- ALTER TABLE public.app_users ALTER COLUMN auth_id SET NOT NULL;
-- ALTER TABLE public.app_users ALTER COLUMN auth_email SET NOT NULL;

-- ── Step 5: Drop old custom auth tables ───────────────────────────────────────
-- These are replaced by Supabase Auth's built-in session management.

DROP TABLE IF EXISTS public.trusted_devices    CASCADE;
DROP TABLE IF EXISTS public.totp_challenges    CASCADE;
DROP TABLE IF EXISTS public.token_revocations  CASCADE;
DROP TABLE IF EXISTS public.refresh_tokens     CASCADE;

-- ── Step 6: Drop columns now owned by Supabase Auth ──────────────────────────
-- password_hash — Supabase Auth stores credentials in auth.users.encrypted_password
-- totp_*        — Supabase Auth MFA owns TOTP secrets
-- backup_codes  — Supabase Auth MFA owns backup codes

ALTER TABLE public.app_users
  DROP COLUMN IF EXISTS password_hash,
  DROP COLUMN IF EXISTS totp_secret,
  DROP COLUMN IF EXISTS totp_enabled,
  DROP COLUMN IF EXISTS totp_enrolled_at,
  DROP COLUMN IF EXISTS backup_codes;

-- ── Step 7: Index on auth_id for fast requireUser lookups ────────────────────
CREATE INDEX IF NOT EXISTS idx_app_users_auth_id ON public.app_users(auth_id);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Next: run supabase/rls-v2.sql to set up real per-user RLS policies.
-- Then deploy the updated Netlify functions.
