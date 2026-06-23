-- ============================================================================
-- Legacy messaging tables — DEPRECATION (non-destructive rename, reversible)
--
-- ⚠️  RUN THIS ONLY AFTER you have:
--      1. Run 20260625200000_messaging_enhance.sql
--      2. Run 20260625300000_messages_legacy_migration.sql successfully
--      3. VERIFIED that the canonical Message Center shows your real messages
--         (e.g. `select count(*) from message_posts;` is non-zero and looks right)
--
-- The application code no longer reads the legacy `messages`, `message_replies`,
-- or `message_reads` tables (routes/messages.ts, MessagesPanel.ts and the
-- RealtimeController subscriptions were retired). This migration renames them out
-- of the way with a `legacy_` prefix instead of dropping them, so the data is
-- preserved and the change is reversible.
--
-- This is NON-DESTRUCTIVE. The permanent DROP is intentionally NOT done here —
-- run it yourself only once you are fully confident (see the commented block at
-- the bottom), ideally after taking a backup.
-- ============================================================================

alter table if exists public.messages        rename to legacy_messages;
alter table if exists public.message_replies rename to legacy_message_replies;
alter table if exists public.message_reads   rename to legacy_message_reads;

-- ── Final retirement (run manually when you are certain) ─────────────────────
-- These permanently delete the legacy message data. Back up first.
--
--   drop table if exists public.legacy_message_reads;
--   drop table if exists public.legacy_message_replies;
--   drop table if exists public.legacy_messages;
--
-- To ROLL BACK this deprecation (restore the original names):
--   alter table if exists public.legacy_messages        rename to messages;
--   alter table if exists public.legacy_message_replies rename to message_replies;
--   alter table if exists public.legacy_message_reads   rename to message_reads;
