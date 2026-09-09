-- User-defined Calendar card colours.
-- Preset identity remains in color_key; an optional, validated hex value
-- overrides it when a user chooses Custom in the Calendar UI.

begin;

alter table public.calendar_entries
  add column if not exists custom_color text;

alter table public.calendar_entries
  drop constraint if exists calendar_entries_custom_color_hex_check,
  add constraint calendar_entries_custom_color_hex_check
    check (custom_color is null or custom_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.calendar_entries.custom_color is
  'Optional user-selected six-digit hex colour. Null uses color_key or source-aware automatic styling.';

notify pgrst, 'reload schema';

commit;
