/**
 * src/components/sections/HourlyRates/HourlyRatesSection.tsx
 *
 * Replaces payroll.js Hourly-Rates section (s-adm-rates).
 * Manages per-employee hourly rate editing, bulk CSV import/export.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, Fragment }          from 'preact';
import { useState, useMemo, useRef, useCallback } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/preact-query';
import { toast }                from '@store';
import { useSessionStore }      from '@store/session';
import { ConfirmDialog }        from '@shared/ConfirmDialog';
import {
  listHourlyRates,
  updateHourlyRateApi,
  bulkImportRatesApi,
  parseRatesCsv,
} from './api';
import type { HourlyRateRow } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtMoney = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-US');

function roleCls(role: string) {
  if (role === 'admin')   return 'hr-role-admin';
  if (role === 'manager') return 'hr-role-manager';
  return 'hr-role-employee';
}

// ── Stat cards ────────────────────────────────────────────────────────────────

interface StatsProps { rows: HourlyRateRow[] }

function HrStats({ rows }: StatsProps) {
  const total   = rows.length;
  const rates   = rows.map(r => r.hourlyRate || 0);
  const avg     = total ? rates.reduce((s, v) => s + v, 0) / total : 0;
  const max     = total ? Math.max(...rates) : 0;
  const monthly = rows.reduce((s, r) => s + (r.hourlyRate || 0) * 160, 0);
  return (
    <div class="hr-stats-row">
      <div class="hr-stat-card">
        <div class="hr-stat-icon"><i class="fas fa-users"></i></div>
        <div class="hr-stat-body">
          <div class="hr-stat-value">{total}</div>
          <div class="hr-stat-label">Total Employees</div>
        </div>
      </div>
      <div class="hr-stat-card">
        <div class="hr-stat-icon" style="background:rgba(27,45,85,.08)"><i class="fas fa-chart-line" style="color:var(--siomac-navy)"></i></div>
        <div class="hr-stat-body">
          <div class="hr-stat-value">{fmtMoney(avg)}</div>
          <div class="hr-stat-label">Average Rate</div>
        </div>
      </div>
      <div class="hr-stat-card">
        <div class="hr-stat-icon" style="background:rgba(46,125,50,.08)"><i class="fas fa-file-invoice-dollar" style="color:#2E7D32"></i></div>
        <div class="hr-stat-body">
          <div class="hr-stat-value">{fmtMoney(monthly)}</div>
          <div class="hr-stat-label">Est. Monthly Payroll</div>
        </div>
      </div>
      <div class="hr-stat-card">
        <div class="hr-stat-icon" style="background:rgba(237,108,2,.08)"><i class="fas fa-arrow-trend-up" style="color:#ED6C02"></i></div>
        <div class="hr-stat-body">
          <div class="hr-stat-value">{fmtMoney(max)}</div>
          <div class="hr-stat-label">Highest Rate</div>
        </div>
      </div>
    </div>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────

interface RowProps {
  row:      HourlyRateRow;
  onSaved:  (username: string, rate: number) => void;
}

function RateRow({ row, onSaved }: RowProps) {
  const [rate, setRate]       = useState(String(row.hourlyRate ?? 0));
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);

  const handleChange = (val: string) => {
    setRate(val);
    setDirty(String(row.hourlyRate) !== val);
  };

  const handleSave = async () => {
    const n = Number(rate);
    if (isNaN(n) || n < 0) { toast.error('Rate must be a non-negative number'); return; }
    setSaving(true);
    try {
      const res = await updateHourlyRateApi(row.username, n);
      if (!res.success) { toast.error(res.message || 'Could not update rate'); return; }
      setDirty(false);
      onSaved(row.username, n);
      toast.success('Rate saved');
    } catch {
      toast.error('Failed to save rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td class="hr-emp-name">{row.fullName}</td>
      <td>{row.department}</td>
      <td>{row.position}</td>
      <td class="hr-td-center">
        <span class={`hr-role-badge ${roleCls(row.role)}`}>{row.role}</span>
      </td>
      <td class="hr-td-center">
        <div class="hr-rate-cell">
          <span class="hr-currency">$</span>
          <input
            type="number"
            class={`hr-rate-input${dirty ? ' dirty' : ''}`}
            min="0"
            step="0.50"
            value={rate}
            onInput={(e) => handleChange((e.target as HTMLInputElement).value)}
          />
        </div>
      </td>
      <td class="hr-td-center">
        <button
          class="hr-save-btn"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving
            ? <><i class="fas fa-spinner fa-spin"></i> Saving…</>
            : <><i class="fas fa-save"></i> Save</>}
        </button>
      </td>
    </tr>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────

interface ImportModalProps {
  open:    boolean;
  onClose: () => void;
  onDone:  () => void;
}

function ImportModal({ open, onClose, onDone }: ImportModalProps) {
  const [csvText, setCsvText]   = useState('');
  const [loading, setLoading]   = useState(false);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setCsvText((e.target!).result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const handleConfirm = async () => {
    if (!csvText.trim()) { toast.error('Paste CSV data or select a file'); return; }
    let parsed: { username: string; rate: number }[];
    try { parsed = parseRatesCsv(csvText); }
    catch (err) { toast.error(`CSV parse error: ${(err as Error).message}`); return; }
    if (!parsed.length) { toast.error('No valid rows found. Format: username,rate'); return; }
    setLoading(true);
    try {
      const r = await bulkImportRatesApi(parsed);
      if (!r.success) { toast.error(r.message || 'Import failed'); return; }
      toast.success(`Imported ${r.updated} rate${r.updated !== 1 ? 's' : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}`);
      setCsvText('');
      onClose();
      onDone();
    } catch {
      toast.error('Import failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  return (
    <div class="hr-modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="hr-modal-container" onClick={(e) => e.stopPropagation()}>
        <div class="hr-modal-header">
          <span><i class="fas fa-file-csv"></i> Import Hourly Rates</span>
          <button class="hr-modal-close" onClick={onClose}><i class="fas fa-times"></i></button>
        </div>
        <div class="hr-modal-body">
          <p class="hr-modal-hint">
            Upload a <strong>.csv</strong> file with <code>username</code> and <code>rate</code> columns.<br />
            Unknown usernames are skipped automatically.
          </p>
          <label
            class="hr-file-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <i class="fas fa-cloud-upload-alt"></i>
            <span>Click or drop a CSV file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style="display:none"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleFile(f);
                (e.target as HTMLInputElement).value = '';
              }}
            />
          </label>
          <p class="hr-modal-hint" style="margin-top:10px">Or paste raw CSV:</p>
          <textarea
            class="hr-csv-textarea"
            rows={5}
            placeholder={'username,rate\njohn.doe,28.50\njane.smith,32.00'}
            value={csvText}
            onInput={(e) => setCsvText((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <div class="hr-modal-footer">
          <button class="hr-btn-outline" onClick={onClose}>Cancel</button>
          <button class="hr-btn-primary" onClick={handleConfirm} disabled={loading}>
            {loading ? <i class="fas fa-spinner fa-spin"></i> : <i class="fas fa-check"></i>} Import
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export function HourlyRatesSection() {
  const queryClient     = useQueryClient();
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);

  const { data: allRates = [], isLoading } = useQuery({
    queryKey: ['hourlyRates'],
    queryFn:  ({ signal }) => listHourlyRates(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });

  // Local overrides: { username -> rate } so edits survive re-renders
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const rates = useMemo(() =>
    allRates.map(r => {
      const ov = overrides[r.username];
      return ov !== undefined ? { ...r, hourlyRate: ov } : r;
    }), [allRates, overrides]);

  const [search, setSearch]     = useState('');
  const [dept, setDept]         = useState('all');
  const [role, setRole]         = useState('all');
  const [importOpen, setImport] = useState(false);
  const [saveAllConfirm, setSaveAllConfirm] = useState(false);
  const [savingAll, setSavingAll]           = useState(false);

  // All dirty rows (rate !== original)
  const dirtyRows = useMemo(() =>
    allRates.filter(orig =>
      overrides[orig.username] !== undefined &&
      overrides[orig.username] !== orig.hourlyRate
    ), [allRates, overrides]);

  const depts = useMemo(() =>
    [...new Set(allRates.map(r => r.department).filter(Boolean))].sort(),
    [allRates],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rates.filter(r => {
      if (q && !r.fullName.toLowerCase().includes(q) && !r.department.toLowerCase().includes(q)) return false;
      if (dept !== 'all' && r.department !== dept) return false;
      if (role !== 'all' && r.role !== role) return false;
      return true;
    });
  }, [rates, search, dept, role]);

  const handleSaved = useCallback((username: string, rate: number) => {
    setOverrides(prev => ({ ...prev, [username]: rate }));
    // Invalidate so Employees/Attendance views pick up new rate
    void queryClient.invalidateQueries({ queryKey: ['employees'] });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
  }, [queryClient]);

  const exportCsv = () => {
    let csv = 'Username,Name,Department,Position,Role,Hourly Rate\n';
    rates.forEach(r => {
      csv += `"${r.username}","${r.fullName}","${r.department}","${r.position}","${r.role}",${r.hourlyRate}\n`;
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a   = document.createElement('a');
    a.href = url;
    a.download = `siomac_hourly_rates_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const saveAll = async () => {
    if (!dirtyRows.length) { toast.error('No changes to save'); return; }
    setSavingAll(true);
    let done = 0;
    for (const orig of dirtyRows) {
      const rate = overrides[orig.username] ?? orig.hourlyRate;
      try {
        const res = await updateHourlyRateApi(orig.username, rate);
        if (res.success) {
          setOverrides(prev => ({ ...prev, [orig.username]: rate }));
          done++;
        }
      } catch { /* continue */ }
    }
    setSavingAll(false);
    if (done > 0) {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(`Saved ${done} rate update${done > 1 ? 's' : ''}`);
    } else {
      toast.error('Save failed');
    }
  };

  return (
    <>
      <HrStats rows={filtered} />

      {/* Filters */}
      <div class="hr-filters-bar">
        <div class="hr-search-box">
          <i class="fas fa-search"></i>
          <input
            type="text"
            placeholder="Search by name or department…"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="hr-filter-group">
          <select class="hr-filter-select" value={dept} onChange={(e) => setDept((e.target as HTMLSelectElement).value)}>
            <option value="all">All Departments</option>
            {depts.map(d => <option value={d}>{d}</option>)}
          </select>
          <select class="hr-filter-select" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value)}>
            <option value="all">All Roles</option>
            <option value="manager">Manager</option>
            <option value="employee">Employee</option>
          </select>
        </div>
        <div class="lv-bar-actions" style="margin-left:auto">
          <button class="hr-btn-outline" onClick={exportCsv}><i class="fas fa-download"></i> Export CSV</button>
          <button class="hr-btn-outline" onClick={() => setImport(true)}><i class="fas fa-upload"></i> Import CSV</button>
          <button
            class="hr-btn-primary"
            onClick={() => dirtyRows.length ? setSaveAllConfirm(true) : toast.error('No changes to save')}
            disabled={savingAll}
          >
            {savingAll ? <i class="fas fa-spinner fa-spin"></i> : <i class="fas fa-save"></i>} Save All
            {dirtyRows.length > 0 && <span class="hr-dirty-badge">{dirtyRows.length}</span>}
          </button>
          <button
            class="hr-btn-outline"
            onClick={() => { setSearch(''); setDept('all'); setRole('all'); }}
          >
            <i class="fas fa-undo-alt"></i> Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div class="hr-table-container">
        <div class="hr-table-responsive">
          <table id="ratesTable">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Position</th>
                <th class="hr-th-center">Role</th>
                <th class="hr-th-center">Hourly Rate</th>
                <th class="hr-th-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colspan={6} style="text-align:center;padding:32px"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>
              ) : !filtered.length ? (
                <tr class="hr-empty-row">
                  <td colspan={6}>
                    <i class="fas fa-users-slash"></i>
                    {allRates.length ? 'No employees match your filters' : 'No employees yet'}
                  </td>
                </tr>
              ) : filtered.map(row => (
                <RateRow key={row.username} row={row} onSaved={handleSaved} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Save All confirm */}
      <ConfirmDialog
        open={saveAllConfirm}
        title="Save All Changes"
        message={`Save rate updates for ${dirtyRows.length} employee${dirtyRows.length !== 1 ? 's' : ''}?`}
        confirmLabel="Save All"
        onClose={() => setSaveAllConfirm(false)}
        onConfirm={() => void saveAll()}
      />

      {/* Import modal */}
      <ImportModal
        open={importOpen}
        onClose={() => setImport(false)}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ['hourlyRates'] })}
      />
    </>
  );
}
