/**
 * src/components/sections/Finance/_shared/pickers.tsx
 *
 * Thin EntityPicker wrappers for every Finance lookup hook.
 * Each component binds one data source to the generic EntityPicker control:
 *   EmployeePicker       — employee search (useEmployeePicker)
 *   CostCentrePicker     — cost-centre search (useCostCentrePicker / useCostCentres)
 *   ApprovedRunPicker    — approved payroll run search (useApprovedRunPicker)
 *   AuthorityPicker      — remittance authority static list (useAuthorityPicker)
 *   BudgetCategoryPicker — budget category search (useBudgetCategoryPicker)
 *
 * Each picker:
 *   - Debounces its own search (300 ms) so it doesn't fire on every keystroke
 *   - Maps the backend DTO to EntityPicker's { value, label, sub? } shape
 *   - Surfaces loading + error states to EntityPicker's props
 *   - Accepts all EntityPicker props (required/disabled/error/placeholder)
 *
 * Usage:
 *   <EmployeePicker
 *     label="Employee"
 *     value={employeeId}
 *     onChange={setEmployeeId}
 *     error={errors.employeeId}
 *     required
 *   />
 */

import type { VNode } from 'preact';
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { EntityPicker, type EntityOption } from '@ui';
import {
  useEmployeePicker,
  useCostCentrePicker,
  useApprovedRunPicker,
  useAuthorityPicker,
  useBudgetCategoryPicker,
} from '@api/finance/lookups';
import type { CostCentreOption } from '@api/finance/pickers';

// ── Shared debounce hook ──────────────────────────────────────────────────────

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delayMs]);

  return debounced;
}

// ── Shared picker props (common subset from EntityPickerProps) ─────────────────

export interface BasePickerProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
}

// ── EmployeePicker ────────────────────────────────────────────────────────────

/**
 * Employee picker — searchable by name, employee number, or position.
 * Displays "{fullName} · {employeeNo}" with position as sub-line.
 */
export function EmployeePicker({
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  placeholder = 'Search employees…',
  id,
}: BasePickerProps): VNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading } = useEmployeePicker(debouncedSearch || undefined);

  const options: EntityOption[] = (data ?? []).map(e => ({
    value: e.id,
    label: e.employeeNo
      ? `${e.fullName} · ${e.employeeNo}`
      : e.fullName,
    sub: e.position ?? undefined,
  }));

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
  }, []);

  return (
    <EntityPicker
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      loading={isLoading}
      onSearch={handleSearch}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      required={required}
    />
  );
}

// ── CostCentrePicker ──────────────────────────────────────────────────────────

/**
 * Cost-centre picker — backed by finance_cost_centers (HR Org-managed).
 * Displays "{code} — {name}" with department as sub-line.
 */
export function CostCentrePicker({
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  placeholder = 'Search cost centres…',
  id,
}: BasePickerProps): VNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading } = useCostCentrePicker(debouncedSearch || undefined);

  const options: EntityOption[] = (data ?? []).map((cc: CostCentreOption) => ({
    value: cc.id,
    label: cc.code
      ? `${cc.code} — ${cc.name}`
      : cc.name,
    sub: cc.department ?? undefined,
  }));

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
  }, []);

  return (
    <EntityPicker
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      loading={isLoading}
      onSearch={handleSearch}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      required={required}
    />
  );
}

// ── ApprovedRunPicker ─────────────────────────────────────────────────────────

/**
 * Approved payroll run picker — shows only runs in approved/locked/exported state.
 * Replaces the old free-text run UUID input in Remittances + Disbursements wizards.
 * Displays "{runNo}" with period + employee count as sub-line.
 */
export function ApprovedRunPicker({
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  placeholder = 'Search payroll runs…',
  id,
}: BasePickerProps): VNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading } = useApprovedRunPicker(debouncedSearch || undefined);

  const options: EntityOption[] = (data ?? []).map(r => ({
    value: r.id,
    label: r.runNo,
    sub: `${r.periodMonth.slice(0, 7)} · ${r.payFrequency} · ${r.employeeCount} employees`,
  }));

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
  }, []);

  return (
    <EntityPicker
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      loading={isLoading}
      onSearch={handleSearch}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      required={required}
    />
  );
}

// ── AuthorityPicker ───────────────────────────────────────────────────────────

/**
 * Remittance authority picker — PAYE-BIR, NIS-NIBTT, Health Surcharge.
 * Static list (no search needed). Displays the authority label + description.
 */
export function AuthorityPicker({
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  placeholder = 'Select authority…',
  id,
}: BasePickerProps): VNode {
  const { data, isLoading } = useAuthorityPicker();

  const options: EntityOption[] = (data ?? []).map(a => ({
    value: a.value,
    label: a.label,
    sub:   a.description,
  }));

  return (
    <EntityPicker
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      loading={isLoading}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      required={required}
    />
  );
}

// ── BudgetCategoryPicker ──────────────────────────────────────────────────────

/**
 * Budget category picker — distinct categories from live data + built-in fallbacks.
 * Replaces free-text category input in the budget upsert wizard.
 */
export function BudgetCategoryPicker({
  label,
  value,
  onChange,
  error,
  disabled,
  required,
  placeholder = 'Search categories…',
  id,
}: BasePickerProps): VNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading } = useBudgetCategoryPicker(debouncedSearch || undefined);

  const options: EntityOption[] = (data ?? []).map(c => ({
    value: c.value,
    label: c.label,
  }));

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
  }, []);

  return (
    <EntityPicker
      id={id}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      loading={isLoading}
      onSearch={handleSearch}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      required={required}
    />
  );
}
