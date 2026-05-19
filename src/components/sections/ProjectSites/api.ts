/**
 * src/components/sections/ProjectSites/api.ts
 *
 * TanStack Query data-fetchers for the Project Sites section.
 * All functions accept an optional AbortSignal forwarded from useQuery.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { ProjectSite, EmployeeListItem, LiveRow } from './types';

// ── Response shapes ───────────────────────────────────────────────────────────

interface ListSitesResponse {
  success:               boolean;
  message?:              string;
  data?:                 ProjectSite[];
  totalActiveEmployees?: number;
  employees?:            EmployeeListItem[];
}

interface MutateSiteResponse {
  success:  boolean;
  message?: string;
  id?:      string;
}

interface LiveResponse {
  success: boolean;
  data?:   LiveRow[];
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export async function listProjectSites(signal?: AbortSignal): Promise<{
  sites:      ProjectSite[];
  employees:  EmployeeListItem[];
}> {
  const res = await apiPost<ListSitesResponse>('listProjectSites', {}, { signal });
  if (!res.success) throw new Error(res.message || 'Failed to load project sites');
  return {
    sites:     Array.isArray(res.data) ? res.data : [],
    employees: Array.isArray(res.employees) ? res.employees : [],
  };
}

export async function getLiveAttendance(scope: string, signal?: AbortSignal): Promise<LiveRow[]> {
  const res = await apiPost<LiveResponse>('getLiveAttendance', { scope }, { signal });
  if (!res.success) return [];
  return Array.isArray(res.data) ? res.data : [];
}

export async function addProjectSiteApi(
  payload: {
    name:        string;
    address:     string;
    latitude:    number;
    longitude:   number;
    radius:      number;
    description: string;
    actorId:     string;
    actorUsername: string;
  },
  signal?: AbortSignal,
): Promise<MutateSiteResponse> {
  return apiPost<MutateSiteResponse>(
    'addProjectSite',
    payload as unknown as Record<string, unknown>,
    { signal },
  );
}

export async function updateProjectSiteApi(
  payload: {
    id:          string;
    name:        string;
    address:     string;
    latitude:    number;
    longitude:   number;
    radius:      number;
    description: string;
    actorId:     string;
    actorUsername: string;
  },
  signal?: AbortSignal,
): Promise<MutateSiteResponse> {
  return apiPost<MutateSiteResponse>(
    'updateProjectSite',
    payload as unknown as Record<string, unknown>,
    { signal },
  );
}

export async function deleteProjectSiteApi(
  id: string,
  actorId: string,
  actorUsername: string,
  signal?: AbortSignal,
): Promise<MutateSiteResponse> {
  return apiPost<MutateSiteResponse>(
    'deleteProjectSite',
    { id, actorId, actorUsername } as unknown as Record<string, unknown>,
    { signal },
  );
}

export async function assignSiteEmployeesApi(
  siteId: string,
  userIds: string[],
  signal?: AbortSignal,
): Promise<void> {
  await apiPost<MutateSiteResponse>(
    'assignSiteEmployees',
    { siteId, userIds } as unknown as Record<string, unknown>,
    { signal },
  );
}
