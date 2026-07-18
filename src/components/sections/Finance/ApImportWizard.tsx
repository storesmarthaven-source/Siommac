/**
 * src/components/sections/Finance/ApImportWizard.tsx
 *
 * Bill-import wizard: upload CSV → map columns → validate → review errors → import.
 *
 * CSV format (header row required):
 *   vendorName, vendorInvoiceNo, billDate (YYYY-MM-DD), dueDate (opt),
 *   description, amount, glAccountCode (opt), currency (opt, default TTD).
 *
 * Steps:
 *   0 Upload       — drag/drop or file picker; parse CSV in-browser.
 *   1 Validate     — shows preview with row-level error highlighting.
 *   2 Import       — calls /ap/bills/import and shows result summary.
 *
 * Perm: finance.ap.bills.import.
 */

import { type VNode } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinPill, HrfinIcon } from '@ui';
import { useImportBills, type ImportBillRow, type ImportBillsResult } from '@api/finance/accountsPayable';

const REQUIRED_HEADERS = ['vendorName', 'billDate', 'description', 'amount'] as const;
const ALL_HEADERS = ['vendorName', 'vendorInvoiceNo', 'billDate', 'dueDate', 'description', 'amount', 'glAccountCode', 'currency'] as const;

function parseCsv(text: string): string[][] {
  return text.trim().split('\n').map(line => {
    const cols: string[] = [];
    let inq = false, cur = '';
    for (const ch of line) {
      if (ch === '"' && !inq) { inq = true; continue; }
      if (ch === '"' && inq) { inq = false; continue; }
      if (ch === ',' && !inq) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });
}

const STEPS = ['Upload', 'Validate', 'Import'];

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export function ApImportWizard({ open, onClose, onImported }: Props): VNode {
  const [step, setStep] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [parseError, setParseError] = useState('');
  const [rows, setRows] = useState<ImportBillRow[]>([]);
  const [result, setResult] = useState<ImportBillsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importBills = useImportBills();

  function reset(): void {
    setStep(0); setCsvText(''); setParseError(''); setRows([]); setResult(null); setBusy(false);
  }
  function close(): void { onClose(); reset(); }

  function handleFile(file: File): void {
    const reader = new FileReader();
    reader.onload = e => { setCsvText((e.target!).result as string); setParseError(''); };
    reader.readAsText(file);
  }

  function parseThenValidate(): void {
    setParseError('');
    try {
      const lines = parseCsv(csvText);
      if (lines.length < 2) { setParseError('CSV must have a header row and at least one data row.'); return; }
      const header = (lines[0] ?? []).map(h => h.toLowerCase().trim().replace(/[^a-z]/g, '_').replace(/__+/g, '_'));

      // Map canonical column names — allow loose matching
      const colIdx = new Map<string, number>();
      for (const col of ALL_HEADERS) {
        const idx = header.findIndex(h => h === col.toLowerCase() || h.startsWith(col.toLowerCase().slice(0, 6)));
        if (idx >= 0) colIdx.set(col, idx);
      }
      const missing = REQUIRED_HEADERS.filter(r => !colIdx.has(r));
      if (missing.length) { setParseError(`Missing required columns: ${missing.join(', ')}`); return; }

      const parsed: ImportBillRow[] = (lines.slice(1)).map((row, i) => ({
        rowIndex: i + 2,
        vendorName:      row[colIdx.get('vendorName') ?? -1] ?? '',
        vendorInvoiceNo: row[colIdx.get('vendorInvoiceNo') ?? -1] ?? '',
        billDate:        row[colIdx.get('billDate') ?? -1] ?? '',
        dueDate:         row[colIdx.get('dueDate') ?? -1] ?? '',
        description:     row[colIdx.get('description') ?? -1] ?? '',
        amount:          row[colIdx.get('amount') ?? -1] ?? '',
        glAccountCode:   row[colIdx.get('glAccountCode') ?? -1] ?? '',
        currency:        row[colIdx.get('currency') ?? -1] ?? 'TTD',
      })).filter(r => r.vendorName || r.description || r.amount); // skip blank rows

      if (!parsed.length) { setParseError('No valid data rows found.'); return; }
      setRows(parsed);
      setStep(1);
    } catch {
      setParseError('Failed to parse CSV. Please check the format.');
    }
  }

  async function doImport(): Promise<void> {
    setBusy(true);
    try {
      const res = await importBills.mutateAsync({ rows });
      setResult(res);
      setStep(2);
      toast(`Imported ${res.imported} bill${res.imported === 1 ? '' : 's'}.`);
      if (res.imported > 0) onImported?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stepValid = step === 0 ? !!csvText.trim() : step === 1 ? rows.length > 0 : false;

  async function onPrimary(): Promise<void> {
    if (step === 0) parseThenValidate();
    else if (step === 1) await doImport();
  }

  const primaryLabel = step === 0 ? 'Validate' : step === 1 ? `Import ${rows.length} rows` : 'Done';

  return (
    <HrfinWizardModal
      open={open} onClose={close} stepCount={STEPS.length} activeStep={step}
      title="Import bills"
      onPrimary={step === 2 ? close : () => void onPrimary()}
      onBack={step === 1 ? () => setStep(0) : undefined}
      primaryLabel={primaryLabel}
      primaryDisabled={step < 2 && !stepValid}
      primaryLoading={busy}
    >
      {/* Step 0: Upload */}
      {step === 0 && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            Upload a CSV file with columns: <code>vendorName</code>, <code>billDate</code>,
            <code>description</code>, <code>amount</code> (required). Optional: <code>vendorInvoiceNo</code>,
            <code>dueDate</code>, <code>glAccountCode</code>, <code>currency</code>.
          </p>
          <div
            style={{
              border: '2px dashed var(--border)', borderRadius: 10, padding: 24,
              textAlign: 'center', cursor: 'pointer', marginBottom: 12,
            }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) handleFile(f); }}
          >
            <HrfinIcon name="file" />
            <p style={{ margin: '8px 0 4px', fontWeight: 500 }}>
              {csvText ? 'CSV loaded ✓ — click to replace' : 'Drop CSV here or click to browse'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>.csv files only</p>
          </div>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); }}
          />
          {csvText && (
            <p style={{ fontSize: 12, color: 'var(--ok)' }}>
              <HrfinIcon name="check" /> File loaded — click "Validate" to preview rows.
            </p>
          )}
          {parseError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{parseError}</p>}
        </div>
      )}

      {/* Step 1: Validate preview */}
      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
            {rows.length} rows parsed. Review any errors before importing.
          </p>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', position: 'sticky', top: 0 }}>
                  {['Row', 'Vendor', 'Invoice #', 'Date', 'Description', 'Amount'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const hasError = !r.vendorName || !(/^\d{4}-\d{2}-\d{2}$/.exec(r.billDate)) || !r.description || isNaN(Number(r.amount)) || Number(r.amount) <= 0;
                  return (
                    <tr key={r.rowIndex} style={{ borderBottom: '1px solid var(--border)', background: hasError ? 'var(--danger-surface, #fff5f5)' : undefined }}>
                      <td style={{ padding: '4px 8px' }}>{r.rowIndex}</td>
                      <td style={{ padding: '4px 8px', color: !r.vendorName ? 'var(--danger)' : undefined }}>{r.vendorName || '⚠ missing'}</td>
                      <td style={{ padding: '4px 8px' }}>{r.vendorInvoiceNo || '—'}</td>
                      <td style={{ padding: '4px 8px', color: !(/^\d{4}-\d{2}-\d{2}$/.exec(r.billDate)) ? 'var(--danger)' : undefined }}>{r.billDate || '⚠ missing'}</td>
                      <td style={{ padding: '4px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</td>
                      <td style={{ padding: '4px 8px', color: isNaN(Number(r.amount)) || Number(r.amount) <= 0 ? 'var(--danger)' : undefined }}>{r.amount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Rows with errors will be skipped; valid rows will be imported as draft bills.
          </p>
        </div>
      )}

      {/* Step 2: Result */}
      {step === 2 && result && (
        <div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div class="hrfin-metric-row">
              <span>Imported</span>
              <HrfinPill tone={result.imported > 0 ? 'ok' : 'dr'}>{result.imported}</HrfinPill>
            </div>
            <div class="hrfin-metric-row">
              <span>Skipped</span>
              <HrfinPill tone={result.skipped > 0 ? 'wn' : 'nu'}>{result.skipped}</HrfinPill>
            </div>
          </div>
          {result.errors.length > 0 && (
            <>
              <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Row errors:</p>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {result.errors.map(e => (
                  <div key={e.rowIndex} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>Row {e.rowIndex}:</span>{' '}
                    {e.errors.join('; ')}
                  </div>
                ))}
              </div>
            </>
          )}
          {result.imported === 0 && result.skipped > 0 && (
            <p style={{ color: 'var(--warning)', fontSize: 13, marginTop: 10 }}>No bills were imported. Fix the errors and try again.</p>
          )}
        </div>
      )}
    </HrfinWizardModal>
  );
}
