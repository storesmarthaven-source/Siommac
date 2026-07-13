/**
 * src/components/sections/AccessControl/pages/AcExportDrawer.tsx
 *
 * Export Permissions — right-side drawer (visual scaffold).
 *
 * Self-contained: portals to <body> wrapped in `.acx` so it uses the section's own
 * tokens/buttons/styles (the shared @ui <Drawer> depends on HSE.css, which isn't loaded
 * on this page). Single-column set of the options we'll actually use — format,
 * destination, date range, scope, what to include, file options, file-name preview.
 * UI-only for now (no export backend) — "Export" closes the drawer; no fake download.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { PERMISSION_KEYS } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';

type Fmt = 'csv' | 'pdf';
const FORMATS: { id: Fmt; label: string; icon: LucideName; tint: string }[] = [
  { id: 'csv', label: 'CSV', icon: 'FileText', tint: '#64748b' },
  { id: 'pdf', label: 'PDF', icon: 'FileType', tint: '#dc2626' },
];
const CONTENT: { id: string; label: string }[] = [
  { id: 'effective',    label: 'Effective access' },
  { id: 'scope',        label: 'Scope information' },
  { id: 'defaults',     label: 'Role defaults' },
  { id: 'audit',        label: 'Audit trail' },
  { id: 'overrides',    label: 'User overrides' },
  { id: 'descriptions', label: 'Descriptions' },
];

export function AcExportDrawer({ open, onClose }: { open: boolean; onClose: () => void }): VNode | null {
  const [fmt, setFmt] = useState<Fmt>('csv');
  const [destination, setDestination] = useState<'download' | 'email'>('download');
  const [content, setContent] = useState<Record<string, boolean>>({
    effective: true, scope: true, defaults: true, audit: false, overrides: true, descriptions: false,
  });
  const [pwProtect, setPwProtect] = useState(false);
  const [zip, setZip] = useState(false);
  const toggle = (id: string) => setContent(c => ({ ...c, [id]: !c[id] }));
  const moduleCount = useMemo(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean)).size, []);
  const fileName = `user-access-export.${fmt}`;

  if (!open) return null;

  return createPortal(
    <div class="acx exp-portal">
      <div class="exp-overlay" onClick={onClose} aria-hidden="true" />
      <aside class="exp-panel" role="dialog" aria-modal="true" aria-label="Export permissions">
        <div class="exp-head">
          <div>
            <div class="exp-title">Export Permissions</div>
            <div class="exp-sub">Configure and export permissions data.</div>
          </div>
          <button type="button" class="exp-close" onClick={onClose} aria-label="Close"><LucideIcon name="X" size={18} /></button>
        </div>

        <div class="exp-body">
          <div class="exp-sec">
            <div class="exp-label">Format</div>
            <div class="exp-formats">
              {FORMATS.map(f => (
                <button key={f.id} type="button" class={`exp-fmt${fmt === f.id ? ' on' : ''}`} onClick={() => setFmt(f.id)}>
                  <span class="exp-fmt-ico" style={{ color: f.tint }}><LucideIcon name={f.icon} size={20} /></span>
                  <span class="exp-fmt-lbl">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Destination</div>
            <div class="exp-radios">
              <label class="exp-radio"><input type="radio" name="dest" checked={destination === 'download'} onChange={() => setDestination('download')} /><span>Download</span></label>
              <label class="exp-radio"><input type="radio" name="dest" checked={destination === 'email'} onChange={() => setDestination('email')} /><span>Email</span></label>
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Date range</div>
            <button type="button" class="exp-field exp-field-btn">
              <LucideIcon name="Calendar" size={15} />
              <span class="exp-field-val">May 1, 2025 – May 15, 2025</span>
              <LucideIcon name="ChevronDown" size={15} />
            </button>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Scope</div>
            <div class="exp-scope">
              <div class="exp-scope-row"><span>Roles</span><a class="exp-view">View</a></div>
              <button type="button" class="exp-field exp-field-btn"><span class="exp-field-val">All roles</span><LucideIcon name="ChevronDown" size={15} /></button>
            </div>
            <div class="exp-scope">
              <div class="exp-scope-row"><span>Modules</span><a class="exp-view">View</a></div>
              <button type="button" class="exp-field exp-field-btn"><span class="exp-field-val">{moduleCount} modules</span><LucideIcon name="ChevronDown" size={15} /></button>
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Include</div>
            <div class="exp-checks">
              {CONTENT.map(c => (
                <label key={c.id} class="exp-check">
                  <input type="checkbox" checked={!!content[c.id]} onChange={() => toggle(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">File options</div>
            <label class="exp-check"><input type="checkbox" checked={pwProtect} onChange={() => setPwProtect(v => !v)} /><span>Password protect export</span></label>
            <label class="exp-check"><input type="checkbox" checked={zip} onChange={() => setZip(v => !v)} /><span>Compress file (ZIP)</span></label>
          </div>

          <div class="exp-sec">
            <div class="exp-label">File name</div>
            <div class="exp-field"><span class="exp-field-val">{fileName}</span></div>
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
