-- ============================================================================
-- HR Employee Master — standardized Position field (v36 Create §2 Employment)
--
-- v36 separates "Job Title" (free text → app_users.position) from "Position"
-- (a standardized role pick). app_users.position already holds the job title;
-- this adds position_title for the standardized selection. Non-destructive.
-- Operator-applied. After applying, NOTIFY pgrst.
-- ============================================================================

alter table public.app_users
  add column if not exists position_title text;

comment on column public.app_users.position_title is 'Standardized position / role (HR Create wizard; distinct from the free-text position/job title).';
