/**
 * src/components/sections/AccessControl/pages/AcExportDrawer.tsx
 *
 * Export Permissions — right-side navy drawer (redesigned), matching the statutory
 * Rate Version rich drawer's palette. Self-contained: portals to <body> wrapped in
 * `.acx` so it uses the section's own styles (the shared @ui <Drawer> depends on
 * HSE.css, not loaded here).
 *
 * Options are scoped to what makes sense for a current-state permissions snapshot —
 * Format, Records (this user vs all), Include columns, Modules filter, Password protect,
 * file name. UI-only for now (no export backend) — "Export" closes; no fake download.
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
  const moduleCount = useMemo(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean)).size, []);
  const rec = user ? records : 'all';
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
          <div class="exp-sec">
            <div class="exp-label">Format</div>
            <div class="exp-formats">
              {FORMATS.map(f => (
                <button key={f.id} type="button" class={`exp-fmt${fmt === f.id ? ' on' : ''}`} onClick={() => setFmt(f.id)}>
                  {fmt === f.id && <span class="exp-fmt-check"><LucideIcon name="Check" size={11} strokeWidth={3} /></span>}
                  <span class="exp-fmt-ico" style={{ color: f.tint }}><LucideIcon name={f.icon} size={22} /></span>
                  <span class="exp-fmt-lbl">{f.label}</span>
                </button>
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
            <div class="exp-label">Include</div>
            <div class="exp-checks">
              {COLUMNS.map(c => (
                <label key={c.id} class="exp-check">
                  <input type="checkbox" checked={!!cols[c.id]} onChange={() => toggle(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Modules</div>
            <button type="button" class="exp-field exp-field-btn">
              <LucideIcon name="LayoutGrid" size={15} />
              <span class="exp-field-val">All modules ({moduleCount})</span>
              <LucideIcon name="ChevronDown" size={15} />
            </button>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Options</div>
            <label class="exp-check"><input type="checkbox" checked={pwProtect} onChange={() => setPwProtect(v => !v)} /><span>Password protect export</span></label>
          </div>

          <div class="exp-sec">
            <div class="exp-label">File name</div>
            <div class="exp-field">
              <LucideIcon name="FileText" size={15} />
              <span class="exp-field-val">{fileName}</span>
            </div>
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
