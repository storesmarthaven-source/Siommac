/**
 * src/components/sections/AccessControl/pages/AcExportDrawer.tsx
 *
 * Export Permissions — minimal right-side drawer (visual scaffold).
 *
 * Scaled back to the essentials we'll actually use: pick a format, choose what to
 * include, see the file name. UI-only for now (no export backend yet) — "Export"
 * closes the drawer; no fake download, no faked success.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, Button } from '@ui';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';

type Fmt = 'csv' | 'pdf';
const FORMATS: { id: Fmt; label: string; icon: LucideName; tint: string }[] = [
  { id: 'csv', label: 'CSV', icon: 'FileText', tint: '#64748b' },
  { id: 'pdf', label: 'PDF', icon: 'FileType', tint: '#dc2626' },
];
const CONTENT: { id: string; label: string }[] = [
  { id: 'defaults',     label: 'Role defaults' },
  { id: 'overrides',    label: 'User overrides' },
  { id: 'effective',    label: 'Effective access' },
  { id: 'descriptions', label: 'Descriptions' },
];

export function AcExportDrawer({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [fmt, setFmt] = useState<Fmt>('csv');
  const [content, setContent] = useState<Record<string, boolean>>({ defaults: true, overrides: true, effective: true, descriptions: false });
  const toggle = (id: string) => setContent(c => ({ ...c, [id]: !c[id] }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      panelClass="exp-drawer"
      title="Export Permissions"
      sub="Choose a format and what to include."
      foot={
        <div class="exp-foot">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="blue" icon="fa-download" onClick={onClose}>Export</Button>
        </div>
      }
    >
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
          <div class="exp-label">File name</div>
          <div class="exp-field"><span class="exp-field-val">user-access-export.{fmt}</span></div>
        </div>
      </div>
    </Drawer>
  );
}
