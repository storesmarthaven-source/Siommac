-- ============================================================================
-- Widget library — instance/zone board layout column (Stage C)
-- ============================================================================
-- The widget-library board stores a richer BoardLayout (zones of WidgetInstance:
-- instanceId, widgetId, config, geometry, sizeKey) than the legacy card_order
-- (geometry-only string[]/[{id,x,y,w,h}]). Added as a separate jsonb column so the
-- two coexist per page_key — legacy pages keep card_order, widget-library pages use
-- layout. Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.ui_layout add column if not exists layout jsonb;

comment on column public.ui_layout.layout is
  'Widget-library board layout (zones of WidgetInstance). Coexists with card_order (legacy geometry).';

-- After applying:  NOTIFY pgrst, 'reload schema';
