-- =============================================================================
-- Diagnose: try inserting ONE row into auth.users and show the real error
-- =============================================================================

DO $$
DECLARE
  v_email text;
  v_hash  text;
  v_uid   uuid;
BEGIN
  -- Pick the first unlinked user
  SELECT auth_email INTO v_email
  FROM   public.app_users
  WHERE  auth_id IS NULL
  LIMIT  1;

  IF v_email IS NULL THEN
    RAISE NOTICE 'No unlinked users found.';
    RETURN;
  END IF;

  RAISE NOTICE 'Attempting insert for email: %', v_email;

  v_hash := crypt('ChangeMe123!', gen_salt('bf'));

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
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    'authenticated',
    'authenticated'
  )
  RETURNING id INTO v_uid;

  RAISE NOTICE 'SUCCESS — inserted auth.users id: %', v_uid;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FAILED: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END $$;
