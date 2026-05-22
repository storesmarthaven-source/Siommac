-- =============================================================================
-- Siomac — Bulk reset all user passwords
--
-- Change v_new_password below, then run in Supabase SQL Editor.
-- Safe to run multiple times.
-- =============================================================================

DO $$
DECLARE
  v_new_password text := 'ChangeMe123!';   -- ← set your desired password here
BEGIN
  UPDATE auth.users
  SET    encrypted_password = crypt(v_new_password, gen_salt('bf')),
         updated_at         = now()
  WHERE  email IN (
    SELECT auth_email FROM public.app_users WHERE auth_email IS NOT NULL
  );

  RAISE NOTICE 'Done. Rows updated: %', (
    SELECT count(*) FROM auth.users
    WHERE email IN (SELECT auth_email FROM public.app_users WHERE auth_email IS NOT NULL)
  );
END $$;
