/**
 * src/components/sections/Finance/FinanceExportDialog.tsx
 *
 * Chunk 9 — Export Finance Overview data as CSV.
 * Type selector (dashboard / approvals / spend-budget / cost-centre / all)
 * + format (CSV-only for now; XLSX deferred per spec §5).
 * On success triggers a browser download and fires a toast.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { useExportOverview, type ExportType } from '@api/finance/overview';

interface Props {
  open: boolean;
  onClose: () => void;
}

const EXPORT_TYPES: { value: ExportType; label: string }[] = [
  { value: 'all',          label: 'All data' },
  { value: 'dashboard',    label: 'Dashboard summary' },
  { value: 'approvals',    label: 'Approvals queue' },
  { value: 'spend-budget', label: 'Spend vs budget' },
  { value: 'cost-centre',  label: 'Cost centre burn' },
];

export function FinanceExportDialog({ open, onClose }: Props): VNode | null {
  const [type, setType] = useState<ExportType>('all');
  const exportMut = useExportOverview();

  if (!open) return null;

  const handleExport = async (): Promise<void> => {
    try {
      const result = await exportMut.mutateAsync({ type });
      // Trigger browser download
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`Downloaded ${result.filename} (${result.rowCount} rows)`);
      onClose();
    } catch (e) {
      const msg = (e as { message?: string }).message ?? 'Export failed';
      toast.error(msg);
    }
  };

  const handleBackdrop = (e: MouseEvent): void => {
    if (e.target === e.currentTarget && !exportMut.isPending) onClose();
  };

  return (
    <div class="hrfin-dialog-backdrop" onClick={handleBackdrop}>
      <div class="hrfin-dialog" style={{ maxWidth: 420 }} role="dialog" aria-modal="true" aria-label="Export Finance Overview">
        <div class="hrfin-dialog-head">
          <h3>Export Finance Overview</h3>
          <button type="button" class="hrfin-dialog-close" onClick={onClose} aria-label="Close" disabled={exportMut.isPending}>×</button>
        </div>

        <div class="hrfin-dialog-body">
          <label class="hrfin-field">
            <span>Export type</span>
            <select
              value={type}
              disabled={exportMut.isPending}
              onChange={e => setType((e.currentTarget).value as ExportType)}
            >
              {EXPORT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label class="hrfin-field">
            <span>Format</span>
            <select disabled>
              <option value="csv">CSV (Excel-compatible)</option>
            </select>
            <small class="hrfin-field-hint">XLSX export coming in a future update.</small>
          </label>

          {exportMut.isError && (
            <div class="hrfin-field-error">
              {(exportMut.error as { message?: string })?.message ?? 'Export failed. Please try again.'}
            </div>
          )}
        </div>

        <div class="hrfin-dialog-footer">
          <button type="button" class="hrfin-btn" onClick={onClose} disabled={exportMut.isPending}>
            Cancel
          </button>
          <button type="button" class="hrfin-btn is-primary" onClick={() => void handleExport()} disabled={exportMut.isPending}>
            {exportMut.isPending ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}
