/**
 * src/components/sections/AccessControl/pages/AcExportDrawer.tsx
 *
 * Export Permissions — right-side navy drawer, preview-first layout. A live export
 * preview card sits up top (file icon + name + "records · columns · modules"), with
 * Format / Records as segmented controls, Columns as a checklist with select-all, and
 * Password protect as a toggle. Self-contained: portals to <body> wrapped in `.acx`
 * (the shared @ui <Drawer> depends on HSE.css, not loaded here).
 *
 * UI-only for now (no export backend) — "Export" closes the drawer; no fake download.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { PERMISSION_KEYS } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import type { ConsoleUser } from '@lib/superadminApi';

type Fmt = 'csv' | 'pdf';
const FORMATS: { id: Fmt; label: string; icon: LucideName; tint: string }[] = [
  { id: 'csv', label: 'CSV', icon: 'FileText', tint: '#93c5fd' },
  { id: 'pdf', label: 'PDF', icon: 'FileType', tint: '#fca5a5' },
];
const COLUMNS: { id: string; label: string }[] = [
  { id: 'defaults',     label: 'Role defaults' },
  { id: 'overrides',    label: 'User overrides' },
  { id: 'effective',    label: 'Effective access' },
  { id: 'descriptions', label: 'Descriptions' },
];

export function AcExportDrawer({ open, onClose, user }: { open: boolean; onClose: () => void; user: ConsoleUser | null }): VNode | null {
  const [fmt, setFmt] = useState<Fmt>('csv');
  const [records, setRecords] = useState<'user' | 'all'>('user');
  const [cols, setCols] = useState<Record<string, boolean>>({ defaults: true, overrides: true, effective: true, descriptions: false });
  const [pwProtect, setPwProtect] = useState(false);

  const toggle = (id: string) => setCols(c => ({ ...c, [id]: !c[id] }));
  const selectedCount = COLUMNS.filter(c => cols[c.id]).length;
  const allOn = selectedCount === COLUMNS.length;
  const toggleAll = () => setCols(Object.fromEntries(COLUMNS.map(c => [c.id, !allOn])));

  const moduleCount = useMemo(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean)).size, []);
  const rec = user ? records : 'all';
  const recLabel = rec === 'all' ? 'All users' : (user ? user.fullName : 'Selected user');
  const fmtDef = FORMATS.find(f => f.id === fmt)!;
  const fileName = `${rec === 'all' ? 'user-access-all' : `user-access-${user!.username}`}.${fmt}`;

  if (!open) return null;

  return createPortal(
    <div class="acx exp-portal">
      <div class="exp-overlay" onClick={onClose} aria-hidden="true" />
      <aside class="exp-panel" role="dialog" aria-modal="true" aria-label="Export permissions">
        <div class="exp-head">
          <div class="exp-head-l">
            <span class="exp-head-ico"><LucideIcon name="Download" size={18} /></span>
            <div>
              <div class="exp-title">Export Permissions</div>
              <div class="exp-sub">Export access data as a file.</div>
            </div>
          </div>
          <button type="button" class="exp-close" onClick={onClose} aria-label="Close"><LucideIcon name="X" size={18} /></button>
        </div>

        <div class="exp-body">
          {/* Live preview */}
          <div class="exp-preview">
            <span class="exp-preview-ico" style={{ color: fmtDef.tint }}><LucideIcon name={fmtDef.icon} size={26} /></span>
            <div class="exp-preview-main">
              <div class="exp-preview-name" title={fileName}>{fileName}</div>
              <div class="exp-preview-meta"><span class="exp-cap">{recLabel}</span> · {selectedCount} column{selectedCount === 1 ? '' : 's'} · {moduleCount} modules</div>
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Format</div>
            <div class="exp-seg">
              {FORMATS.map(f => (
                <button key={f.id} type="button" class={`exp-seg-btn${fmt === f.id ? ' on' : ''}`} onClick={() => setFmt(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Records</div>
            <div class="exp-seg">
              <button type="button" class={`exp-seg-btn${rec === 'user' ? ' on' : ''}`} disabled={!user} onClick={() => setRecords('user')}>
                <span class="exp-cap">{user ? user.fullName : 'Selected user'}</span>
              </button>
              <button type="button" class={`exp-seg-btn${rec === 'all' ? ' on' : ''}`} onClick={() => setRecords('all')}>All users</button>
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-sec-head">
              <div class="exp-label">Columns</div>
              <button type="button" class="exp-selall" onClick={toggleAll}>{allOn ? 'Clear all' : 'Select all'}</button>
            </div>
            <div class="exp-list">
              {COLUMNS.map(c => (
                <label key={c.id} class={`exp-row${cols[c.id] ? ' on' : ''}`}>
                  <span class="exp-row-lbl">{c.label}</span>
                  <input type="checkbox" checked={!!cols[c.id]} onChange={() => toggle(c.id)} />
                </label>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <button type="button" class="exp-toggle-row" role="switch" aria-checked={pwProtect} onClick={() => setPwProtect(v => !v)}>
              <span class="exp-toggle-txt">
                <span class="exp-row-lbl">Password protect</span>
                <span class="exp-row-sub">Require a password to open the file</span>
              </span>
              <span class={`exp-switch${pwProtect ? ' on' : ''}`}><span class="exp-switch-knob" /></span>
            </button>
          </div>
        </div>

        <div class="exp-footbar">
          <button type="button" class="acx-hdr-btn" onClick={onClose}>Cancel</button>
          <button type="button" class="acx-hdr-btn primary" onClick={onClose}><LucideIcon name="Download" size={15} /> Export</button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
