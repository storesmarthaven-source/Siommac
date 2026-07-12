/**
 * src/api/hr/requests.ts
 *
 * Typed client + TanStack hooks for the HR Requests backend
 * (routes/hrRequests.ts — POST `hr/requests/*`, camelCase `body.args`).
 * `call<T>` throws on `success:false`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  HrRequestRow, HrRequestTypeDef,
  SubmitRequestArgs, SubmitRequestResult,
  DecideRequestArgs, FulfillRequestArgs, CancelRequestArgs,
} from '../../../types/hrRequests';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrRequestsApi = {
  types:   ()                          => call<HrRequestTypeDef[]>('hr/requests/types', {}),
  submit:  (a: SubmitRequestArgs)      => call<SubmitRequestResult>('hr/requests/submit', a),
  my:      ()                          => call<HrRequestRow[]>('hr/requests/my', {}),
  list:    (a: { status?: string; requestType?: string; employeeId?: string } = {}) => call<HrRequestRow[]>('hr/requests/list', a),
  get:     (requestId: string)         => call<HrRequestRow>('hr/requests/get', { requestId }),
  decide:  (a: DecideRequestArgs)      => call<{ requestId: string; status: string }>('hr/requests/decide', a),
  fulfill: (a: FulfillRequestArgs)     => call<{ requestId: string; status: string }>('hr/requests/fulfill', a),
  cancel:  (a: CancelRequestArgs)      => call<{ requestId: string; status: string }>('hr/requests/cancel', a),
};

export const reqKeys = {
  root:   ['hr', 'requests'] as const,
  types:  ['hr', 'requests', 'types'] as const,
  my:     ['hr', 'requests', 'my'] as const,
  list:   (f?: string) => ['hr', 'requests', 'list', f ?? 'all'] as const,
  detail: (id: string) => ['hr', 'requests', 'detail', id] as const,
};

export function useRequestTypes() {
  return useQuery({ queryKey: reqKeys.types, queryFn: () => hrRequestsApi.types(), staleTime: 5 * 60_000 });
}

export function useMyRequests() {
  return useQuery({ queryKey: reqKeys.my, queryFn: () => hrRequestsApi.my() });
}

export function useAllRequests(filters?: { status?: string; requestType?: string }) {
  const key = reqKeys.list(filters?.status ?? filters?.requestType);
  return useQuery({ queryKey: key, queryFn: () => hrRequestsApi.list(filters ?? {}) });
}

export function useRequest(requestId: string | null) {
  return useQuery({
    queryKey: reqKeys.detail(requestId ?? ''),
    queryFn:  () => hrRequestsApi.get(requestId!),
    enabled:  !!requestId,
  });
}

/** Generic HR requests mutation hook — invalidates the full requests tree. */
export function useRequestsMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reqKeys.root });
    },
  });
}
