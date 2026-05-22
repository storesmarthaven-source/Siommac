-- =============================================================================
-- Siomac — Create first superadmin user
--
-- Run this AFTER phase7-superadmin.sql has been applied.
--
-- Edit the values below, then run in the Supabase SQL Editor.
-- =============================================================================

DO $$
DECLARE
  v_username  text    := 'superadmin';           -- login username
  v_full_name text    := 'Super Administrator';  -- display name
  v_email     text    := 'superadmin@siomac.internal';
  v_password  text    := 'SuperAdmin123!';       -- ⚠️ change this immediately after first login

  v_app_id    text;
  v_hash      text;
  v_auth_uid  uuid;
BEGIN

  -- 1. Insert into app_users
  INSERT INTO public.app_users (username, full_name, role, status, auth_email)
  VALUES (v_username, v_full_name, 'superadmin', 'active', v_email)
  ON CONFLICT (username) DO UPDATE
    SET role       = 'superadmin',
        status     = 'active',
        auth_email = EXCLUDED.auth_email
  RETURNING id INTO v_app_id;

  IF v_app_id IS NULL THEN
    SELECT id INTO v_app_id FROM public.app_users WHERE username = v_username;
  END IF;

  -- 2. Create Supabase Auth account
  v_hash := crypt(v_password, gen_salt('bf'));

  BEGIN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
    ) VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      v_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name, 'app_user_id', v_app_id),
      now(), now(),
      'authenticated', 'authenticated'
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_auth_uid;

    -- If already existed, look up the uuid
    IF v_auth_uid IS NULL THEN
      SELECT id INTO v_auth_uid FROM auth.users WHERE email = v_email;
    END IF;

    -- Also insert the identity row (required for signInWithPassword to work)
    IF v_auth_uid IS NOT NULL THEN
      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_auth_uid,
        v_email,
        jsonb_build_object('sub', v_auth_uid::text, 'email', v_email),
        'email',
        now(), now(), now()
      )
      ON CONFLICT DO NOTHING;

      -- Link auth_id back to app_users
      UPDATE public.app_users
      SET auth_id = v_auth_uid
      WHERE id = v_app_id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Auth insert error: %', SQLERRM;
  END;

  -- 3. Verify
  RAISE NOTICE 'Superadmin created: id=%, auth_id=%', v_app_id, v_auth_uid;
END $$;

-- Confirm the result
SELECT username, full_name, role, auth_email, auth_id IS NOT NULL AS auth_linked
FROM public.app_users
WHERE role = 'superadmin';
