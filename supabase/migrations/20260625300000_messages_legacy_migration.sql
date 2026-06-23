-- ============================================================================
-- Legacy messages → canonical message_threads / message_posts / message_participants
--
-- What it does:
--   Migrates every row in the pre-existing `messages` table into the canonical
--   messaging schema introduced by 20260621100001_erp_communications_core.sql
--   and extended by 20260625200000_messaging_enhance.sql:
--     • One legacy message  → one message_threads row  (thread_type = 'direct')
--     • Two message_participants (sender 'owner', recipient 'participant')
--     • One message_posts row from messages.body (the root post)
--     • One message_posts row per message_replies row
--     • message_participants.last_read_at populated from message_reads / read_by_recipient
--     • message_threads.last_post_at + last_post_preview kept consistent
--
-- Idempotency:
--   Every INSERT is guarded by a NOT EXISTS check keyed on the legacy id stored
--   in metadata.  Re-running this migration is safe and produces no duplicates.
--   Guard keys:
--     • message_threads      → metadata->>'legacy_message_id'
--     • message_posts (root) → metadata->>'legacy_message_id'  (is_system=false, author set)
--     • message_posts (reply)→ metadata->>'legacy_reply_id'
--   Participants use ON CONFLICT (thread_id, user_id) DO NOTHING so they are
--   also safe on re-run.
--
-- Orphaned user IDs:
--   Only participants whose user_id EXISTS in app_users are inserted.
--   Root posts and reply posts store author_user_id even when the user is gone
--   (the FK is ON DELETE SET NULL, so history is preserved in body/metadata).
--   author_user_id is also guarded: if the from_user_id no longer exists in
--   app_users the post is still inserted with author_user_id = NULL (matching
--   the FK's ON DELETE SET NULL behaviour to preserve message history).
--
-- Legacy tables:
--   NOT dropped here.  The `messages`, `message_replies`, and `message_reads`
--   tables remain untouched.  Retirement (rename + drop) is a later phase once
--   all application routes have been cut over to the canonical API.
--
-- NOTE: Must run AFTER 20260625200000_messaging_enhance.sql
-- ============================================================================

DO $$
DECLARE
  v_msg         RECORD;
  v_reply       RECORD;
  v_thread_id   UUID;
  v_post_id     UUID;
  v_latest_at   TIMESTAMPTZ;
  v_latest_body TEXT;
BEGIN

  -- ── Iterate legacy messages ────────────────────────────────────────────────
  FOR v_msg IN
    SELECT
      id,
      from_user_id,
      to_user_id,
      subject,
      body,
      read_by_recipient,
      created_at
    FROM public.messages
    ORDER BY created_at
  LOOP

    -- ── 1. Create message_threads if not already migrated ─────────────────
    SELECT id
      INTO v_thread_id
      FROM public.message_threads
     WHERE metadata->>'legacy_message_id' = v_msg.id::text
     LIMIT 1;

    IF v_thread_id IS NULL THEN
      v_thread_id := gen_random_uuid();

      INSERT INTO public.message_threads (
        id,
        thread_type,
        subject,
        created_by,
        created_at,
        metadata
      )
      VALUES (
        v_thread_id,
        'direct',
        COALESCE(v_msg.subject, '(no subject)'),
        -- created_by: only set when the user still exists
        CASE WHEN EXISTS (
               SELECT 1 FROM public.app_users WHERE id = v_msg.from_user_id
             ) THEN v_msg.from_user_id
             ELSE NULL
        END,
        v_msg.created_at,
        jsonb_build_object('legacy_message_id', v_msg.id::text)
      );
    END IF;

    -- ── 2. Participants (sender + recipient, only if in app_users) ─────────

    -- Sender (role = 'owner')
    IF EXISTS (SELECT 1 FROM public.app_users WHERE id = v_msg.from_user_id) THEN
      INSERT INTO public.message_participants (
        thread_id,
        user_id,
        role,
        joined_at
      )
      VALUES (
        v_thread_id,
        v_msg.from_user_id,
        'owner',
        v_msg.created_at
      )
      ON CONFLICT (thread_id, user_id) DO NOTHING;
    END IF;

    -- Recipient (role = 'participant')
    IF v_msg.to_user_id IS NOT NULL AND
       EXISTS (SELECT 1 FROM public.app_users WHERE id = v_msg.to_user_id)
    THEN
      INSERT INTO public.message_participants (
        thread_id,
        user_id,
        role,
        joined_at
      )
      VALUES (
        v_thread_id,
        v_msg.to_user_id,
        'participant',
        v_msg.created_at
      )
      ON CONFLICT (thread_id, user_id) DO NOTHING;
    END IF;

    -- ── 3. Root post from messages.body ───────────────────────────────────
    IF NOT EXISTS (
      SELECT 1
        FROM public.message_posts
       WHERE metadata->>'legacy_message_id' = v_msg.id::text
         AND (metadata->>'legacy_reply_id') IS NULL
    ) THEN
      INSERT INTO public.message_posts (
        id,
        thread_id,
        author_user_id,
        body,
        is_system,
        created_at,
        metadata
      )
      VALUES (
        gen_random_uuid(),
        v_thread_id,
        CASE WHEN EXISTS (
               SELECT 1 FROM public.app_users WHERE id = v_msg.from_user_id
             ) THEN v_msg.from_user_id
             ELSE NULL
        END,
        v_msg.body,
        false,
        v_msg.created_at,
        jsonb_build_object('legacy_message_id', v_msg.id::text)
      );
    END IF;

    -- ── 4. Reply posts from message_replies ──────────────────────────────
    FOR v_reply IN
      SELECT
        id,
        from_user_id,
        body,
        created_at
      FROM public.message_replies
      WHERE message_id = v_msg.id
      ORDER BY created_at
    LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM public.message_posts
         WHERE metadata->>'legacy_reply_id' = v_reply.id::text
      ) THEN
        INSERT INTO public.message_posts (
          id,
          thread_id,
          author_user_id,
          body,
          is_system,
          created_at,
          metadata
        )
        VALUES (
          gen_random_uuid(),
          v_thread_id,
          CASE WHEN EXISTS (
                 SELECT 1 FROM public.app_users WHERE id = v_reply.from_user_id
               ) THEN v_reply.from_user_id
               ELSE NULL
          END,
          v_reply.body,
          false,
          v_reply.created_at,
          jsonb_build_object('legacy_reply_id', v_reply.id::text)
        );
      END IF;
    END LOOP;

    -- ── 5. Update thread last_post_at / last_post_preview ─────────────────
    SELECT
      p.created_at,
      p.body
    INTO
      v_latest_at,
      v_latest_body
    FROM public.message_posts p
    WHERE p.thread_id = v_thread_id
    ORDER BY p.created_at DESC
    LIMIT 1;

    UPDATE public.message_threads
       SET last_post_at      = v_latest_at,
           last_post_preview = left(v_latest_body, 140)
     WHERE id = v_thread_id;

    -- ── 6. Read state ──────────────────────────────────────────────────────
    --
    -- Primary source: message_reads (message_id, user_id, last_read_at)
    -- Fallback for recipient: messages.read_by_recipient boolean
    --   → when true and no message_reads row exists, set last_read_at = now()
    --
    -- Only update participants that were actually inserted (i.e. exist in app_users).

    -- From message_reads (covers both sender self-read and explicit recipient reads)
    UPDATE public.message_participants mp
       SET last_read_at = GREATEST(mp.last_read_at, mr.last_read_at)
      FROM public.message_reads mr
     WHERE mr.message_id = v_msg.id
       AND mr.user_id    = mp.user_id
       AND mp.thread_id  = v_thread_id;

    -- Fallback: read_by_recipient boolean → recipient participant
    IF v_msg.read_by_recipient = true AND
       v_msg.to_user_id IS NOT NULL AND
       EXISTS (SELECT 1 FROM public.app_users WHERE id = v_msg.to_user_id)
    THEN
      UPDATE public.message_participants
         SET last_read_at = COALESCE(last_read_at, now())
       WHERE thread_id = v_thread_id
         AND user_id   = v_msg.to_user_id
         AND last_read_at IS NULL;
    END IF;

  END LOOP; -- end message loop

END;
$$;
