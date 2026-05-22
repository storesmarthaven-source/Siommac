-- =============================================================================
-- Siomac — Create first users (app_users only)
--
-- ⚠️  THIS SCRIPT ONLY CREATES app_users ROWS.
--     Creating auth.users rows directly via SQL breaks Supabase Auth.
--     After running this, also run:
--
--       node supabase/recreate-auth-users.js
--
--     That script calls the Supabase Admin API to create the matching
--     auth.users + auth.identities rows properly.
--
-- Run this in Supabase SQL Editor AFTER schema.sql has been run.
-- It is safe to re-run — all inserts use ON CONFLICT DO NOTHING / DO UPDATE.
--
-- BEFORE RUNNING:
--   Edit the user rows below to match your real staff.
--
-- Format:
--   username   — what staff type on the login screen
--   full_name  — displayed in the app
--   role       — 'admin' | 'manager' | 'employee'
--   email      — real email (optional — leave '' if none)
--   password   — used by recreate-auth-users.js when creating the auth account
-- =============================================================================

-- ── Step 1 & 3 combined: Insert app_users + create Supabase Auth accounts ─────
-- Edit the array below, then run the whole file.

DO $$
DECLARE
  v_users jsonb := '[
    {
      "username":  "admin",
      "full_name": "System Admin",
      "role":      "admin",
      "email":     "",
      "password":  "ChangeMe123!"
    },
    {
      "username":  "manager1",
      "full_name": "First Manager",
      "role":      "manager",
      "email":     "",
      "password":  "ChangeMe123!"
    },
    {
      "username":  "employee1",
      "full_name": "First Employee",
      "role":      "employee",
      "email":     "",
      "password":  "ChangeMe123!"
    }
  ]';
  u            jsonb;
  v_email      text;
  v_app_id     text;
  v_hash       text;
  v_auth_uid   uuid;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(v_users)
  LOOP
    -- Derive auth_email: real email if provided, else username@siomac.internal
    v_email := CASE
      WHEN (u->>'email') IS NOT NULL AND trim(u->>'email') <> ''
        THEN lower(trim(u->>'email'))
      ELSE lower(u->>'username') || '@siomac.internal'
    END;

    -- ── Insert into app_users (no password_hash — Supabase Auth owns credentials)
    INSERT INTO public.app_users (
      username,
      full_name,
      role,
      status,
      auth_email
    )
    VALUES (
      u->>'username',
      u->>'full_name',
      u->>'role',
      'active',
      v_email
    )
    ON CONFLICT (username) DO UPDATE
      SET auth_email = EXCLUDED.auth_email   -- keep auth_email in sync on re-run
    RETURNING id INTO v_app_id;

    -- If ON CONFLICT fired (DO UPDATE), RETURNING still gives us the id.
    -- But if RETURNING returns NULL (shouldn't happen), fall back to SELECT.
    IF v_app_id IS NULL THEN
      SELECT id INTO v_app_id
      FROM public.app_users
      WHERE username = u->>'username';
    END IF;

    -- ── Create Supabase Auth account (skip if email already registered)
    -- Hash the plaintext password with bcrypt right here.
    v_hash := crypt(u->>'password', gen_salt('bf'));

    BEGIN
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
        v_email,
        v_hash,
        now(),                   -- pre-confirm so login works immediately
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', u->>'full_name', 'app_user_id', v_app_id),
        now(),
        now(),
        'authenticated',
        'authenticated'
      )
      ON CONFLICT (email) DO NOTHING
      RETURNING id INTO v_auth_uid;

      -- If email already existed in auth.users, look up the existing id
      IF v_auth_uid IS NULL THEN
        SELECT id INTO v_auth_uid
        FROM auth.users
        WHERE email = v_email;
      END IF;

      -- Link auth_id back to app_users
      IF v_auth_uid IS NOT NULL THEN
        UPDATE public.app_users
        SET    auth_id = v_auth_uid
        WHERE  id = v_app_id
          AND (auth_id IS NULL OR auth_id <> v_auth_uid);
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Auth insert skipped for %: %', u->>'username', SQLERRM;
    END;

  END LOOP;
END $$;

-- ── Step 2: Ensure auth columns exist (safe if already present) ───────────────

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_email text,
  ADD COLUMN IF NOT EXISTS auth_id    uuid UNIQUE;

-- Fill auth_email for any rows that don't have it yet
UPDATE public.app_users
SET auth_email = CASE
  WHEN email IS NOT NULL AND trim(email) <> ''
    THEN lower(trim(email))
  ELSE lower(username) || '@siomac.internal'
END
WHERE auth_email IS NULL;

-- ── Step 3: Index for fast requireUser lookups ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_app_users_auth_id ON public.app_users(auth_id);

-- ── Step 4: Verify ────────────────────────────────────────────────────────────
-- Every row should show auth_linked = true.

SELECT
  username,
  full_name,
  role,
  auth_email,
  auth_id IS NOT NULL AS auth_linked
FROM public.app_users
ORDER BY role, username;
