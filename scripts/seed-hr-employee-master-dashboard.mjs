/**
 * Employee Profile / Employee Master demo seed.
 *
 * Populates canonical profile sources for six standing demo employees. Five are
 * substantially complete; each scenario deliberately leaves a small, named gap
 * so Needs Attention, tab indicators, document health and readiness can be
 * exercised with real data.
 *
 * Idempotency: every satellite row has a fixed UUID or natural conflict key.
 * The script updates only the curated employee ids below and seed-tagged rows.
 *
 * Run: npm run seed:hr-dashboard
 */
import 'dotenv/config';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SEED = 'hr-employee-profile-demo-v2';
const CHECK_ONLY = process.argv.includes('--check');
const DAY_MS = 86_400_000;
const today = new Date();
const date = offset => new Date(today.getTime() + (offset * DAY_MS)).toISOString().slice(0, 10);

const profiles = [
  {
    id: 'USR-40397F16', no: 'EMP-0021', first: 'Damani', last: 'Baptiste',
    position: 'Project Manager', scenario: 'document_and_training',
    phone: '+1 (868) 555-0147', mobile: '+1 (868) 335-7821',
  },
  {
    id: 'USR-FINMGR', no: 'EMP-FIN01', first: 'Camille', last: 'Rampersad',
    position: 'Finance Manager', scenario: 'assignment_gaps',
    phone: '+1 (868) 555-0112', mobile: null,
  },
  {
    id: 'USR-AF908865', no: 'EMP-0022', first: 'Darrell', last: 'Browne',
    position: 'Operations Supervisor', scenario: 'payroll_blocked',
    phone: '+1 (868) 555-0164', mobile: '+1 (868) 333-4018',
  },
  {
    id: 'USR-CADF0CB1', no: 'EMP-0023', first: 'Rylon', last: 'Baptiste',
    position: 'Maintenance Manager', scenario: 'ready',
    phone: '+1 (868) 555-0181', mobile: '+1 (868) 333-4044',
  },
  {
    id: 'USR-983E7314', no: 'EMP-0019', first: 'Kern', last: 'Lewis',
    position: 'Site Lead', scenario: 'training_due',
    phone: '+1 (868) 555-0195', mobile: '+1 (868) 333-4190',
  },
  {
    id: 'USR-76C36139', no: 'EMP-0020', first: 'Nectus', last: 'Alexander',
    position: 'Field Technician', scenario: 'missing_document',
    phone: '+1 (868) 555-0138', mobile: '+1 (868) 333-4272',
  },
];

const uuid = (domain, index) =>
  `e${domain}000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

async function checked(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

async function main() {
  const employees = await checked(
    'load curated employees',
    sb.from('app_users').select('id').in('id', profiles.map(p => p.id)),
  );
  const found = new Set(employees.map(row => row.id));
  const missing = profiles.filter(p => !found.has(p.id)).map(p => p.id);
  if (missing.length) {
    throw new Error(`Standing demo employees are missing: ${missing.join(', ')}.`);
  }

  const actors = await checked(
    'load seed actor',
    sb.from('app_users').select('id,role').in('role', ['superadmin', 'admin']).eq('status', 'active'),
  );
  const actor = actors.find(row => row.role === 'superadmin') ?? actors[0];
  if (!actor) throw new Error('An active superadmin or admin is required as seed actor.');

  const [
    departments, sites, payGroups, accessProfiles, controls, currentAssignments,
    currentBanks, currentAccess, currentPayAssignments,
  ] =
  await Promise.all([
    checked('load departments', sb.from('departments').select('id,name').order('name').limit(6)),
    checked('load sites', sb.from('project_sites').select('id,name').order('name').limit(6)),
    checked('load pay groups', sb.from('finance_pay_groups').select('id,name').eq('active', true).limit(1)),
    checked('load access profiles', sb.from('hr_access_profiles').select('id,label').eq('is_active', true).order('sort_order').limit(1)),
    checked('load readiness controls', sb.from('hr_readiness_controls').select('id,control_key,domain').eq('is_active', true)),
    checked('load current assignments', sb.from('hr_employee_assignments')
      .select('id,employee_id').in('employee_id', profiles.map(p => p.id)).eq('is_current', true)),
    checked('load primary bank accounts', sb.from('finance_employee_bank_accounts')
      .select('id,employee_id').in('employee_id', profiles.map(p => p.id)).eq('is_primary', true).eq('is_active', true)),
    checked('load active access assignments', sb.from('hr_employee_access_assignments')
      .select('id,employee_id').in('employee_id', profiles.map(p => p.id)).eq('status', 'active')),
    checked('load current pay group assignments', sb.from('finance_employee_pay_group_assignments')
      .select('employee_id,pay_group_id').in('employee_id', profiles.map(p => p.id)).is('effective_to', null)),
  ]);
  if (!departments.length || !sites.length || !controls.length) {
    throw new Error('Seed requires departments, project sites, and readiness controls.');
  }
  if (CHECK_ONLY) {
    process.stdout.write('Employee Profile seed preflight passed (read-only).\n');
    process.stdout.write(`  employees=${employees.length}, departments=${departments.length}, sites=${sites.length}, controls=${controls.length}\n`);
    process.stdout.write(`  payGroups=${payGroups.length}, accessProfiles=${accessProfiles.length}\n`);
    return;
  }

  const completeSupervisor = profiles[0].id;
  const assignmentByEmployee = new Map(currentAssignments.map(row => [row.employee_id, row.id]));
  const bankByEmployee = new Map(currentBanks.map(row => [row.employee_id, row.id]));
  const accessByEmployee = new Map(currentAccess.map(row => [row.employee_id, row.id]));
  const payGroupByEmployee = new Map(currentPayAssignments.map(row => [row.employee_id, row.pay_group_id]));
  for (const [index, profile] of profiles.entries()) {
    const hasAssignmentGap = profile.scenario === 'assignment_gaps';
    const department = departments[index % departments.length];
    const site = sites[index % sites.length];
    await checked(`update ${profile.id}`, sb.from('app_users').update({
      full_name: `${profile.first} ${profile.last}`,
      display_name: `${profile.first} ${profile.last}`,
      first_name: profile.first,
      last_name: profile.last,
      email: `${profile.first.toLowerCase()}.${profile.last.toLowerCase()}@siomac.com`,
      phone: profile.phone,
      mobile_phone: profile.mobile,
      employee_number: profile.no,
      position: profile.position,
      employment_type: profile.id === 'USR-76C36139' ? 'contractor' : 'employee',
      employment_status: 'active',
      start_date: `202${index % 4}-0${(index % 8) + 1}-12`,
      work_schedule: index === 5 ? 'Field Rotation' : 'Monday–Friday',
      cost_center: `CC-${String(index + 1).padStart(3, '0')}`,
      employee_grade: index < 2 ? 'G8' : index < 4 ? 'G6' : 'G4',
      probation_end_date: index > 3 ? date(60 + index) : null,
      emergency_contact_name: `${profile.last} Family Contact`,
      emergency_contact_phone: `+1 (868) 680-${String(2100 + index)}`,
      emergency_contact_relationship: index % 2 ? 'parent' : 'spouse',
      department_id: hasAssignmentGap ? null : department.id,
      site_id: hasAssignmentGap ? null : site.id,
      supervisor_id: hasAssignmentGap ? null : completeSupervisor,
    }).eq('id', profile.id));

    await checked(`upsert assignment ${profile.id}`, sb.from('hr_employee_assignments').upsert({
      id: assignmentByEmployee.get(profile.id) ?? uuid('1', index + 1),
      employee_id: profile.id,
      department_id: hasAssignmentGap ? null : department.id,
      site_id: hasAssignmentGap ? null : site.id,
      supervisor_id: hasAssignmentGap ? null : completeSupervisor,
      assignment_type: 'primary',
      effective_from: `2024-07-01`,
      effective_to: null,
      is_current: true,
      weekly_hours: index === 5 ? 44 : 40,
      fte: index === 5 ? 0.8 : 1,
      notice_period_days: index < 2 ? 30 : 14,
      created_by: actor.id,
      metadata: { seed: SEED, scenario: profile.scenario },
    }, { onConflict: 'id' }));

    await checked(`upsert statutory ${profile.id}`, sb.from('hr_employee_statutory_profiles').upsert({
      employee_id: profile.id,
      jurisdiction: 'TT',
      currency: 'TTD',
      nis_number: profile.scenario === 'payroll_blocked' ? null : `NIS-DEMO-${profile.no}`,
      nis_status: profile.scenario === 'payroll_blocked' ? 'pending_verification' : 'verified',
      nis_applicable: true,
      payroll_ready_status: profile.scenario === 'payroll_blocked' ? 'blocked' : 'ready',
      missing_blockers: profile.scenario === 'payroll_blocked'
        ? ['nis verification', 'bank account confirmation'] : [],
      finance_handoff_eligible: profile.scenario !== 'payroll_blocked',
      verified_by: profile.scenario === 'payroll_blocked' ? null : actor.id,
      verified_at: profile.scenario === 'payroll_blocked' ? null : new Date().toISOString(),
      created_by: actor.id,
      updated_by: actor.id,
    }, { onConflict: 'employee_id,jurisdiction' }));

    await checked(`upsert bank account ${profile.id}`, sb.from('finance_employee_bank_accounts').upsert({
      id: bankByEmployee.get(profile.id) ?? uuid('2', index + 1),
      employee_id: profile.id,
      bank_name: index % 2 ? 'First Citizens Bank' : 'Republic Bank',
      branch: 'Port of Spain',
      account_type: 'savings',
      account_number: `10000000${index + 1}`,
      account_number_masked: `•••• ${String(4821 + index)}`,
      is_primary: true,
      is_active: true,
      created_by: actor.id,
      metadata: { seed: SEED, reverificationDue: profile.id === 'USR-40397F16' },
    }, { onConflict: 'id' }));

    if (payGroups[0] && !payGroupByEmployee.has(profile.id)) {
      await checked(`upsert pay group ${profile.id}`, sb.from('finance_employee_pay_group_assignments').upsert({
        employee_id: profile.id,
        pay_group_id: payGroups[0].id,
        effective_from: '2024-07-01',
        effective_to: null,
        created_by: actor.id,
      }, { onConflict: 'employee_id,pay_group_id,effective_from' }));
    }

    if (accessProfiles[0]) {
      const assignmentId = accessByEmployee.get(profile.id) ?? uuid('3', index + 1);
      await checked(`upsert access assignment ${profile.id}`, sb.from('hr_employee_access_assignments').upsert({
        id: assignmentId,
        employee_id: profile.id,
        access_profile_id: accessProfiles[0].id,
        assignment_type: 'profile',
        status: 'active',
        effective_from: '2024-07-01',
        granted_by: actor.id,
        metadata: { seed: SEED },
      }, { onConflict: 'id' }));
      await checked(`upsert access scope ${profile.id}`, sb.from('hr_employee_access_scopes').upsert({
        id: uuid('4', index + 1),
        assignment_id: assignmentId,
        scope_type: 'organisation',
        scope_id: null,
      }, { onConflict: 'id' }));
    }
  }

  const existingRequirements = await checked(
    'load existing document requirements',
    sb.from('hr_document_requirements').select('id,document_type,applies_to_scope,applies_to_value')
      .in('document_type', ['employment_contract', 'national_id', 'bank_confirmation']),
  );
  const requirementRows = [
    ['employment_contract', 'Employment Contract', false, 'confidential'],
    ['national_id', 'National Identification', true, 'restricted_hr'],
    ['bank_confirmation', 'Bank Account Confirmation', false, 'confidential'],
  ].map(([documentType, label, requiresExpiry, minConfidentiality], index) => ({
    id: existingRequirements.find(row =>
      row.document_type === documentType
      && row.applies_to_scope === 'all'
      && row.applies_to_value === null)?.id ?? uuid('5', index + 1),
    document_type: documentType,
    label,
    applies_to_scope: 'all',
    applies_to_value: null,
    requires_expiry: requiresExpiry,
    reminder_days: [30, 7, 0],
    min_confidentiality: minConfidentiality,
    is_active: true,
    created_by: actor.id,
    metadata: { seed: SEED },
  }));
  await checked('upsert document requirements', sb.from('hr_document_requirements')
    .upsert(requirementRows, { onConflict: 'id' }));

  const documentRows = [];
  for (const [employeeIndex, profile] of profiles.entries()) {
    for (const [typeIndex, req] of requirementRows.entries()) {
      if (profile.scenario === 'missing_document' && req.document_type === 'national_id') continue;
      documentRows.push({
        id: `e6${String(employeeIndex + 1).padStart(2, '0')}0000-${String(typeIndex + 1).padStart(4, '0')}-4000-8000-${String((employeeIndex * 10) + typeIndex + 1).padStart(12, '0')}`,
        employee_id: profile.id,
        document_type: req.document_type,
        title: req.label,
        file_path: `demo/${profile.id}/${req.document_type}.pdf`,
        file_name: `${req.document_type}.pdf`,
        mime_type: 'application/pdf',
        file_size: 128_000 + (employeeIndex * 1_000),
        confidentiality: req.min_confidentiality,
        status: profile.scenario === 'document_and_training' && req.document_type === 'bank_confirmation'
          ? 'uploaded' : 'verified',
        expiry_date: req.requires_expiry
          ? (profile.scenario === 'document_and_training' ? date(18) : date(365)) : null,
        uploaded_by: actor.id,
        verified_by: actor.id,
        verified_at: new Date().toISOString(),
        metadata: { seed: SEED },
      });
    }
  }
  await checked('upsert employee documents', sb.from('hr_employee_documents')
    .upsert(documentRows, { onConflict: 'id' }));

  const certificates = profiles.map((profile, index) => {
    const due = ['document_and_training', 'training_due'].includes(profile.scenario);
    return {
      id: uuid('7', index + 1),
      certificate_no: `CERT-PROFILE-${String(index + 1).padStart(3, '0')}`,
      worker_id: profile.id,
      worker_name: `${profile.first} ${profile.last}`,
      course_name: 'Workplace Safety Refresher',
      provider: 'SIOMAC Learning',
      issued_at: date(-330),
      expires_at: due ? date(21 + index) : date(300 + index),
      status: due ? 'due_soon' : 'current',
      verification_required: false,
      verified_by: actor.id,
      verified_at: new Date().toISOString(),
      created_by: actor.id,
      metadata: { seed: SEED },
    };
  });
  await checked('upsert training certificates', sb.from('hse_worker_certificates')
    .upsert(certificates, { onConflict: 'id' }));

  const instances = [];
  for (const [employeeIndex, profile] of profiles.entries()) {
    for (const [controlIndex, control] of controls.entries()) {
      const blocked =
        (profile.scenario === 'assignment_gaps' && control.domain === 'assignment')
        || (profile.scenario === 'payroll_blocked' && ['payroll', 'statutory'].includes(control.domain))
        || (['document_and_training', 'training_due'].includes(profile.scenario) && control.domain === 'training')
        || (profile.scenario === 'missing_document' && control.domain === 'documents');
      instances.push({
        id: `e8${String(employeeIndex + 1).padStart(2, '0')}0000-${String(controlIndex + 1).padStart(4, '0')}-4000-8000-${String((employeeIndex * 100) + controlIndex + 1).padStart(12, '0')}`,
        employee_id: profile.id,
        control_id: control.id,
        state: blocked ? 'open' : 'ready',
        percent: blocked ? 0 : 100,
      });
    }
  }
  await checked('upsert readiness instances', sb.from('hr_readiness_control_instances')
    .upsert(instances, { onConflict: 'employee_id,control_id' }));

  const activity = profiles.flatMap((profile, index) => [
    {
      id: `e9${String(index + 1).padStart(2, '0')}0000-0001-4000-8000-${String((index * 10) + 1).padStart(12, '0')}`,
      employee_id: profile.id, submodule_key: 'employment', record_id: profile.id,
      actor_id: actor.id, action: 'Employment profile reviewed',
      reason: 'Employee Profile demo seed', metadata: { seed: SEED },
    },
    {
      id: `e9${String(index + 1).padStart(2, '0')}0000-0002-4000-8000-${String((index * 10) + 2).padStart(12, '0')}`,
      employee_id: profile.id, submodule_key: 'documents', record_id: profile.id,
      actor_id: actor.id, action: 'Document health evaluated',
      reason: 'Employee Profile demo seed', metadata: { seed: SEED },
    },
  ]);
  await checked('upsert employee activity', sb.from('hr_audit_log').upsert(activity, { onConflict: 'id' }));

  const employeeIds = profiles.map(profile => profile.id);
  const [verifiedProfiles, verifiedAssignments, verifiedStatutory, verifiedBanks, verifiedDocuments, verifiedReadiness] =
    await Promise.all([
      checked('verify profile rows', sb.from('app_users')
        .select('id,employee_number,department_id,site_id,supervisor_id,email,phone,mobile_phone')
        .in('id', employeeIds)),
      checked('verify current assignments', sb.from('hr_employee_assignments')
        .select('employee_id,weekly_hours,fte,notice_period_days').in('employee_id', employeeIds).eq('is_current', true)),
      checked('verify statutory profiles', sb.from('hr_employee_statutory_profiles')
        .select('employee_id,nis_status,payroll_ready_status,missing_blockers')
        .in('employee_id', employeeIds).eq('jurisdiction', 'TT')),
      checked('verify bank accounts', sb.from('finance_employee_bank_accounts')
        .select('employee_id,bank_name,account_number_masked').in('employee_id', employeeIds)
        .eq('is_primary', true).eq('is_active', true)),
      checked('verify documents', sb.from('hr_employee_documents')
        .select('employee_id,document_type,status,expiry_date').in('employee_id', employeeIds)
        .contains('metadata', { seed: SEED })),
      checked('verify readiness instances', sb.from('hr_readiness_control_instances')
        .select('employee_id,state,percent').in('employee_id', employeeIds)),
    ]);
  const expected = {
    profiles: profiles.length,
    assignments: profiles.length,
    statutory: profiles.length,
    banks: profiles.length,
    documents: documentRows.length,
    readiness: instances.length,
  };
  const actual = {
    profiles: verifiedProfiles.length,
    assignments: verifiedAssignments.length,
    statutory: verifiedStatutory.length,
    banks: verifiedBanks.length,
    documents: verifiedDocuments.length,
    readiness: verifiedReadiness.length,
  };
  for (const key of Object.keys(expected)) {
    if (actual[key] < expected[key]) {
      throw new Error(`verification ${key}: expected at least ${expected[key]}, got ${actual[key]}.`);
    }
  }

  process.stdout.write('Employee Profile demo data refreshed.\n');
  process.stdout.write(`  verified rows: ${JSON.stringify(actual)}\n`);
  for (const profile of profiles) {
    process.stdout.write(`  ${profile.no} ${profile.first} ${profile.last}: ${profile.scenario}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`Employee Profile seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
