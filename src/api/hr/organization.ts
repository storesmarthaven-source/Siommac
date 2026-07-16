/**
 * src/api/hr/organization.ts
 *
 * Typed client + TanStack hooks for the HR Organization Structure backend
 * (routes/hr.ts — POST `hr/organization/*`, `hr/positions/*`, `hr/cost-centers/*`,
 * camelCase `body.args`). One shared DTO contract (types/hrOrganization.ts); the
 * `call<T>` helper throws on `success:false`. Gated mutations (update/move/archive/
 * delete/retire) return OrgMutationResult — applied, or held for approval (Phase B).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  OrgUnit, OrgUnitDetail, Position, PositionDetail, CostCenter, OrgStats, OrgHealthSummary,
  OrgChangeImpactSummary, PreviewOrgChangeArgs, OrgMutationResult,
  OrgChangeRequest, OrgChangeListArgs, CancelOrgChangeArgs,
  CreateOrgUnitArgs, UpdateOrgUnitArgs, MoveOrgUnitArgs, ArchiveOrgUnitArgs, DeleteOrgUnitArgs,
  CreatePositionArgs, UpdatePositionArgs, RetirePositionArgs,
  CreateCostCenterArgs, UpdateCostCenterArgs, RetireCostCenterArgs,
} from '../../../types/hrOrganization';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

/**
 * Attach a per-attempt idempotency key to a gated mutation. The backend requires it
 * only when the change routes to approval (atomic create-and-start), but every gated
 * mutation might, so we always send one — a caller-provided key wins so a deliberate
 * retry can dedupe.
 */
function keyed<T extends { idempotencyKey?: string }>(a: T): T {
  return { ...a, idempotencyKey: a.idempotencyKey ?? crypto.randomUUID() };
}

export const hrOrganizationApi = {
  listOrgUnits:   ()                        => call<OrgUnit[]>('hr/organization/tree', {}),
  getOrgUnit:     (unitId: string)          => call<OrgUnitDetail>('hr/organization/unit/get', { unitId }),
  getStats:       ()                        => call<OrgStats>('hr/organization/stats', {}),
  getHealth:      ()                        => call<OrgHealthSummary>('hr/organization/health', {}),
  previewChange:  (a: PreviewOrgChangeArgs) => call<OrgChangeImpactSummary>('hr/organization/change/preview', a),

  createOrgUnit:  (a: CreateOrgUnitArgs)   => call<{ id: string }>('hr/organization/unit/create', a),
  updateOrgUnit:  (a: UpdateOrgUnitArgs)   => call<OrgMutationResult>('hr/organization/unit/update', keyed(a)),
  moveOrgUnit:    (a: MoveOrgUnitArgs)     => call<OrgMutationResult>('hr/organization/unit/move', keyed(a)),
  archiveOrgUnit: (a: ArchiveOrgUnitArgs)  => call<OrgMutationResult>('hr/organization/unit/archive', keyed(a)),
  deleteOrgUnit:  (a: DeleteOrgUnitArgs)   => call<OrgMutationResult>('hr/organization/unit/delete', keyed(a)),

  listPositions:  ()                       => call<Position[]>('hr/positions/list', {}),
  getPosition:    (positionId: string)     => call<PositionDetail>('hr/positions/get', { positionId }),
  createPosition: (a: CreatePositionArgs)  => call<{ id: string }>('hr/positions/create', a),
  updatePosition: (a: UpdatePositionArgs)  => call<OrgMutationResult>('hr/positions/update', keyed(a)),
  retirePosition: (a: RetirePositionArgs)  => call<OrgMutationResult>('hr/positions/retire', keyed(a)),

  listCostCenters: ()                        => call<CostCenter[]>('hr/cost-centers/list', {}),
  createCostCenter: (a: CreateCostCenterArgs) => call<{ id: string }>('hr/cost-centers/create', a),
  updateCostCenter: (a: UpdateCostCenterArgs) => call<OrgMutationResult>('hr/cost-centers/update', keyed(a)),
  retireCostCenter: (a: RetireCostCenterArgs) => call<OrgMutationResult>('hr/cost-centers/retire', keyed(a)),

  listChangeRequests: (a: OrgChangeListArgs = {}) => call<OrgChangeRequest[]>('hr/organization/changes/list', a),
  getChangeRequest:   (changeRequestId: string)   => call<OrgChangeRequest>('hr/organization/change/get', { changeRequestId }),
  cancelChangeRequest: (a: CancelOrgChangeArgs)   => call<{ id: string }>('hr/organization/change/cancel', a),
};

export const orgKeys = {
  root:           ['hr', 'organization'] as const,
  tree:           ['hr', 'organization', 'tree'] as const,
  unit:           (id: string) => ['hr', 'organization', 'unit', id] as const,
  stats:          ['hr', 'organization', 'stats'] as const,
  health:         ['hr', 'organization', 'health'] as const,
  positions:      ['hr', 'organization', 'positions'] as const,
  position:       (id: string) => ['hr', 'organization', 'position', id] as const,
  costCenters:    ['hr', 'organization', 'costCenters'] as const,
  changeRequests: ['hr', 'organization', 'changeRequests'] as const,
};

// ── Queries ─────────────────────────────────────────────────────────────────────

export function useOrgUnits() { return useQuery({ queryKey: orgKeys.tree, queryFn: () => hrOrganizationApi.listOrgUnits() }); }
export function useOrgUnit(unitId: string | null) { return useQuery({ queryKey: orgKeys.unit(unitId ?? ''), queryFn: () => hrOrganizationApi.getOrgUnit(unitId!), enabled: !!unitId }); }
export function useOrgStats() { return useQuery({ queryKey: orgKeys.stats, queryFn: () => hrOrganizationApi.getStats() }); }
export function useOrgHealth() { return useQuery({ queryKey: orgKeys.health, queryFn: () => hrOrganizationApi.getHealth() }); }
export function usePositions() { return useQuery({ queryKey: orgKeys.positions, queryFn: () => hrOrganizationApi.listPositions() }); }
export function usePosition(positionId: string | null) { return useQuery({ queryKey: orgKeys.position(positionId ?? ''), queryFn: () => hrOrganizationApi.getPosition(positionId!), enabled: !!positionId }); }
export function useCostCenters() { return useQuery({ queryKey: orgKeys.costCenters, queryFn: () => hrOrganizationApi.listCostCenters() }); }
export function useOrgChangeRequests(args: OrgChangeListArgs = {}) {
  return useQuery({ queryKey: [...orgKeys.changeRequests, args], queryFn: () => hrOrganizationApi.listChangeRequests(args) });
}

// ── Mutations ───────────────────────────────────────────────────────────────────

function useOrgInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: orgKeys.root });
    void qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
  };
}

export function useCreateOrgUnit()  { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.createOrgUnit,  onSuccess: inv }); }
export function useUpdateOrgUnit()  { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.updateOrgUnit,  onSuccess: inv }); }
export function useMoveOrgUnit()    { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.moveOrgUnit,    onSuccess: inv }); }
export function useArchiveOrgUnit() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.archiveOrgUnit, onSuccess: inv }); }
export function useDeleteOrgUnit()  { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.deleteOrgUnit,  onSuccess: inv }); }

export function useCreatePosition() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.createPosition, onSuccess: inv }); }
export function useUpdatePosition() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.updatePosition, onSuccess: inv }); }
export function useRetirePosition() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.retirePosition, onSuccess: inv }); }

export function useCreateCostCenter() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.createCostCenter, onSuccess: inv }); }
export function useUpdateCostCenter() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.updateCostCenter, onSuccess: inv }); }
export function useRetireCostCenter() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.retireCostCenter, onSuccess: inv }); }

export function useCancelOrgChange() { const inv = useOrgInvalidate(); return useMutation({ mutationFn: hrOrganizationApi.cancelChangeRequest, onSuccess: inv }); }
