-- Calendar visual identity and physical-location metadata.
-- A dedicated colour key keeps event styling deterministic across devices;
-- location is an explicit business value, never inferred from notes or titles.

begin;

alter table public.calendar_entries
  add column if not exists color_key text,
  add column if not exists location_label text,
  add column if not exists title_icon_type text,
  add column if not exists title_icon_value text;

alter table public.calendar_entries
  drop constraint if exists calendar_entries_color_key_check,
  add constraint calendar_entries_color_key_check
    check (color_key is null or color_key in ('blue', 'indigo', 'purple', 'rose', 'coral', 'amber', 'lime', 'mint', 'teal', 'slate'));

alter table public.calendar_entries
  drop constraint if exists calendar_entries_location_label_check,
  add constraint calendar_entries_location_label_check
    check (location_label is null or char_length(btrim(location_label)) between 1 and 240);

alter table public.calendar_entries
  drop constraint if exists calendar_entries_title_icon_check,
  add constraint calendar_entries_title_icon_check check (
    (title_icon_type is null and title_icon_value is null)
    or (
      title_icon_type in ('emoji', 'lucide')
      and char_length(btrim(title_icon_value)) between 1 and 64
    )
  );

comment on column public.calendar_entries.color_key is
  'User-selected calendar palette key. Null means source-aware automatic styling.';
comment on column public.calendar_entries.location_label is
  'Human-readable physical destination. Null means no physical location is declared.';
comment on column public.calendar_entries.title_icon_type is
  'Optional title glyph family: emoji or a validated UI-kit Lucide icon.';
comment on column public.calendar_entries.title_icon_value is
  'Glyph value paired with title_icon_type. Null means the category icon is used.';

notify pgrst, 'reload schema';

commit;
