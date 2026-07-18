/**
 * src/api/finance/pickers.ts
 *
 * TanStack Query hooks for Finance picker lists:
 *   GL accounts, cost centres, tax codes, payment terms, and vendor quick-search.
 *
 * All pickers gate on finance.ap.view minimum. Results are stale-while-revalidate
 * (5 min staleTime) since config lists change infrequently.
 */

import { useQuery, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

const STALE_5M = 5 * 60_000;

// ── DTO types (mirror backend pickers.ts) ─────────────────────────────────────

export interface GlAccountOption {
  code: string;
  name: string;
  category: string;
}

export interface CostCentreOption {
  id: string;
  code: string;
  name: string;
  department?: string | null;
}

export interface TaxCodeOption {
  code: string;
  name: string;
  rate: number;
  description: string;
}

export interface PaymentTermsOption {
  days: number;
  label: string;
}

export interface VendorPickerOption {
  id: string;
  vendorNo: string;
  name: string;
  status: 'active' | 'inactive' | 'on_hold';
  paymentTermsDays: number;
  defaultGlAccountCode: string | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function post<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args, signal ? { signal } : undefined);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** GL accounts, optionally filtered by search string. */
export function useGlAccounts(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerGlAccounts(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<GlAccountOption[]>('finance/pickers/gl-accounts', search ? { search } : {}, signal),
    staleTime: STALE_5M,
  });
}

/** Cost centres, optionally filtered by search string. */
export function useCostCentres(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerCostCentres(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<CostCentreOption[]>('finance/pickers/cost-centres', search ? { search } : {}, signal),
    staleTime: STALE_5M,
  });
}

/** Tax code options (config-backed; no search needed — short list). */
export function useTaxCodes() {
  return useQuery({
    queryKey: financeQueryKeys.pickerTaxCodes(),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<TaxCodeOption[]>('finance/pickers/tax-codes', {}, signal),
    staleTime: STALE_5M,
  });
}

/** Payment terms options (config-backed; no search needed — short list). */
export function usePaymentTerms() {
  return useQuery({
    queryKey: financeQueryKeys.pickerPaymentTerms(),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<PaymentTermsOption[]>('finance/pickers/payment-terms', {}, signal),
    staleTime: STALE_5M,
  });
}

/** Vendor quick-search (active + on_hold only). */
export function useVendorPicker(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerVendors(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<VendorPickerOption[]>('finance/pickers/vendors', search ? { search } : {}, signal),
    staleTime: STALE_5M,
  });
}
