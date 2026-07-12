/**
 * src/components/sections/Finance/StatNisImportPage.tsx
 *
 * Finance ▸ Statutory Configuration ▸ Import NIS Contribution Bands — FULL PAGE WIZARD.
 *
 * Design pivot (2026-07-08): replaces the old `StatNisImportDialog` CSV-paste modal
 * with the 4-step wizard from import-nis-classes.html, in the .sfp design language:
 *   1. Upload File    — CSV drag-drop / browse / paste
 *   2. Validate Data  — per-row validation (error/warning/valid) + rules + column map
 *   3. Review Changes — new vs update counts against the version's existing bands
 *   4. Import Complete
 *
 * Bound to the REAL T&T model (memory statutory-nis-model-reconciliation): CSV columns
 * class_no, weekly_min, weekly_max (blank = open-ended top band), employee_weekly,
 * employer_weekly. Server (importNisClasses) is the authority; its errors surface here.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useRef } from 'preact/hooks';
import { toast } from '@store';
import {
  useVersionDetail, useNisClasses, useStatutoryMutation, financeStatutoryApi,
} from '@api/finance/statutory';
import { Stepper, type StepperStep } from '@ui';
import { fmtMoney, humanize } from './financeShared';
import {
  IconUpload, IconOk, IconBad, IconAlert, IconInfo, IconArrow, IconDoc, StatFormShell,
} from './_shared/sfpKit';
import './statutoryForms.css';

const TEMPLATE = 'class_no,weekly_min,weekly_max,employee_weekly,employer_weekly\n1,0,299.99,12.95,19.40\n2,300,399.99,17.15,25.70\n3,400,,21.35,32.00';
const STEPS: StepperStep[] = [
  { key: 'upload',   label: 'Upload File',     description: 'Choose a CSV of bands' },
  { key: 'validate', label: 'Validate Data',   description: 'Check rows for issues' },
  { key: 'review',   label: 'Review Changes',  description: 'Confirm new & updated' },
  { key: 'complete', label: 'Import Complete', description: 'Result summary' },
];

type Severity = 'error' | 'warning' | 'ok';
interface ValRow {
  rowNum: number;
  classCode: string;
  classNo: number | null;
  weeklyMin: number | null;
  weeklyMax: number | null;   // null = open-ended
  employeeWeekly: number | null;
  employerWeekly: number | null;
  severity: Severity;
  issue: string;
  message: string;
  fix: string;
}

const pf = (s: string | undefined): number => parseFloat((s ?? '').trim());
const norm = (h: string): string => h.trim().toLowerCase().replace(/_/g, '');

/** Parse + validate CSV against the real T&T band model. */
function validateCsv(text: string): { rows: ValRow[]; headerError: string | null } {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return { rows: [], headerError: 'No data rows found. Expected a header row plus at least one data row.' };
  const header = lines[0]!.split(',').map(norm);
  const idx = (k: string) => header.indexOf(norm(k));
  const required = ['class_no', 'weekly_min', 'employee_weekly', 'employer_weekly'];
  const missing = required.filter(k => idx(k) < 0);
  if (missing.length) return { rows: [], headerError: `Missing required column(s): ${missing.join(', ')}.` };
  const iMaxPresent = idx('weekly_max') >= 0;

  const rows: ValRow[] = [];
  const seenClassNo = new Map<number, number>(); // classNo → first rowNum

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    const rowNum = i;
    const classNoRaw = (cols[idx('class_no')] ?? '').trim();
    const classNo = /^\d+$/.test(classNoRaw) ? parseInt(classNoRaw, 10) : NaN;
    const weeklyMin = pf(cols[idx('weekly_min')]);
    const maxStr = iMaxPresent ? (cols[idx('weekly_max')] ?? '').trim() : '';
    const weeklyMax = maxStr === '' ? null : pf(maxStr);
    const employeeWeekly = pf(cols[idx('employee_weekly')]);
    const employerWeekly = pf(cols[idx('employer_weekly')]);

    let severity: Severity = 'ok';
    let issue = '', message = '', fix = '';
    const flagErr = (is: string, m: string, fx: string) => { if (severity !== 'error') { severity = 'error'; issue = is; message = m; fix = fx; } };
    const flagWarn = (is: string, m: string, fx: string) => { if (severity === 'ok') { severity = 'warning'; issue = is; message = m; fix = fx; } };

    if (!Number.isInteger(classNo) || classNo < 1) flagErr('Invalid Class No', `Class number '${classNoRaw}' is not a whole number ≥ 1.`, 'Use a whole number ≥ 1.');
    if (isNaN(weeklyMin) || weeklyMin < 0) flagErr('Missing Min', 'Weekly minimum is missing or negative.', 'Provide a weekly minimum ≥ 0.');
    if (maxStr !== '' && isNaN(weeklyMax!)) flagErr('Invalid Max', `Weekly maximum '${maxStr}' is not a number.`, 'Use a number or leave blank for the top band.');
    if (weeklyMax != null && !isNaN(weeklyMin) && weeklyMax <= weeklyMin) flagErr('Bad Band', 'Weekly maximum is not greater than the minimum.', 'Weekly maximum must exceed the minimum.');
    if (isNaN(employeeWeekly) || employeeWeekly < 0) flagErr('Missing Rate', 'Employee weekly contribution is missing or invalid.', 'Provide an employee contribution ≥ 0.');
    if (isNaN(employerWeekly) || employerWeekly < 0) flagErr('Missing Rate', 'Employer weekly contribution is missing or invalid.', 'Provide an employer contribution ≥ 0.');

    if (Number.isInteger(classNo) && classNo >= 1) {
      if (seenClassNo.has(classNo)) flagErr('Duplicate Code', `Duplicate class number '${classNo}' (first seen in row ${seenClassNo.get(classNo)}).`, 'Use a unique class number.');
      else seenClassNo.set(classNo, rowNum);
    }

    rows.push({ rowNum, classCode: classNoRaw || '—', classNo: Number.isNaN(classNo) ? null : classNo, weeklyMin: isNaN(weeklyMin) ? null : weeklyMin, weeklyMax, employeeWeekly: isNaN(employeeWeekly) ? null : employeeWeekly, employerWeekly: isNaN(employerWeekly) ? null : employerWeekly, severity, issue, message, fix });
  }

  // Cross-row: overlapping bands + multiple open-ended (warnings, only for otherwise-clean rows).
  let openEndedSeen = false;
  for (const r of rows) {
    if (r.severity === 'error' || r.weeklyMin == null) continue;
    const aMax = r.weeklyMax ?? Number.POSITIVE_INFINITY;
    if (r.weeklyMax == null) {
      if (openEndedSeen && r.severity === 'ok') { r.severity = 'warning'; r.issue = 'Open-ended Band'; r.message = 'More than one band has no maximum.'; r.fix = 'Only the top band should be open-ended.'; }
      openEndedSeen = true;
    }
    for (const o of rows) {
      if (o === r || o.severity === 'error' || o.weeklyMin == null) continue;
      const oMax = o.weeklyMax ?? Number.POSITIVE_INFINITY;
      if (r.weeklyMin < oMax && o.weeklyMin < aMax && r.severity === 'ok') {
        r.severity = 'warning'; r.issue = 'Overlapping Band'; r.message = `Band overlaps class ${o.classNo}.`; r.fix = 'Adjust band range to avoid overlap.';
        break;
      }
    }
  }
  return { rows, headerError: null };
}

const COL_MAP: readonly { csv: string; to: string }[] = [
  { csv: 'class_no', to: 'Class Number' },
  { csv: 'weekly_min', to: 'Weekly Minimum' },
  { csv: 'weekly_max', to: 'Weekly Maximum' },
  { csv: 'employee_weekly', to: 'Employee Weekly' },
  { csv: 'employer_weekly', to: 'Employer Weekly' },
];
const RULES: readonly { tone: string; name: string; desc: string }[] = [
  { tone: 'red', name: 'Duplicate Class No', desc: 'Class numbers must be unique.' },
  { tone: 'amber', name: 'Overlapping Bands', desc: 'Band ranges must not overlap.' },
  { tone: 'blue', name: 'Missing Contributions', desc: 'Employee & employer weekly amounts are required.' },
  { tone: 'violet', name: 'Open-ended Band', desc: 'Only the top band may omit a maximum.' },
];

export function StatNisImportPage({ versionId, onClose }: { versionId: string; onClose: () => void }): VNode {
  const detailQ = useVersionDetail(versionId);
  const version = detailQ.data;
  const existingQ = useNisClasses(versionId);
  const existingNos = useMemo(() => new Set((existingQ.data ?? []).map(c => c.classNo)), [existingQ.data]);
  const importMut = useStatutoryMutation(financeStatutoryApi.importNisClasses);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { row: number; message: string }[] } | null>(null);

  const { rows, headerError } = useMemo(() => validateCsv(csvText), [csvText]);
  const errorCount = rows.filter(r => r.severity === 'error').length;
  const warnCount = rows.filter(r => r.severity === 'warning').length;
  const okCount = rows.filter(r => r.severity === 'ok').length;
  const importable = rows.filter(r => r.severity !== 'error');
  const newCount = importable.filter(r => r.classNo != null && !existingNos.has(r.classNo)).length;
  const updateCount = importable.filter(r => r.classNo != null && existingNos.has(r.classNo)).length;

  const loadText = (text: string): void => { setCsvText(text); if (rowsHaveData(text)) setStep(1); };
  const onFile = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setFileName(file.name); setFileSize(file.size); loadText(String(reader.result)); };
    reader.readAsText(file);
  };

  const doImport = async (): Promise<void> => {
    const payload = importable.map(r => ({ classNo: r.classNo!, weeklyMin: r.weeklyMin!, weeklyMax: r.weeklyMax, employeeWeekly: r.employeeWeekly!, employerWeekly: r.employerWeekly! }));
    if (!payload.length) return;
    try {
      const res = await importMut.mutateAsync({ statutoryVersionId: versionId, rows: payload });
      setResult(res);
      setStep(3);
      if (res.errors.length === 0) toast(`${res.imported} NIS contribution band${res.imported !== 1 ? 's' : ''} imported.`);
      else toast.error(`Imported with ${res.errors.length} server error(s).`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const busy = importMut.isPending;

  return (
    <StatFormShell
      icon={<IconUpload size={20} />}
      title="Import NIS Contribution Bands"
      sub={version ? `Upload a CSV of contribution bands and validate before importing into ${version.label}.` : 'Upload a CSV of contribution bands and validate the data before importing.'}
      statusLabel={version ? humanize(version.status) : null}
      onBack={onClose}
      stepper={<Stepper steps={STEPS} activeIndex={step} onStep={setStep} ariaLabel="Import steps" />}
    >
          <div style={{ padding: '22px 26px' }}>
            {/* STEP 1 — Upload */}
            {step === 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: fileName ? '1fr 1fr' : '1fr', gap: 16 }}>
                <div class="sfp-scard">
                  <h3>Upload File</h3>
                  <div class={`sfp-dropzone${dragging ? ' drag' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer?.files?.[0]); }}>
                    <span class="cloud"><IconUpload size={30} /></span>
                    <p>Drag and drop your CSV file here</p>
                    <span class="sfp-dz-or">or</span>
                    <button type="button" class="sfp-browse" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>Browse Files</button>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                      onChange={e => onFile((e.currentTarget).files?.[0] ?? undefined)} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" class="sfp-browse" onClick={() => { setFileName('template.csv'); setFileSize(TEMPLATE.length); loadText(TEMPLATE); }}>Load sample</button>
                    <a class="sfp-browse" style={{ textDecoration: 'none' }} download="nis_bands_template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download template</a>
                  </div>
                  <p class="sfp-hint" style={{ marginTop: 10 }}>Columns: <code>class_no, weekly_min, weekly_max</code> (blank = open-ended top band), <code>employee_weekly, employer_weekly</code>.</p>
                </div>

                {fileName && (
                  <div class="sfp-scard">
                    <h3>Or paste CSV</h3>
                    <div class="sfp-filecard" style={{ marginBottom: 12 }}>
                      <span class="sfp-file-ic"><IconDoc size={18} /></span>
                      <div class="sfp-file-meta"><div class="fn">{fileName}</div><div class="fs">{(fileSize / 1024).toFixed(1)} KB · {rows.length} row{rows.length !== 1 ? 's' : ''} detected</div></div>
                      <span style={{ color: '#16b364', display: 'inline-flex' }}><IconOk /></span>
                    </div>
                    <textarea class="sfp-textarea" value={csvText} onInput={e => setCsvText((e.currentTarget).value)} />
                    {headerError && <p class="sfp-err-msg" style={{ marginTop: 8 }}>{headerError}</p>}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2 — Validate */}
            {step === 1 && (
              <div class="sfp-body" style={{ padding: 0 }}>
                <div>
                  <div class="sfp-scard" style={{ marginBottom: 16 }}>
                    <h3 class="sub">Import Validation Summary</h3>
                    <div class="sfp-stats">
                      <div class="sfp-stat"><span class="sic blue"><IconDoc size={18} /></span><div><div class="snum">{rows.length}</div><div class="slbl">Rows Detected</div></div></div>
                      <div class="sfp-stat"><span class="sic green"><IconOk /></span><div><div class="snum">{okCount}</div><div class="slbl">Valid</div></div></div>
                      <div class="sfp-stat"><span class="sic amber"><IconAlert /></span><div><div class="snum">{warnCount}</div><div class="slbl">Warnings</div></div></div>
                      <div class="sfp-stat"><span class="sic red"><IconBad /></span><div><div class="snum">{errorCount}</div><div class="slbl">Errors</div></div></div>
                    </div>
                  </div>
                  <div class="sfp-scard">
                    <h3 class="sub">Validation Details</h3>
                    <table class="sfp-vtable">
                      <thead><tr><th style={{ width: 50 }}>Row</th><th style={{ width: 80 }}>Class</th><th style={{ width: 130 }}>Issue</th><th>Message</th><th style={{ width: 90 }}>Status</th></tr></thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.rowNum}>
                            <td class="rownum">{r.rowNum}</td>
                            <td class="ccode">{r.classCode}</td>
                            <td>{r.severity === 'ok' ? <span class="dash">—</span> : <span class={`sfp-chip ${r.severity}`}>{r.issue}</span>}</td>
                            <td>{r.severity === 'ok' ? 'Row is valid.' : <span>{r.message} <span style={{ color: '#8590a2' }}>{r.fix}</span></span>}</td>
                            <td><span class={`sfp-stt ${r.severity}`}>{r.severity === 'ok' ? <><IconOk size={14} />Valid</> : r.severity === 'warning' ? <><IconAlert size={14} />Warning</> : <><IconBad size={14} />Error</>}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="sfp-aside">
                  <div class="sfp-scard">
                    <h3 class="sub">Validation Rules</h3>
                    {RULES.map(rl => (
                      <div class="sfp-rule-row" key={rl.name}>
                        <span class={`sfp-rule-ic ${rl.tone}`}><IconInfo /></span>
                        <div><div class="sfp-rule-nm">{rl.name}</div><div class="sfp-rule-ds">{rl.desc}</div></div>
                      </div>
                    ))}
                  </div>
                  <div class="sfp-scard">
                    <h3 class="sub">Column Mapping</h3>
                    <div class="sfp-map-row" style={{ fontWeight: 500, color: '#8590a2', fontSize: 11 }}><span>CSV COLUMN</span><span>MAPPED TO</span><span /></div>
                    {COL_MAP.map(m => (
                      <div class="sfp-map-row" key={m.csv}><span class="csv">{m.csv}</span><span class="to">{m.to}</span><span class="mok"><IconOk size={15} /></span></div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 — Review */}
            {step === 2 && (
              <div class="sfp-scard">
                <h3 class="sub">Review Changes</h3>
                <div class="sfp-stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}>
                  <div class="sfp-stat"><span class="sic green"><IconOk /></span><div><div class="snum">{newCount}</div><div class="slbl">New bands</div></div></div>
                  <div class="sfp-stat"><span class="sic blue"><IconArrow size={18} /></span><div><div class="snum">{updateCount}</div><div class="slbl">Updated bands</div></div></div>
                  <div class="sfp-stat"><span class="sic amber"><IconAlert /></span><div><div class="snum">{warnCount}</div><div class="slbl">With warnings</div></div></div>
                </div>
                <table class="sfp-vtable">
                  <thead><tr><th style={{ width: 70 }}>Class</th><th>Weekly Min</th><th>Weekly Max</th><th>Employee /wk</th><th>Employer /wk</th><th style={{ width: 90 }}>Action</th></tr></thead>
                  <tbody>
                    {importable.map(r => (
                      <tr key={r.rowNum}>
                        <td class="ccode">{r.classNo}</td>
                        <td>{fmtMoney(r.weeklyMin)}</td>
                        <td>{r.weeklyMax == null ? '∞' : fmtMoney(r.weeklyMax)}</td>
                        <td>{fmtMoney(r.employeeWeekly)}</td>
                        <td>{fmtMoney(r.employerWeekly)}</td>
                        <td><span class={`sfp-chip ${r.classNo != null && existingNos.has(r.classNo) ? 'warn' : 'ok'}`}>{r.classNo != null && existingNos.has(r.classNo) ? 'Update' : 'New'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p class="sfp-hint" style={{ marginTop: 12 }}>Importing {importable.length} band{importable.length !== 1 ? 's' : ''} into <b>{version?.label}</b>. Existing class numbers are updated in place; {errorCount > 0 ? `${errorCount} error row(s) are excluded.` : 'no rows are excluded.'}</p>
              </div>
            )}

            {/* STEP 4 — Complete */}
            {step === 3 && result && (
              <div class="sfp-scard" style={{ textAlign: 'center', padding: '36px 26px' }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: result.errors.length ? 'var(--sfp-amber-bg)' : 'var(--sfp-green-bg)', color: result.errors.length ? 'var(--sfp-amber)' : 'var(--sfp-green)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  {result.errors.length ? <IconAlert size={26} /> : <IconOk size={26} />}
                </div>
                <h3 style={{ fontSize: 18 }}>{result.imported} band{result.imported !== 1 ? 's' : ''} imported</h3>
                <p class="sfp-hint">into {version?.label}{result.errors.length ? ` · ${result.errors.length} row(s) rejected by the server` : ''}.</p>
                {result.errors.length > 0 && (
                  <div style={{ marginTop: 14, textAlign: 'left', maxWidth: 560, marginInline: 'auto' }}>
                    {result.errors.map((e, i) => <p key={i} class="sfp-err-msg" style={{ margin: '3px 0' }}>Row {e.row}: {e.message}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div class="sfp-footer">
            {step > 0 && step < 3 && <button type="button" class="sfp-btn sfp-btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
            <div class="right">
              <button type="button" class="sfp-btn sfp-btn-ghost" onClick={onClose} disabled={busy}>{step === 3 ? 'Close' : 'Cancel'}</button>
              {step === 0 && <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => setStep(1)} disabled={rows.length === 0}>Continue<IconArrow /></button>}
              {step === 1 && <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => setStep(2)} disabled={errorCount > 0 || importable.length === 0}>Continue to Review<IconArrow /></button>}
              {step === 2 && <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => void doImport()} disabled={busy || importable.length === 0}>{busy ? <span class="sfp-spin" /> : null}Import {importable.length} band{importable.length !== 1 ? 's' : ''}</button>}
              {step === 3 && <button type="button" class="sfp-btn sfp-btn-primary" onClick={onClose}>Done</button>}
            </div>
          </div>
    </StatFormShell>
  );
}

function rowsHaveData(text: string): boolean {
  return text.trim().split(/\r?\n/).filter(l => l.trim() !== '').length >= 2;
}
