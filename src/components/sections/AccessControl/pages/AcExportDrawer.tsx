/**
 * src/components/sections/AccessControl/pages/AcExportDrawer.tsx
 *
 * Export Permissions — right-side drawer (visual scaffold of the approved mockup).
 *
 * NOTE: This is intentionally a UI-only surface for now (per product decision): the
 * controls carry real local state so the drawer feels live, but nothing is wired to a
 * backend yet — CSV/Excel/PDF generation, scheduling, email delivery, password-protect
 * and ZIP all require export infrastructure that doesn't exist yet. "Export Now" simply
 * closes the drawer until that backend lands; no fake download, no faked success toast.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { Drawer, Button } from '@ui';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { PERMISSION_KEYS } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';

type Fmt = 'csv' | 'excel' | 'pdf';
const EXT: Record<Fmt, string> = { csv: 'csv', excel: 'xlsx', pdf: 'pdf' };
const FORMATS: { id: Fmt; label: string; icon: LucideName; tint: string }[] = [
  { id: 'csv',   label: 'CSV',   icon: 'FileText',  tint: '#64748b' },
  { id: 'excel', label: 'Excel', icon: 'Sheet',     tint: '#15803d' },
  { id: 'pdf',   label: 'PDF',   icon: 'FileType',  tint: '#dc2626' },
];

const CONTENT: { id: string; label: string; info?: boolean }[] = [
  { id: 'effective', label: 'Effective Access' },
  { id: 'scope',     label: 'Scope Information' },
  { id: 'defaults',  label: 'Role Defaults' },
  { id: 'audit',     label: 'Audit Trail' },
  { id: 'overrides', label: 'User Overrides' },
  { id: 'metadata',  label: 'System Metadata', info: true },
  { id: 'descriptions', label: 'Descriptions' },
];

export function AcExportDrawer({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [fmt, setFmt] = useState<Fmt>('excel');
  const [destination, setDestination] = useState<'download' | 'email'>('download');
  const [content, setContent] = useState<Record<string, boolean>>({
    effective: true, scope: true, defaults: true, audit: true, overrides: true, descriptions: true, metadata: false,
  });
  const [pwProtect, setPwProtect] = useState(false);
  const [zip, setZip] = useState(true);
  const [schedule, setSchedule] = useState<'now' | 'recurring' | 'onetime'>('now');
  const [delivery, setDelivery] = useState<'download' | 'email'>('download');
  const [emails, setEmails] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);

  const moduleCount = useMemo(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean)).size, []);
  const permCount = PERMISSION_KEYS.length;
  const fileName = `permissions_export_2025-05-15_14-30-00.${EXT[fmt]}`;
  const toggle = (id: string) => setContent(c => ({ ...c, [id]: !c[id] }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      panelClass="exp-drawer"
      title="Export Permissions"
      sub="Configure and export permissions data based on your selected criteria."
      headActions={
        <div class="exp-head-actions">
          <button type="button" class="exp-hbtn"><LucideIcon name="Eye" size={14} /> View Role Details</button>
          <button type="button" class="exp-hbtn">Bulk Actions <LucideIcon name="ChevronDown" size={14} /></button>
        </div>
      }
      foot={
        <div class="exp-foot">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="blue" icon="fa-download" onClick={onClose}>Export Now <i class="fas fa-chevron-right" style={{ fontSize: '11px', marginLeft: '2px' }} /></Button>
        </div>
      }
    >
      <div class="exp-grid">
        {/* ── Left: configuration ─────────────────────────────────────────── */}
        <div class="exp-left">
          <div class="exp-sec">
            <div class="exp-label">Export Format</div>
            <div class="exp-formats">
              {FORMATS.map(f => (
                <button key={f.id} type="button" class={`exp-fmt${fmt === f.id ? ' on' : ''}`} onClick={() => setFmt(f.id)}>
                  <span class="exp-fmt-ico" style={{ color: f.tint }}><LucideIcon name={f.icon} size={22} /></span>
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
            <div class="exp-label">Date Range</div>
            <button type="button" class="exp-field">
              <LucideIcon name="Calendar" size={15} />
              <span class="exp-field-val">May 1, 2025 – May 15, 2025</span>
              <LucideIcon name="ChevronDown" size={15} />
            </button>
            <div class="exp-hint">Permissions data as of May 15, 2025</div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Export Scope</div>
            <div class="exp-scope">
              <div class="exp-scope-row"><span>Roles</span><a class="exp-view">View</a></div>
              <button type="button" class="exp-field"><span class="exp-field-val">2 selected</span><LucideIcon name="ChevronDown" size={15} /></button>
            </div>
            <div class="exp-scope">
              <div class="exp-scope-row"><span>Modules</span><a class="exp-view">View</a></div>
              <button type="button" class="exp-field"><span class="exp-field-val">{moduleCount} selected</span><LucideIcon name="ChevronDown" size={15} /></button>
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Content to Include</div>
            <div class="exp-checks">
              {CONTENT.map(c => (
                <label key={c.id} class="exp-check">
                  <input type="checkbox" checked={!!content[c.id]} onChange={() => toggle(c.id)} />
                  <span>{c.label}</span>
                  {c.info && <LucideIcon name="Info" size={13} />}
                </label>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">File Options</div>
            <label class="exp-check"><input type="checkbox" checked={pwProtect} onChange={() => setPwProtect(v => !v)} /><span>Password protect export</span><LucideIcon name="Info" size={13} /></label>
            <label class="exp-check"><input type="checkbox" checked={zip} onChange={() => setZip(v => !v)} /><span>Compress file (ZIP)</span></label>
          </div>

          <div class="exp-sec">
            <div class="exp-label">File Name Preview</div>
            <div class="exp-field exp-file">
              <span class="exp-field-val">{fileName}</span>
              <button type="button" class="exp-copy" title="Copy" onClick={() => { try { void navigator.clipboard?.writeText(fileName); } catch { /* ignore */ } }}><LucideIcon name="Copy" size={14} /></button>
            </div>
          </div>
        </div>

        {/* ── Right: summary + scheduling + delivery ──────────────────────── */}
        <div class="exp-right">
          {summaryOpen && (
            <div class="exp-summary">
              <div class="exp-summary-head">
                <span>Export Summary</span>
                <button type="button" class="exp-summary-x" onClick={() => setSummaryOpen(false)} aria-label="Hide summary"><LucideIcon name="X" size={15} /></button>
              </div>
              <div class="exp-summary-stats">
                <div class="exp-ss"><LucideIcon name="Users" size={16} /><div><div class="exp-ss-n">2</div><div class="exp-ss-l">Roles</div></div></div>
                <div class="exp-ss"><LucideIcon name="LayoutGrid" size={16} /><div><div class="exp-ss-n">{moduleCount}</div><div class="exp-ss-l">Modules</div></div></div>
                <div class="exp-ss"><LucideIcon name="Key" size={16} /><div><div class="exp-ss-n">{permCount}</div><div class="exp-ss-l">Permissions</div></div></div>
              </div>
              <div class="exp-includes-t">Includes:</div>
              <ul class="exp-includes">
                <li><LucideIcon name="Check" size={13} /> Effective access, role defaults, and user overrides</li>
                <li><LucideIcon name="Check" size={13} /> Scope information and descriptions</li>
                <li><LucideIcon name="Check" size={13} /> Audit trail entries</li>
              </ul>
              <div class="exp-summary-date"><strong>Date range:</strong> May 1, 2025 – May 15, 2025</div>
            </div>
          )}

          <div class="exp-sec">
            <div class="exp-label">Scheduling</div>
            <div class="exp-sched">
              {([['now', 'Run now', 'Generate export immediately'],
                 ['recurring', 'Schedule recurring export', 'Set up a recurring export on a schedule'],
                 ['onetime', 'Schedule one-time export', 'Schedule export to run at a future date/time']] as const).map(([id, t, s]) => (
                <label key={id} class="exp-sradio">
                  <input type="radio" name="sched" checked={schedule === id} onChange={() => setSchedule(id)} />
                  <div><div class="exp-sradio-t">{t}</div><div class="exp-sradio-s">{s}</div></div>
                </label>
              ))}
            </div>
          </div>

          <div class="exp-sec">
            <div class="exp-label">Delivery Options</div>
            <label class="exp-sradio"><input type="radio" name="deliv" checked={delivery === 'download'} onChange={() => setDelivery('download')} /><div><div class="exp-sradio-t">Download</div></div></label>
            <label class="exp-sradio"><input type="radio" name="deliv" checked={delivery === 'email'} onChange={() => setDelivery('email')} /><div><div class="exp-sradio-t">Email to recipients</div></div></label>
            <input class="exp-input" placeholder="Enter email addresses" value={emails} disabled={delivery !== 'email'} onInput={e => setEmails((e.target as HTMLInputElement).value)} />
            <div class="exp-hint">Separate multiple emails with commas</div>
          </div>

          <div class="exp-note"><LucideIcon name="Info" size={15} /> You will be notified when the export is ready.</div>
        </div>
      </div>
    </Drawer>
  );
}
