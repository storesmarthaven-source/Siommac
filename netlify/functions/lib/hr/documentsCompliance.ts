/**
 * netlify/functions/lib/hr/documentsCompliance.ts
 *
 * Computed compliance: required document types per employee × their actual docs.
 * NO denormalized checklist table — computed on-the-fly from requirements + documents.
 */

import { sb } from '../db';
import { filterVisibleDocs } from './documentsCore';
import { listRequirements, type DocumentRequirement } from './documentsRequirements';

type ComplianceState = 'present_verified' | 'present_unverified' | 'expired' | 'missing';

export interface EmployeeComplianceRow {
  employeeId: string;
  employeeName: string | null;
  requirementId: string;
  requiredType: string;
  label: string;
  state: ComplianceState;
  documentId: string | null;
  expiryDate: string | null;
}

export interface ComplianceOverviewRow {
  employeeId: string;
  employeeName: string | null;
  departmentName: string | null;
  missingCount: number;
  expiredCount: number;
  totalRequired: number;
}

interface EmpProfile {
  id: string;
  full_name: string | null;
  role: string;
  employment_type: string | null;
  department_id: string | null;
}

interface DocRow {
  id: string;
  employee_id: string;
  document_type: string;
  status: string;
  expiry_date: string | null;
  confidentiality: string;
}

/** Returns the set of requirements that apply to this employee. */
export function resolveRequiredTypesForEmployee(
  emp: EmpProfile,
  requirements: DocumentRequirement[],
): DocumentRequirement[] {
  return requirements.filter(req => {
    if (!req.isActive) return false;
    switch (req.appliesToScope) {
      case 'all':             return true;
      case 'role':            return req.appliesToValue === emp.role;
      case 'employment_type': return req.appliesToValue === (emp.employment_type ?? '');
      case 'department':      return req.appliesToValue === (emp.department_id ?? '');
      default:                return false;
    }
  });
}

function classifyDoc(
  doc: DocRow | undefined,
  req: DocumentRequirement,
  today: string,
): ComplianceState {
  if (!doc) return 'missing';
  if (doc.status === 'archived') return 'missing'; // archived = no longer valid
  if (req.requiresExpiry && !doc.expiry_date) return 'present_unverified'; // treat no-expiry as unverified
  if (doc.expiry_date && doc.expiry_date < today) return 'expired';
  if (doc.status === 'verified') return 'present_verified';
  return 'present_unverified';
}

/**
 * Per-employee compliance: one row per required type.
 * Confidentiality gate applied to fetched docs.
 */
export async function getComplianceForEmployee(
  canSeeSensitive: boolean,
  employeeId: string,
): Promise<EmployeeComplianceRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [empRes, requirements, docsRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, role, employment_type, department_id')
      .eq('id', employeeId).maybeSingle<EmpProfile>(),
    listRequirements(true),
    sb.from('hr_employee_documents').select('id, employee_id, document_type, status, expiry_date, confidentiality')
      .eq('employee_id', employeeId).neq('status', 'archived'),
  ]);

  const emp = empRes.data;
  if (!emp) return [];

  const visibleDocs = filterVisibleDocs(
    (docsRes.data ?? []) as DocRow[],
    canSeeSensitive,
  );

  // Build a map: document_type → most-recent doc (prefer verified → uploaded over rejected)
  const docByType = new Map<string, DocRow>();
  for (const d of visibleDocs) {
    const existing = docByType.get(d.document_type);
    if (!existing) { docByType.set(d.document_type, d); continue; }
    // Prefer verified over non-verified
    if (d.status === 'verified' && existing.status !== 'verified') docByType.set(d.document_type, d);
  }

  const applicableReqs = resolveRequiredTypesForEmployee(emp, requirements);

  return applicableReqs.map(req => {
    const doc = docByType.get(req.documentType);
    const state = classifyDoc(doc, req, today);
    return {
      employeeId: emp.id,
      employeeName: emp.full_name,
      requirementId: req.id,
      requiredType: req.documentType,
      label: req.label,
      state,
      documentId: doc?.id ?? null,
      expiryDate: doc?.expiry_date ?? null,
    };
  });
}

/**
 * Cross-employee compliance overview: employees who have at least one
 * missing or expired required document. Used for the Requirements tab view.
 */
export async function getComplianceOverview(
  canSeeSensitive: boolean,
  filters: { departmentId?: string; employeeId?: string } = {},
): Promise<ComplianceOverviewRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const requirements = await listRequirements(true);
  if (!requirements.length) return [];

  // Load employees
  let empQ = sb
    .from('app_users')
    .select('id, full_name, role, employment_type, department_id')
    .neq('role', 'superadmin');
  if (filters.departmentId) empQ = empQ.eq('department_id', filters.departmentId);
  if (filters.employeeId)   empQ = empQ.eq('id', filters.employeeId);
  const { data: emps } = await empQ;
  const employees = (emps ?? []) as EmpProfile[];
  if (!employees.length) return [];

  // Load all non-archived docs for these employees
  const empIds = employees.map(e => e.id);
  const { data: allDocs } = await sb
    .from('hr_employee_documents')
    .select('id, employee_id, document_type, status, expiry_date, confidentiality')
    .in('employee_id', empIds)
    .neq('status', 'archived');

  const visibleDocs = filterVisibleDocs((allDocs ?? []) as DocRow[], canSeeSensitive);

  // Group docs by employee
  const docsByEmp = new Map<string, DocRow[]>();
  for (const d of visibleDocs) {
    const list = docsByEmp.get(d.employee_id) ?? [];
    list.push(d);
    docsByEmp.set(d.employee_id, list);
  }

  // Resolve department names
  const deptIds = Array.from(new Set(employees.map(e => e.department_id).filter((x): x is string => !!x)));
  const deptMap = new Map<string, string>();
  if (deptIds.length) {
    const { data: depts } = await sb.from('departments').select('id, name').in('id', deptIds);
    for (const d of (depts ?? []) as { id: string; name: string }[]) deptMap.set(d.id, d.name);
  }

  const result: ComplianceOverviewRow[] = [];

  for (const emp of employees) {
    const applicableReqs = resolveRequiredTypesForEmployee(emp, requirements);
    if (!applicableReqs.length) continue;

    const empDocs = docsByEmp.get(emp.id) ?? [];
    // Best doc per type
    const docByType = new Map<string, DocRow>();
    for (const d of empDocs) {
      const existing = docByType.get(d.document_type);
      if (!existing) { docByType.set(d.document_type, d); continue; }
      if (d.status === 'verified' && existing.status !== 'verified') docByType.set(d.document_type, d);
    }

    let missingCount = 0;
    let expiredCount = 0;
    for (const req of applicableReqs) {
      const state = classifyDoc(docByType.get(req.documentType), req, today);
      if (state === 'missing') missingCount++;
      else if (state === 'expired') expiredCount++;
    }

    result.push({
      employeeId: emp.id,
      employeeName: emp.full_name,
      departmentName: emp.department_id ? (deptMap.get(emp.department_id) ?? null) : null,
      missingCount,
      expiredCount,
      totalRequired: applicableReqs.length,
    });
  }

  // Only return employees with at least one issue
  return result.filter(r => r.missingCount > 0 || r.expiredCount > 0);
}

/** Count of employees with missing required documents — used in stats. */
export async function countMissingRequired(canSeeSensitive: boolean): Promise<number> {
  const overview = await getComplianceOverview(canSeeSensitive);
  return overview.length;
}
