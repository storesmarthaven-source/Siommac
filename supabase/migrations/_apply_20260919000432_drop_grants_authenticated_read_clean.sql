drop policy if exists "authenticated read msg access grants" on public.message_thread_access_grants;
notify pgrst, 'reload schema';
