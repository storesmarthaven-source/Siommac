-- ============================================================================
-- AI Photo Enhancement — configurable prompt setting
-- ============================================================================
-- Makes the profile-photo/enhance route's OpenAI prompt an admin-editable
-- setting instead of a hardcoded constant, via the existing catalog-driven
-- Settings architecture (see netlify/functions/lib/settings/resolveSetting.ts).
-- Global-only override (no per-role/site/dept tuning needed for a prompt
-- template); gated behind the existing 'settings.system.manage' permission,
-- surfaced under the "System" settings page (moduleKey 'system').
-- ============================================================================

-- 'text' is a new data_type (multi-line prose, unlike 'string' single-line
-- inputs or 'json'/'array' which JSON.parse on save) — widen the check
-- constraint to allow it.
alter table public.app_setting_catalog
  drop constraint if exists app_setting_catalog_data_type_check;

alter table public.app_setting_catalog
  add constraint app_setting_catalog_data_type_check check (data_type in (
    'boolean','number','string','text','select','multi_select','json','duration','time','array'));

insert into public.app_setting_catalog
  (setting_key, module_key, label, description, data_type, default_value,
   is_active, scope, user_override_allowed, role_override_allowed,
   site_override_allowed, department_override_allowed, module_override_allowed,
   requires_permission)
values
  ('auth.profile_photo.enhance_prompt', 'system', 'AI Photo Enhancement Prompt',
   'Prompt sent to OpenAI when generating an AI-enhanced profile photo preview. Edit to change tone, background, or framing guidance.',
   'text',
   '"Standardize this manually cropped employee profile photo for a professional SIOMAC employee record. Preserve the person''s identity and natural appearance. Improve lighting, clarity, and background cleanliness. Use a clean neutral professional background. Keep the crop suitable for an employee profile and HR record. Do not change facial structure, age, skin tone, identity, or create an unrealistic image."'::jsonb,
   true, '["global"]'::jsonb, false, false, false, false, false, 'settings.system.manage')

on conflict (setting_key) do update
  set label               = excluded.label,
      description         = excluded.description,
      data_type           = excluded.data_type,
      default_value       = excluded.default_value,
      is_active           = excluded.is_active,
      requires_permission = excluded.requires_permission;

-- After applying, run: NOTIFY pgrst, 'reload schema';
