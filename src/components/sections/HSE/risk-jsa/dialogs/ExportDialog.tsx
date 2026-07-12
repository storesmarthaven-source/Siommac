/**
 * src/components/sections/HSE/risk-jsa/dialogs/ExportDialog.tsx
 *
 * Generic register export dialog. Operates on the rows already loaded in the
 * tab (respecting the active filters) and serialises them to CSV via the shared
 * exportCsv helper — no backend round-trip. Reused by every Risk & JSA register.
 */

import { type VNode } from 'preact';
import { Modal } from '@ui';
import { exportCsv, type CsvColumn } from '@ui/lib/exportCsv';

export interface ExportDialogProps<T> {
  open: boolean;
  onClose: () => void;
  /** Human label for the register being exported, e.g. "Hazard Register". */
  registerLabel: string;
  rows: readonly T[];
  columns: readonly CsvColumn<T>[];
  filenameBase: string;
}

export function ExportDialog<T>({
  open, onClose, registerLabel, rows, columns, filenameBase,
}: ExportDialogProps<T>): VNode | null {
  function handleExport() {
    exportCsv(rows, columns, filenameBase);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`Export ${registerLabel}`}
      icon="fa-file-csv"
      size="sm"
      onClose={onClose}
      onSubmit={handleExport}
      submitLabel="Download CSV"
      submitDisabled={rows.length === 0}
    >
      <div style={{ display: 'grid', gap: '12px', fontSize: '0.85rem' }}>
        <p style={{ margin: 0 }}>
          Export the <strong>{rows.length}</strong> record{rows.length === 1 ? '' : 's'} currently shown
          (your active filters are applied) to a CSV file.
        </p>
        <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-alt, #F1F5F9)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Columns included</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {columns.map(c => (
              <span key={c.header} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>{c.header}</span>
            ))}
          </div>
        </div>
        {rows.length === 0 && (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Nothing to export — adjust your filters first.</p>
        )}
      </div>
    </Modal>
  );
}
