/**
 * src/components/sections/HR/ImportWizard.tsx
 *
 * HR ▸ Employee Master — Import Employees wizard (v36 §8), wired to the EXISTING
 * backend (routes/hrEmployeeImport.ts) via src/api/hr/employeeImport.ts. No new
 * backend: the 7 steps map 1:1 to the real endpoints
 * (upload → map → policy → validate → resolve → commit → report). The browser
 * sends the raw CSV as base64; the backend parses/stages/validates/commits.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { hrImportApi, type ImportMode, type ImportPolicy, type ImportUploadResult, type ImportValidateSummary, type ImportReport } from '@api/hr/employeeImport';
import { useHrOrgUnits, useHrSites } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';

const STEPS = [
  { label: 'Upload',   sub: 'CSV file',          icon: 'fa-file-arrow-up' },
  { label: 'Map',      sub: 'Columns → fields',  icon: 'fa-diagram-project' },
  { label: 'Policy',   sub: 'Duplicates & gates', icon: 'fa-sliders' },
  { label: 'Validate', sub: 'Check rows',        icon: 'fa-list-check' },
  { label: 'Resolve',  sub: 'Exceptions',        icon: 'fa-screwdriver-wrench' },
  { label: 'Review',   sub: 'Import plan',       icon: 'fa-clipboard-check' },
  { label: 'Commit',   sub: 'Create & report',   icon: 'fa-circle-check' },
];

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'workerType', label: 'Worker Type (employee/contractor)', required: true },
  { key: 'department', label: 'Department (name or id)', required: true },
  { key: 'position', label: 'Position / Job Title', required: true },
  { key: 'employeeNumber', label: 'Employee No.' },
  { key: 'email', label: 'Work Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'supervisor', label: 'Supervisor (username / emp# / name)' },
  { key: 'site', label: 'Site (id)' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'employmentType', label: 'Employment Type' },
  { key: 'role', label: 'Role' },
  { key: 'nisNumber', label: 'NIS Number' },
  { key: 'birFileNumber', label: 'BIR File Number' },
  { key: 'td1Received', label: 'TD1 Received (yes/no)' },
];

const DEFAULT_POLICY: ImportPolicy = {
  duplicateEmployeeNumber: 'skip', duplicateUsername: 'skip',
  missingSupervisor: 'warn', missingStatutory: 'warn', createLogins: true, contractorRows: 'import',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function ImportWizard({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }): VNode {
  const qc = useQueryClient();
  const orgQ = useHrOrgUnits();
  const siteQ = useHrSites();

  const [step, setStep] = useState(0);
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

  const setMap = (field: string, col: string) => setMapping(p => ({ ...p, [field]: col }));
  const setPol = <K extends keyof ImportPolicy>(k: K, v: ImportPolicy[K]) => setPolicy(p => ({ ...p, [k]: v }));

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
      setBatch(res);
      // Auto-guess mapping: match a SIOMAC field to a column by case-insensitive name.
      const guess: Record<string, string> = {};
      for (const f of FIELDS) {
        const hit = res.columns.find(c => c.toLowerCase().replace(/[^a-z0-9]/g, '') === f.key.toLowerCase());
        if (hit) guess[f.key] = hit;
      }
      setMapping(guess);
      setStep(1);
    });
  }
  function doMap() {
    const missing = FIELDS.filter(f => f.required && !mapping[f.key]);
    if (missing.length) { setError(`Map the required fields: ${missing.map(f => f.label).join(', ')}`); return; }
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    void guard(async () => { await hrImportApi.mapFields({ batchId: batch!.batchId, mapping: clean }); setStep(2); });
  }
  function doPolicy() { void guard(async () => { await hrImportApi.setPolicy({ batchId: batch!.batchId, policy }); setStep(3); }); }
  function doValidate() { void guard(async () => { const r = await hrImportApi.validate({ batchId: batch!.batchId }); setSummary(r.summary); setStep(4); await loadReport(); }); }
  async function loadReport() { const r = await hrImportApi.report({ batchId: batch!.batchId }); setReport(r); }
  function resolve(rowId: string, action: 'skip' | 'ignore') { void guard(async () => { await hrImportApi.resolveRow({ batchId: batch!.batchId, rowId, action }); await loadReport(); }); }
  function doCommit() {
    void guard(async () => {
      const r = await hrImportApi.commit({ batchId: batch!.batchId });
      setDone({ created: r.created, updated: r.updated, failed: r.failed });
      await loadReport();
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.all });
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

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal lg employee-wizard-modal" onClick={e => e.stopPropagation()}>
        <div class="modal-head"><h3>Import Employees</h3><button class="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
        <div class="modal-body wizard-body">
          <div class="wizard-shell">
            <aside class="wizard-rail">
              <div class="wizard-rail-head"><span class="wizard-head-dot" /><div><strong>Bulk Import</strong><span>{batch ? batch.batchNo : 'CSV → employees'}</span></div></div>
              <div class="wizard-rail-menu">
                {STEPS.map((s, i) => (
                  <button type="button" class={`wizard-step ${step === i ? 'active' : ''}`} disabled={i > step} onClick={() => i <= step && setStep(i)}>
                    <span class="wizard-step-ico"><i class={`fas ${s.icon}`} /></span><div><strong>{s.label}</strong><span>{s.sub}</span></div>
                  </button>
                ))}
              </div>
            </aside>

            <div class="wizard-content">
              {error && <div class="warning-card">{error}</div>}

              {step === 0 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>1. Upload CSV</h4><p>The file is parsed server-side. Headers become mappable columns.</p></div></div>
                  <div class="form-grid">
                    <div class="form-field full"><label>CSV file</label><input type="file" accept=".csv,text/csv" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} /></div>
                    <div class="form-field"><label>Import Mode</label><select value={importMode} onChange={e => setImportMode(e.currentTarget.value as ImportMode)}><option value="create">Create only</option><option value="update">Update existing</option><option value="create_update">Create + update</option></select></div>
                    <div class="form-field" />
                    <div class="form-field"><label>Default Department (optional)</label><select value={defaultDepartmentId} onChange={e => setDefaultDepartmentId(e.currentTarget.value)}><option value="">None</option>{(orgQ.data ?? []).map(o => <option value={o.id}>{o.name}</option>)}</select></div>
                    <div class="form-field"><label>Default Site (optional)</label><select value={defaultSiteId} onChange={e => setDefaultSiteId(e.currentTarget.value)}><option value="">None</option>{(siteQ.data ?? []).map(s => <option value={s.id}>{s.name}</option>)}</select></div>
                  </div>
                </section>
              )}

              {step === 1 && batch && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>2. Map Columns</h4><p>Match SIOMAC fields to your CSV columns. Required fields are marked *.</p></div></div>
                  <div class="form-grid">
                    {FIELDS.map(f => (
                      <div class="form-field">
                        <label>{f.label}{f.required ? ' *' : ''}</label>
                        <select value={mapping[f.key] ?? ''} onChange={e => setMap(f.key, e.currentTarget.value)}>
                          <option value="">— not mapped —</option>
                          {batch.columns.map(c => <option value={c}>{c}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {step === 2 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>3. Import Policy</h4><p>How duplicates and missing data are handled during validation.</p></div></div>
                  <div class="form-grid">
                    <div class="form-field"><label>Duplicate employee no.</label><select value={policy.duplicateEmployeeNumber} onChange={e => setPol('duplicateEmployeeNumber', e.currentTarget.value as ImportPolicy['duplicateEmployeeNumber'])}><option value="skip">Skip</option><option value="update">Update</option><option value="error">Error</option></select></div>
                    <div class="form-field"><label>Duplicate username</label><select value={policy.duplicateUsername} onChange={e => setPol('duplicateUsername', e.currentTarget.value as ImportPolicy['duplicateUsername'])}><option value="skip">Skip</option><option value="error">Error</option></select></div>
                    <div class="form-field"><label>Missing supervisor</label><select value={policy.missingSupervisor} onChange={e => setPol('missingSupervisor', e.currentTarget.value as ImportPolicy['missingSupervisor'])}><option value="allow">Allow</option><option value="warn">Warn</option><option value="block">Block</option></select></div>
                    <div class="form-field"><label>Missing statutory</label><select value={policy.missingStatutory} onChange={e => setPol('missingStatutory', e.currentTarget.value as ImportPolicy['missingStatutory'])}><option value="allow">Allow</option><option value="warn">Warn</option><option value="block">Block</option></select></div>
                    <div class="form-field"><label>Contractor rows</label><select value={policy.contractorRows} onChange={e => setPol('contractorRows', e.currentTarget.value as ImportPolicy['contractorRows'])}><option value="import">Import</option><option value="reject">Reject</option></select></div>
                    <label class="checkbox-row"><input type="checkbox" checked={policy.createLogins} onChange={e => setPol('createLogins', e.currentTarget.checked)} /><span>Create login accounts</span></label>
                  </div>
                </section>
              )}

              {step === 3 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>4. Validate Records</h4><p>Runs the backend validator against your mapping + policy.</p></div></div>
                  {summary
                    ? <div class="summary-list">
                        <div class="summary-item"><span>Ready</span><strong>{summary.ready}</strong></div>
                        <div class="summary-item"><span>Warnings</span><strong>{summary.warning}</strong></div>
                        <div class="summary-item"><span>Blocked</span><strong>{summary.blocked}</strong></div>
                        <div class="summary-item"><span>Duplicates</span><strong>{summary.duplicate}</strong></div>
                      </div>
                    : <div class="info-strip">Click “Run Validation” to check all rows.</div>}
                </section>
              )}

              {step === 4 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>5. Resolve Exceptions</h4><p>Skip blocked rows, or ignore warnings to include them. Edit rows in the source file and re-import for full fixes.</p></div></div>
                  {exceptionRows.length
                    ? <table class="mini-table"><thead><tr><th>Row</th><th>Name</th><th>Status</th><th>Issue</th><th>Action</th></tr></thead><tbody>
                        {exceptionRows.map(r => (
                          <tr>
                            <td>{r.row_no}</td>
                            <td>{`${r.mapped_data['firstName'] ?? ''} ${r.mapped_data['lastName'] ?? ''}`.trim() || '—'}</td>
                            <td>{cap(r.status)}</td>
                            <td>{(errorsByRow.get(r.id) ?? []).join('; ') || '—'}</td>
                            <td style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              {r.status === 'warning' && <button class="small-outline" type="button" disabled={busy} onClick={() => resolve(r.id, 'ignore')}>Ignore</button>}
                              <button class="small-outline" type="button" disabled={busy} onClick={() => resolve(r.id, 'skip')}>Skip</button>
                            </td>
                          </tr>
                        ))}
                      </tbody></table>
                    : <div class="info-strip">No exceptions to resolve. {summary ? `${summary.ready} rows ready.` : ''}</div>}
                </section>
              )}

              {step === 5 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>6. Review Import Plan</h4><p>Only “ready” rows (plus ignored warnings) are committed.</p></div></div>
                  <div class="summary-list">
                    <div class="summary-item"><span>File</span><strong>{batch?.batchNo} · {batch?.totalRows} rows</strong></div>
                    <div class="summary-item"><span>Mode</span><strong>{cap(importMode)}</strong></div>
                    <div class="summary-item"><span>Ready to commit</span><strong>{summary?.ready ?? 0}</strong></div>
                    <div class="summary-item"><span>Warnings</span><strong>{summary?.warning ?? 0}</strong></div>
                    <div class="summary-item"><span>Blocked (skipped)</span><strong>{summary?.blocked ?? 0}</strong></div>
                  </div>
                  <div class="warning-card">Committing provisions each ready row via the standard create path (app_users + Auth + statutory + assignment), emitting the same events/audit as a single create.</div>
                </section>
              )}

              {step === 6 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>7. Commit &amp; Report</h4><p>Creates the employees and returns the final report.</p></div></div>
                  {done
                    ? <div class="summary-list">
                        <div class="summary-item"><span>Created</span><strong>{done.created}</strong></div>
                        <div class="summary-item"><span>Updated</span><strong>{done.updated}</strong></div>
                        <div class="summary-item"><span>Failed</span><strong>{done.failed}</strong></div>
                      </div>
                    : <div class="info-strip">Click “Commit Import” to create the employees.</div>}
                </section>
              )}
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="left-note">{`Step ${step + 1} of ${STEPS.length}`}</span>
          {step > 0 && !done && <button class="secondary-btn" type="button" onClick={() => setStep(step - 1)}>Back</button>}
          {step === 0 && <button class="primary-btn" type="button" disabled={busy} onClick={doUpload}>{busy ? 'Uploading…' : 'Upload & Continue'}</button>}
          {step === 1 && <button class="primary-btn" type="button" disabled={busy} onClick={doMap}>{busy ? 'Saving…' : 'Save Mapping'}</button>}
          {step === 2 && <button class="primary-btn" type="button" disabled={busy} onClick={doPolicy}>{busy ? 'Saving…' : 'Apply Policy'}</button>}
          {step === 3 && <button class="primary-btn" type="button" disabled={busy} onClick={doValidate}>{busy ? 'Validating…' : summary ? 'Re-validate' : 'Run Validation'}</button>}
          {step === 4 && <button class="primary-btn" type="button" onClick={() => setStep(5)}>Continue</button>}
          {step === 5 && <button class="primary-btn" type="button" onClick={() => setStep(6)}>Continue</button>}
          {step === 6 && (done
            ? <button class="primary-btn" type="button" onClick={onClose}>Done</button>
            : <button class="primary-btn" type="button" disabled={busy} onClick={doCommit}>{busy ? 'Committing…' : 'Commit Import'}</button>)}
        </div>
      </div>
    </div>
  );
}
