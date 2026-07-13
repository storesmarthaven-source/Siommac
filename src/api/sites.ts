/**
 * src/api/sites.ts
 *
 * Typed Supabase API functions for the Project Sites domain.
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }            from '@lib/supabase';
import { logger }              from '@lib/logger';
import type {
  CreateSitePayload,
  UpdateSitePayload,
  AssignSiteMembersPayload,
} from './schemas/site';
import type { ProjectSite, ProjectSiteEmployee } from '../../types/db';

/** Site row joined with its assigned members (returned by getSiteWithMembers). */
type SiteWithMembers = ProjectSite & {
  project_site_employees: Array<
    Pick<ProjectSiteEmployee, 'user_id' | 'assigned_at'> & {
      users: { username: string; full_name: string; profile_image: string | null } | null;
    }
  >;
};

// ── Read ──────────────────────────────────────────────────────────────────────

/** List all project sites */
export async function listSites(signal?: AbortSignal) {
  const query = supabase
    .from('project_sites')
    .select('*')
    .order('name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/sites] listSites failed', { error });
    throw new Error(error.message);
  }

  return data as unknown as ProjectSite[];
}

/** List active sites only — used in check-in site picker and live map */
export async function listActiveSites(signal?: AbortSignal) {
  const query = supabase
    .from('project_sites')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/sites] listActiveSites failed', { error });
    throw new Error(error.message);
  }

  return data as unknown as ProjectSite[];
}

/** Get a single site with its assigned employee IDs */
export async function getSiteWithMembers(siteId: string, signal?: AbortSignal) {
  let filterQuery = supabase
    .from('project_sites')
    .select(`
      *,
      project_site_employees(user_id, assigned_at,
        users!project_site_employees_user_id_fkey(username, full_name, profile_image)
      )
    `)
    .eq('id', siteId);

  if (signal) filterQuery = filterQuery.abortSignal(signal);

  const { data, error } = await filterQuery.single() as unknown as
    { data: SiteWithMembers | null; error: { message: string } | null };

  if (error) {
    logger.error('[api/sites] getSiteWithMembers failed', { siteId, error });
    throw new Error(error.message);
  }

  return data;
}

/**
 * Get live employee positions for the map — all employees currently on-site today.
 * Joins attendance (today's check-in lat/lng) with their assigned sites.
 */
export async function getLiveSiteMap(signal?: AbortSignal) {
  const today = new Date().toISOString().slice(0, 10);

  const query = supabase
    .from('attendance')
    .select(`
      id, username, check_in_lat, check_in_lng, check_in_site_id, status,
      check_in_time, check_out_time,
      users!attendance_user_id_fkey(
        full_name, profile_image,
        project_site_employees(site_id,
          project_sites!project_site_employees_site_id_fkey(name, latitude, longitude, radius)
        )
      )
    `)
    .eq('work_date', today)
    .not('check_in_lat', 'is', null)
    .order('check_in_time', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/sites] getLiveSiteMap failed', { error });
    throw new Error(error.message);
  }

  return data;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createSite(payload: CreateSitePayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'addProjectSite',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to create project site.');
}

export async function updateSite(payload: UpdateSitePayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateProjectSite',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update project site.');
}

export async function deleteSite(id: string): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteProjectSite',
    { id },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete project site.');
}

export async function assignSiteMembers(payload: AssignSiteMembersPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'assignSiteEmployees',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to assign site members.');
}
