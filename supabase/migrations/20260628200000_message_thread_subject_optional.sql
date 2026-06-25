-- Make message_threads.subject nullable. Direct/group messages don't require a
-- subject (the New Message dialog labels it "optional" and the UI derives the
-- thread name from its participants when blank). The original NOT NULL constraint
-- made a no-subject compose fail with a 400.
alter table public.message_threads alter column subject drop not null;
