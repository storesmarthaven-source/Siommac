-- =============================================================================
-- Retire the legacy coarse module-access matrix (build-new → delete-legacy, phase 2).
--
-- Module access is governed entirely by the permission catalogue now:
--   • the sidebar gates on moduleRegistry.getModulesForRole (code), and
--   • the Console "Modules" tab is a read-only catalogue rollup.
-- The coarse per-role/per-manager on/off matrix enforced nothing at runtime — only the
-- (now-deleted) superadmin.ts routes read/wrote these tables. Drop them.
--
-- No inbound FKs reference these tables; `cascade` removes their own indexes/policies.
-- Idempotent. Run in the Supabase SQL editor.
-- =============================================================================
drop table if exists public.manager_module_permissions cascade;
drop table if exists public.module_permissions cascade;
