/**
 * src/components/sections/HR/ImportWizard.tsx
 *
 * HR ▸ Employee Master — Import Employees wizard (v36 §8) on the shared @ui
 * <WizardShell>. The 6 steps map to the real backend flow
 * (upload + policy → map → validate → resolve → review → commit); the browser
 * sends the raw CSV as base64 and the backend parses/stages/validates/commits.
 * The v36 Upload screen's Import-policy + Batch-ownership fields persist on the
 * batch policy jsonb; Default Record Status drives the created record's status.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { WizardShell, type WizardStepDef } from '@ui';
import { hrImportApi, type ImportMode, type ImportPolicy, type ImportUploadResult, type ImportValidateSummary, type ImportReport } from '@api/hr/employeeImport';
import { useHrOrgUnits, useHrSites } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';

const STEPS: WizardStepDef[] = [
  { key: 'upload',   label: 'Upload',   sub: 'File and import policy', icon: 'fa-file-arrow-up' },
  { key: 'map',      label: 'Map',      sub: 'Column mapping',         icon: 'fa-diagram-project' },
  { key: 'validate', label: 'Validate', sub: 'Rules and blockers',     icon: 'fa-list-check' },
  { key: 'resolve',  label: 'Resolve',  sub: 'Duplicates and warnings', icon: 'fa-screwdriver-wrench' },
  { key: 'review',   label: 'Review',   sub: 'Create/update plan',     icon: 'fa-clipboard-check' },
  { key: 'commit',   label: 'Commit',   sub: 'Batch and report',       icon: 'fa-circle-check' },
];
const ORDER = STEPS.map(s => s.key);

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'workerType', label: 'Worker Type', required: true },
  { key: 'department', label: 'Department', required: true },
  { key: 'position', label: 'Position / Job Title', required: true },
  { key: 'employeeNumber', label: 'Employee No.' },
  { key: 'email', label: 'Work Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'dateOfBirth', label: 'Date of Birth' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'site', label: 'Site' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'employmentType', label: 'Employment Type' },
  { key: 'role', label: 'Role' },
  { key: 'nisNumber', label: 'NIS Number' },
  { key: 'birFileNumber', label: 'BIR File Number' },
  { key: 'td1Received', label: 'TD1 Received' },
];
const REQUIRED_COUNT = FIELDS.filter(f => f.required).length;
const PAYROLL_KEYS = new Set(['nisNumber', 'birFileNumber', 'td1Received']);
const MAP_FILTERS = [['all', 'All fields'], ['required', 'Required'], ['payroll', 'Payroll'], ['warnings', 'Warnings']] as const;

/** Auto-guess a field→column mapping by case-insensitive name match. */
function guessMapping(cols: string[]): Record<string, string> {
  const g: Record<string, string> = {};
  for (const f of FIELDS) {
    const hit = cols.find(c => c.toLowerCase().replace(/[^a-z0-9]/g, '') === f.key.toLowerCase());
    if (hit) g[f.key] = hit;
  }
  return g;
}

const DEFAULT_POLICY: ImportPolicy = {
  duplicateEmployeeNumber: 'skip', duplicateUsername: 'skip',
  missingSupervisor: 'warn', missingStatutory: 'warn', createLogins: true, contractorRows: 'import',
  defaultRecordStatus: 'active', batchOwner: 'HR Operations', reviewRequired: true,
  notifyOnComplete: 'HR + Payroll', batchReference: '',
};
const BATCH_OWNERS = ['HR Operations', 'HR Manager', 'Payroll', 'Site HR'];
const NOTIFY_TARGETS = ['HR + Payroll', 'HR only', 'HR + Finance', 'None'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function Fld({ label, children, full }: { label: string; children: ComponentChildren; full?: boolean }): VNode {
  return <div class={`form-field ${full ? 'full' : ''}`}><label>{label}</label>{children}</div>;
}
function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ComponentChildren }): VNode {
  return (
    <section class="form-section" id={`wz-imp-${id}`}>
      <div class="form-section-head"><div><h4>{title}</h4><p>{desc}</p></div></div>
      {children}
    </section>
  );
}

export function ImportWizard({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }): VNode {
  const qc = useQueryClient();
  const orgQ = useHrOrgUnits();
  const siteQ = useHrSites();

  const [step, setStep] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [defaultDepartmentId, setDefaultDepartmentId] = useState('');
  const [defaultSiteId, setDefaultSiteId] = useState('');

  const [batch, setBatch] = useState<ImportUploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<ImportPolicy>(DEFAULT_POLICY);
  const [summary, setSummary] = useState<ImportValidateSummary | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number; failed: number } | null>(null);
  const [mapFilter, setMapFilter] = useState<'all' | 'required' | 'payroll' | 'warnings'>('all');

  const setMap = (field: string, col: string) => setMapping(p => ({ ...p, [field]: col }));
  const setPol = <K extends keyof ImportPolicy>(k: K, v: ImportPolicy[K]) => setPolicy(p => ({ ...p, [k]: v }));
  const mappedCount = FIELDS.filter(f => mapping[f.key]).length;

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(false); }
  }

  function doUpload() {
    if (!file) { setError('Choose a CSV file first.'); return; }
    void guard(async () => {
      const b64 = await fileToBase64(file);
      const res = await hrImportApi.upload({
        fileName: file.name, fileType: 'csv', fileBase64: b64, importMode,
        defaultDepartmentId: defaultDepartmentId || null, defaultSiteId: defaultSiteId || null,
      });
      await hrImportApi.setPolicy({ batchId: res.batchId, policy });
      setBatch(res);
      setMapping(guessMapping(res.columns));
      setStep('map');
    });
  }
  function doMap() {
    const missing = FIELDS.filter(f => f.required && !mapping[f.key]);
    if (missing.length) { setError(`Map the required fields: ${missing.map(f => f.label).join(', ')}`); return; }
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    void guard(async () => { await hrImportApi.mapFields({ batchId: batch!.batchId, mapping: clean }); setStep('validate'); });
  }
  async function loadReport() { const r = await hrImportApi.report({ batchId: batch!.batchId }); setReport(r); }
  function doValidate() { void guard(async () => { const r = await hrImportApi.validate({ batchId: batch!.batchId }); setSummary(r.summary); await loadReport(); setStep('resolve'); }); }
  function resolve(rowId: string, action: 'skip' | 'ignore') { void guard(async () => { await hrImportApi.resolveRow({ batchId: batch!.batchId, rowId, action }); await loadReport(); }); }
  function doCommit() {
    void guard(async () => {
      const r = await hrImportApi.commit({ batchId: batch!.batchId });
      setDone({ created: r.created, updated: r.updated, failed: r.failed });
      await loadReport();
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.all });
      onToast(`Import committed — ${r.created} created, ${r.updated} updated, ${r.failed} failed`);
    });
  }

  const exceptionRows = useMemo(
    () => (report?.rows ?? []).filter(r => ['blocked', 'warning', 'duplicate'].includes(r.status)),
    [report],
  );
  const errorsByRow = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of report?.errors ?? []) { const list = m.get(e.row_id) ?? []; list.push(e.message); m.set(e.row_id, list); }
    return m;
  }, [report]);

  const reachable: Record<string, boolean> = {
    upload: true, map: !!batch, validate: !!batch, resolve: !!summary, review: !!summary, commit: !!summary,
  };

  const info = [
    { title: 'Current Batch', rows: [
      { label: 'Import mode', value: cap(importMode) },
      { label: 'Rows detected', value: batch ? String(batch.totalRows) : '—' },
      { label: 'Required fields', value: `${mappedCount >= REQUIRED_COUNT ? REQUIRED_COUNT : mappedCount} / ${REQUIRED_COUNT} mapped` },
      { label: 'Ready rows', value: summary ? String(summary.ready) : '—', highlight: true },
      { label: 'Blocked rows', value: summary ? String(summary.blocked) : '—' },
    ] },
    { title: 'Permissions & Audit', rows: [
      { label: 'Permission', value: 'HR controlled' },
      { label: 'Batch owner', value: policy.batchOwner ?? '—' },
      { label: 'Review required', value: policy.reviewRequired ? 'Yes — before commit' : 'No' },
    ] },
  ];

  const footer = ((): ComponentChildren => {
    if (done) return <button class="ui-btn-primary" type="button" onClick={onClose}>Done</button>;
    const cancel = <button class="ui-btn-secondary" type="button" onClick={onClose}>Cancel</button>;
    const back = step !== 'upload' ? <button class="ui-btn-secondary" type="button" onClick={() => setStep(ORDER[Math.max(0, ORDER.indexOf(step) - 1)]!)}>Back</button> : null;
    const primary =
      step === 'upload'   ? <button class="ui-btn-primary" type="button" disabled={busy} onClick={doUpload}>{busy ? 'Uploading…' : 'Upload & Continue'}</button>
    : step === 'map'      ? <button class="ui-btn-primary" type="button" disabled={busy} onClick={doMap}>{busy ? 'Saving…' : 'Save Mapping'}</button>
    : step === 'validate' ? <button class="ui-btn-primary" type="button" disabled={busy} onClick={doValidate}>{busy ? 'Validating…' : summary ? 'Re-validate' : 'Run Validation'}</button>
    : step === 'resolve'  ? <button class="ui-btn-primary" type="button" onClick={() => setStep('review')}>Continue</button>
    : step === 'review'   ? <button class="ui-btn-primary" type="button" onClick={() => setStep('commit')}>Continue</button>
    :                       <button class="ui-btn-primary" type="button" disabled={busy} onClick={doCommit}>{busy ? 'Committing…' : 'Commit Import'}</button>;
    return <>{cancel}{back}{primary}</>;
  })();

  return (
    <WizardShell
      open title="Import Employees" railTitle="Employee Import" railSubtitle="Bulk create/update HR records safely"
      steps={STEPS} activeStep={step} onStep={k => reachable[k] && setStep(k)} stepEnabled={k => !!reachable[k]}
      info={info} footNote="Validates rows before employee records are created." footer={footer} onClose={onClose}
    >
      {error && <div class="warning-card">{error}</div>}

      {step === 'upload' && (
        <>
          <Section id="upload" title="1. Upload Employee File" desc="Upload the employee file, set import behavior, and define how incomplete payroll data should be handled.">
            <div class="form-grid">
              <Fld label="CSV file" full><input type="file" accept=".csv,text/csv" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} /></Fld>
            </div>
          </Section>
          <Section id="policy" title="Import policy" desc="Controls create/update behavior and duplicate protection.">
            <div class="form-grid">
              <Fld label="Import Mode"><select value={importMode} onChange={e => setImportMode(e.currentTarget.value as ImportMode)}><option value="create">Create only</option><option value="update">Update existing</option><option value="create_update">Create + update</option></select></Fld>
              <Fld label="Duplicate Handling"><select value={policy.duplicateEmployeeNumber} onChange={e => setPol('duplicateEmployeeNumber', e.currentTarget.value as ImportPolicy['duplicateEmployeeNumber'])}><option value="skip">Block / skip duplicate employee</option><option value="update">Update duplicate</option><option value="error">Error on duplicate</option></select></Fld>
              <Fld label="Missing Statutory Fields"><select value={policy.missingStatutory} onChange={e => setPol('missingStatutory', e.currentTarget.value as ImportPolicy['missingStatutory'])}><option value="allow">Allow</option><option value="warn">Allow · draft payroll block</option><option value="block">Block</option></select></Fld>
              <Fld label="Default Record Status"><select value={policy.defaultRecordStatus} onChange={e => setPol('defaultRecordStatus', e.currentTarget.value as ImportPolicy['defaultRecordStatus'])}><option value="active">Active</option><option value="draft">Draft</option></select></Fld>
              <Fld label="Missing supervisor"><select value={policy.missingSupervisor} onChange={e => setPol('missingSupervisor', e.currentTarget.value as ImportPolicy['missingSupervisor'])}><option value="allow">Allow</option><option value="warn">Warn</option><option value="block">Block</option></select></Fld>
              <Fld label="Contractor rows"><select value={policy.contractorRows} onChange={e => setPol('contractorRows', e.currentTarget.value as ImportPolicy['contractorRows'])}><option value="import">Import</option><option value="reject">Reject</option></select></Fld>
              <label class="checkbox-row"><input type="checkbox" checked={policy.createLogins} onChange={e => setPol('createLogins', e.currentTarget.checked)} /> Create login accounts</label>
            </div>
          </Section>
          <Section id="batch" title="Batch ownership" desc="Defines who owns cleanup, approval, and the final report.">
            <div class="form-grid">
              <Fld label="Batch Owner"><select value={policy.batchOwner} onChange={e => setPol('batchOwner', e.currentTarget.value)}>{BATCH_OWNERS.map(o => <option value={o}>{o}</option>)}</select></Fld>
              <Fld label="Review Required"><select value={policy.reviewRequired ? 'yes' : 'no'} onChange={e => setPol('reviewRequired', e.currentTarget.value === 'yes')}><option value="yes">Yes — before commit</option><option value="no">No</option></select></Fld>
              <Fld label="Notify On Complete"><select value={policy.notifyOnComplete} onChange={e => setPol('notifyOnComplete', e.currentTarget.value)}>{NOTIFY_TARGETS.map(o => <option value={o}>{o}</option>)}</select></Fld>
              <Fld label="Batch Reference"><input value={policy.batchReference} placeholder="IMP-EMP-2026-004" onInput={e => setPol('batchReference', e.currentTarget.value)} /></Fld>
              <Fld label="Default Department (optional)"><select value={defaultDepartmentId} onChange={e => setDefaultDepartmentId(e.currentTarget.value)}><option value="">None</option>{(orgQ.data ?? []).map(o => <option value={o.id}>{o.name}</option>)}</select></Fld>
              <Fld label="Default Site (optional)"><select value={defaultSiteId} onChange={e => setDefaultSiteId(e.currentTarget.value)}><option value="">None</option>{(siteQ.data ?? []).map(s => <option value={s.id}>{s.name}</option>)}</select></Fld>
            </div>
          </Section>
        </>
      )}

      {step === 'map' && batch && (() => {
        const sample = batch.sample?.[0] ?? {};
        const rows = FIELDS.filter(f =>
          mapFilter === 'all' ? true
          : mapFilter === 'required' ? f.required
          : mapFilter === 'payroll' ? PAYROLL_KEYS.has(f.key)
          : /* warnings */ f.required && !mapping[f.key]);
        return (
          <Section id="map" title="2. Map Columns" desc="Map every Employee Master field to the correct uploaded column. Required fields must be mapped before validation can pass.">
            <div class="employee-toolbar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {MAP_FILTERS.map(([k, label]) => (
                  <button type="button" class={`chip-btn${mapFilter === k ? ' active' : ''}`} onClick={() => setMapFilter(k)}>{label}</button>
                ))}
              </div>
              <div class="ui-mini-btn-row">
                <button class="ui-mini-btn" type="button" onClick={() => setMapping(guessMapping(batch.columns))}>Auto-map</button>
                <button class="ui-mini-btn" type="button" onClick={() => setMapping({})}>Clear unmapped</button>
              </div>
            </div>
            <table class="mini-table" style={{ marginTop: '10px' }}>
              <thead><tr><th>File column</th><th>Sample value</th><th>Maps to</th><th>Requirement</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(f => (
                  <tr>
                    <td>{mapping[f.key] ?? <span style={{ color: '#94a3b8' }}>— pick —</span>}</td>
                    <td style={{ color: '#64748b' }}>{(sample[mapping[f.key] ?? ''] ?? '').slice(0, 24) || '—'}</td>
                    <td>
                      <select value={mapping[f.key] ?? ''} onChange={e => setMap(f.key, e.currentTarget.value)} style={{ minHeight: '32px', width: '100%' }}>
                        <option value="">— not mapped — ({f.label})</option>
                        {batch.columns.map(c => <option value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td>{f.required ? 'Required' : 'Optional'}</td>
                    <td><span class={`pill ${mapping[f.key] ? 'green' : f.required ? 'amber' : 'gray'}`}>{mapping[f.key] ? 'Mapped' : f.required ? 'Required' : 'Unmapped'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        );
      })()}

      {step === 'validate' && (
        <Section id="validate" title="3. Validate Records" desc="Runs the backend validator against your mapping + policy.">
          {summary
            ? <div class="summary-list">
                <div class="summary-item"><span>Ready</span><strong>{summary.ready}</strong></div>
                <div class="summary-item"><span>Warnings</span><strong>{summary.warning}</strong></div>
                <div class="summary-item"><span>Blocked</span><strong>{summary.blocked}</strong></div>
                <div class="summary-item"><span>Duplicates</span><strong>{summary.duplicate}</strong></div>
              </div>
            : <div class="info-strip">Click “Run Validation” to check all rows against the rules and policy.</div>}
        </Section>
      )}

      {step === 'resolve' && (
        <Section id="resolve" title="4. Resolve Exceptions" desc="Skip blocked rows, or ignore warnings to include them. Edit rows in the source file and re-import for full fixes.">
          {exceptionRows.length
            ? <table class="mini-table"><thead><tr><th>Row</th><th>Name</th><th>Status</th><th>Issue</th><th /></tr></thead><tbody>
                {exceptionRows.map(r => (
                  <tr>
                    <td>{r.row_no}</td>
                    <td>{`${r.mapped_data.firstName ?? ''} ${r.mapped_data.lastName ?? ''}`.trim() || '—'}</td>
                    <td><span class={`pill ${r.status === 'blocked' ? 'red' : r.status === 'duplicate' ? 'purple' : 'amber'}`}>{cap(r.status)}</span></td>
                    <td>{(errorsByRow.get(r.id) ?? []).join('; ') || '—'}</td>
                    <td><div class="ui-mini-btn-row">
                      {r.status === 'warning' && <button class="ui-mini-btn" type="button" disabled={busy} onClick={() => resolve(r.id, 'ignore')}>Ignore</button>}
                      <button class="ui-mini-btn" type="button" disabled={busy} onClick={() => resolve(r.id, 'skip')}>Skip</button>
                    </div></td>
                  </tr>
                ))}
              </tbody></table>
            : <div class="info-strip">No exceptions to resolve. {summary ? `${summary.ready} rows ready.` : ''}</div>}
        </Section>
      )}

      {step === 'review' && (
        <Section id="review" title="5. Review Create/Update Plan" desc="Only “ready” rows (plus ignored warnings) are committed.">
          <div class="summary-list">
            <div class="summary-item"><span>File</span><strong>{batch?.batchNo} · {batch?.totalRows} rows</strong></div>
            <div class="summary-item"><span>Mode · Record status</span><strong>{cap(importMode)} · {cap(policy.defaultRecordStatus ?? 'active')}</strong></div>
            <div class="summary-item"><span>Batch owner · Reference</span><strong>{policy.batchOwner}{policy.batchReference ? ` · ${policy.batchReference}` : ''}</strong></div>
            <div class="summary-item"><span>Ready to commit</span><strong>{summary?.ready ?? 0}</strong></div>
            <div class="summary-item"><span>Warnings · Blocked</span><strong>{summary?.warning ?? 0} · {summary?.blocked ?? 0}</strong></div>
          </div>
          <div class="warning-card">Committing provisions each ready row via the standard create path (app_users + Auth + statutory + assignment), emitting the same events/audit as a single create. Notify on complete: {policy.notifyOnComplete}.</div>
        </Section>
      )}

      {step === 'commit' && (
        <Section id="commit" title="6. Commit &amp; Report" desc="Creates the employees and returns the final report.">
          {done
            ? <div class="summary-list">
                <div class="summary-item"><span>Created</span><strong>{done.created}</strong></div>
                <div class="summary-item"><span>Updated</span><strong>{done.updated}</strong></div>
                <div class="summary-item"><span>Failed</span><strong>{done.failed}</strong></div>
              </div>
            : <div class="info-strip">Click “Commit Import” to create the employees from the ready rows.</div>}
        </Section>
      )}
    </WizardShell>
  );
}
