/**
 * src/components/sections/HSE/ptw/PermitDetailDrawer.tsx
 *
 * Right-side detail drawer for a PTW permit record.
 * Mirrors JsaDrawer.tsx structure: Drawer + in-panel Tabs + per-tab bodies.
 *
 * Tabs: Overview · Hazards & Controls · Isolations · SIMOPS · Approvals · Timeline
 * Header: status-aware primary action buttons (per spec §9).
 * Opened from the Permits register row "Open" button.
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Drawer, Tabs, DetailGrid, type TabDef, type DetailItem } from '@ui';
import { hsePill } from '../types';
import {
  usePermit,
  usePermitTransition,
  usePermitIsolations,
  usePermitSimops,
  usePermitApprovals,
  useCreateIsolation,
  useIsolationAction,
  useSimopsCheck,
  useSimopsAction,
  useDecideApproval,
  type PermitListRow,
  type PermitStatus,
  type PermitIsolation,
  type PermitSimops,
  type PermitApproval,
} from '@api/hse/ptw';
import {
  ApprovePermitDialog,
  RejectPermitDialog,
  RequestChangesDialog,
  ActivatePermitDialog,
  SuspendPermitDialog,
  RevalidateDialog,
  ExtensionRequestDialog,
  CloseoutDialog,
  CancelPermitDialog,
} from './dialogs/PermitLifecycleDialogs';
import { DiscussionButton } from '@components/sections/Messages/DiscussionButton';

// ── Tab definitions ───────────────────────────────────────────────────────────

type DrawerTabKey = 'overview' | 'hazards' | 'isolations' | 'simops' | 'approvals' | 'timeline';

const DRAWER_TABS: readonly TabDef<DrawerTabKey>[] = [
  { key: 'overview',   label: 'Overview'   },
  { key: 'hazards',    label: 'Hazards'    },
  { key: 'isolations', label: 'Isolations' },
  { key: 'simops',     label: 'SIMOPS'     },
  { key: 'approvals',  label: 'Approvals'  },
  { key: 'timeline',   label: 'Timeline'   },
];

// ── Open-dialog union ─────────────────────────────────────────────────────────

type OpenDlg = 'none' | 'approve' | 'reject' | 'changes' | 'activate' | 'suspend' | 'revalidate' | 'extension' | 'close' | 'cancel';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

/** Remaining time countdown (positive = still valid, negative = expired). */
function remainingTime(endDt: string | null | undefined): VNode {
  if (!endDt) return <span class="hse-muted">—</span>;
  const ms  = new Date(endDt).getTime() - Date.now();
  const abs = Math.abs(ms);
  const h   = Math.floor(abs / 3_600_000);
  const m   = Math.floor((abs % 3_600_000) / 60_000);
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
  if (ms <= 0) return <span style={{ color: 'var(--siomac-red)', fontWeight: 600 }}>Expired {label} ago</span>;
  if (ms < 2 * 3_600_000) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>{label} remaining</span>;
  return <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{label} remaining</span>;
}

function riskPill(level: string | null): VNode {
  if (!level) return <span class="hse-muted">—</span>;
  const cls =
    level === 'critical' ? 'vt-pill is-off'
    : level === 'high'   ? 'vt-pill is-warn'
    : level === 'medium' ? 'vt-pill is-amber'
    : 'vt-pill is-on';
  return <span class={cls}>{level.charAt(0).toUpperCase() + level.slice(1)}</span>;
}

function EmptyState({ message }: { message: string }): VNode {
  return (
    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.8rem' }}>
      {message}
    </p>
  );
}

function TabActionError({ message }: { message: string }): VNode {
  return (
    <div style={{ color: 'var(--siomac-red)', fontSize: '0.78rem', padding: '8px 10px', background: 'rgba(220,38,38,.07)', borderRadius: '6px', marginBottom: '8px' }}>
      <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />{message}
    </div>
  );
}

// ── Status-aware action buttons ───────────────────────────────────────────────

function ActionButtons({ status, onOpen, onAction }: {
  status: PermitStatus;
  onOpen: (dlg: OpenDlg) => void;
  onAction: (a: 'submit' | 'advance') => void;
}): VNode {
  const btns: VNode[] = [];

  switch (status) {
    case 'draft':
      btns.push(
        <button key="cancel"   class="hse-btn" onClick={() => onOpen('cancel')}><i class="fas fa-xmark-circle" /> Delete Draft</button>,
        <button key="submit"   class="hse-btn primary" onClick={() => onAction('submit')}><i class="fas fa-paper-plane" /> Submit</button>,
      );
      break;
    case 'submitted':
    case 'risk_review':
      btns.push(
        <button key="changes"  class="hse-btn" onClick={() => onOpen('changes')}><i class="fas fa-rotate-left" /> Request Changes</button>,
        <button key="reject"   class="hse-btn" onClick={() => onOpen('reject')}><i class="fas fa-ban" /> Reject</button>,
        <button key="continue" class="hse-btn primary" onClick={() => onAction('advance')}><i class="fas fa-clipboard-check" /> Send for Approval</button>,
      );
      break;
    case 'awaiting_approval':
      btns.push(
        <button key="changes"  class="hse-btn" onClick={() => onOpen('changes')}><i class="fas fa-rotate-left" /> Request Changes</button>,
        <button key="reject"   class="hse-btn" onClick={() => onOpen('reject')}><i class="fas fa-ban" /> Reject</button>,
        <button key="approve"  class="hse-btn primary" onClick={() => onOpen('approve')}><i class="fas fa-circle-check" /> Approve</button>,
      );
      break;
    case 'approved':
      btns.push(
        <button key="cancel"   class="hse-btn" onClick={() => onOpen('cancel')}><i class="fas fa-xmark-circle" /> Cancel</button>,
        <button key="activate" class="hse-btn primary" onClick={() => onOpen('activate')}><i class="fas fa-circle-play" /> Activate</button>,
      );
      break;
    case 'active':
      btns.push(
        <button key="ext"     class="hse-btn" onClick={() => onOpen('extension')}><i class="fas fa-clock-rotate-left" /> Request Extension</button>,
        <button key="suspend" class="hse-btn" onClick={() => onOpen('suspend')}><i class="fas fa-circle-pause" /> Suspend</button>,
        <button key="close"   class="hse-btn primary" onClick={() => onOpen('close')}><i class="fas fa-flag-checkered" /> Close Out</button>,
      );
      break;
    case 'suspended':
      btns.push(
        <button key="cancel"     class="hse-btn" onClick={() => onOpen('cancel')}><i class="fas fa-xmark-circle" /> Cancel</button>,
        <button key="close"      class="hse-btn" onClick={() => onOpen('close')}><i class="fas fa-flag-checkered" /> Close</button>,
        <button key="revalidate" class="hse-btn primary" onClick={() => onOpen('revalidate')}><i class="fas fa-rotate" /> Revalidate</button>,
      );
      break;
    case 'expired':
      btns.push(
        <button key="close" class="hse-btn primary" onClick={() => onOpen('close')}><i class="fas fa-flag-checkered" /> Close Out</button>,
      );
      break;
    default:
      btns.push(
        <span key="readonly" style={{ fontSize: '0.76rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
          <i class="fas fa-lock" style={{ marginRight: '4px' }} />View only — {status.replace(/_/g, ' ')}
        </span>,
      );
  }

  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>{btns}</div>;
}

// ── Tab bodies ─────────────────────────────────────────────────────────────────

function OverviewTab({ permit }: { permit: Record<string, unknown> }): VNode {
  const str = (k: string) => permit[k] as string | null | undefined;
  const items: DetailItem[] = [
    { icon: 'fa-hashtag',              label: 'Permit No',     value: <span class="vt-cell-mono">{str('permit_number') ?? '—'}</span> },
    { icon: 'fa-tag',                  label: 'Type',          value: (str('permit_type') ?? '').replace(/_/g, ' ') || '—' },
    { icon: 'fa-circle-dot',           label: 'Status',        value: <span class={hsePill(str('status'))}>{(str('status') ?? '—').replace(/_/g, ' ')}</span> },
    { icon: 'fa-triangle-exclamation', label: 'Risk Level',    value: riskPill(str('risk_level') ?? null) },
    { icon: 'fa-location-dot',         label: 'Site',          value: str('site_id') ?? '—' },
    { icon: 'fa-map-pin',              label: 'Location',      value: str('specific_location') ?? '' },
    { icon: 'fa-play',                 label: 'Planned Start', value: fmtDt(str('start_datetime')) },
    { icon: 'fa-flag-checkered',       label: 'Planned End',   value: fmtDt(str('end_datetime')) },
    { icon: 'fa-clock',                label: 'Remaining',     value: remainingTime(str('end_datetime')) },
    { icon: 'fa-list-ol',              label: 'Linked JSA',    value: str('linked_jsa_id')            ? <span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{str('linked_jsa_id')}</span> : '' },
    { icon: 'fa-table-cells-large',    label: 'Linked RA',     value: str('linked_risk_assessment_id') ? <span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{str('linked_risk_assessment_id')}</span> : '' },
    { icon: 'fa-calendar-day',         label: 'Created',       value: fmtDate(str('created_at')) },
  ];
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <DetailGrid items={items} hideEmpty />
      {str('description') && (
        <div>
          <strong style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Work Description</strong>
          <p style={{ fontSize: '0.82rem', margin: 0, lineHeight: 1.6 }}>{str('description')}</p>
        </div>
      )}
    </div>
  );
}

function HazardsTab({ hazards, controls }: { hazards: unknown[]; controls: unknown[] }): VNode {
  if (hazards.length === 0 && controls.length === 0) {
    return <EmptyState message="No hazards or controls recorded on this permit." />;
  }
  const controlArr = controls as Record<string, unknown>[];
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(hazards as Record<string, unknown>[]).map((h, i) => (
        <div key={i} style={{ padding: '10px 12px', background: 'var(--surface-alt)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--siomac-red)', fontWeight: 600, marginBottom: '4px' }}>
            <i class="fas fa-triangle-exclamation" style={{ marginRight: '5px' }} />
            {(h.description ?? h.hazard_description) as string ?? `Hazard ${i + 1}`}
          </div>
          {controlArr
            .filter(c => c.hazard_id === h.id)
            .map((c, ci) => (
              <div key={ci} style={{ fontSize: '0.75rem', color: 'var(--color-success)', marginTop: '4px', paddingLeft: '12px' }}>
                <i class="fas fa-shield-halved" style={{ marginRight: '4px' }} />
                {c.description as string}
                {c.control_type && <span style={{ color: 'var(--text-muted)' }}> · {(c.control_type as string).replace(/_/g, ' ')}</span>}
              </div>
            ))}
        </div>
      ))}
      {/* Orphan controls with no hazard link */}
      {controlArr.filter(c => !c.hazard_id).map((c, i) => (
        <div key={`ctrl-${i}`} style={{ padding: '8px 12px', background: 'rgba(34,197,94,.06)', borderRadius: '8px', border: '1px solid rgba(34,197,94,.2)', fontSize: '0.78rem', color: 'var(--color-success)' }}>
          <i class="fas fa-shield-halved" style={{ marginRight: '5px' }} />
          {c.description as string}
        </div>
      ))}
    </div>
  );
}

function IsolationsTab({ permitId, isolations, refetch }: {
  permitId:   string;
  isolations: PermitIsolation[];
  refetch:    () => void;
}): VNode {
  const [showAdd, setShowAdd] = useState(false);
  const [isoType, setIsoType] = useState('');
  const [desc,    setDesc]    = useState('');
  const [tag,     setTag]     = useState('');
  const [loc,     setLoc]     = useState('');
  const [addErr,  setAddErr]  = useState('');
  const create = useCreateIsolation();
  const action = useIsolationAction();

  async function handleAdd() {
    if (!isoType || !desc.trim()) { setAddErr('Type and description are required.'); return; }
    setAddErr('');
    try {
      await create.mutateAsync({ permitId, isolationType: isoType, description: desc, equipmentTag: tag || null, location: loc || null });
      setShowAdd(false); setIsoType(''); setDesc(''); setTag(''); setLoc('');
      refetch();
    } catch (e) { setAddErr(e instanceof Error ? e.message : 'Failed to add isolation.'); }
  }

  async function doAction(iso: PermitIsolation, act: 'apply' | 'verify' | 'reject' | 'remove') {
    try { await action.mutateAsync({ action: act, isolationId: iso.id, permitId }); refetch(); }
    catch { /* surface via global mutation state */ }
  }

  const statusColor = (s: string) => s === 'applied' ? '#22c55e' : s === 'verified' ? '#3b82f6' : s === 'removed' ? 'var(--text-muted)' : '#f59e0b';

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          {isolations.length} isolation point{isolations.length !== 1 ? 's' : ''}
        </span>
        <button class="inc-action-btn primary" style={{ fontSize: '0.72rem' }} onClick={() => setShowAdd(v => !v)}>
          <i class="fas fa-plus" /> Add Isolation
        </button>
      </div>

      {showAdd && (
        <div style={{ padding: '12px', background: 'var(--surface-alt)', borderRadius: '8px', border: '1px solid var(--border)', display: 'grid', gap: '8px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Isolation Point</div>
          <select class="emp-filter-select" value={isoType} onChange={e => setIsoType((e.target as HTMLSelectElement).value)} style={{ fontSize: '0.8rem' }}>
            <option value="">Select type…</option>
            <option value="lockout">Lockout</option>
            <option value="tagout">Tagout</option>
            <option value="electrical">Electrical isolation</option>
            <option value="mechanical">Mechanical isolation</option>
            <option value="pneumatic">Pneumatic isolation</option>
            <option value="hydraulic">Hydraulic isolation</option>
            <option value="chemical">Chemical isolation</option>
            <option value="other">Other</option>
          </select>
          <input class="emp-filter-select" placeholder="Description *" value={desc} onInput={e => setDesc((e.target as HTMLInputElement).value)} style={{ fontSize: '0.8rem' }} />
          <input class="emp-filter-select" placeholder="Equipment tag (optional)" value={tag} onInput={e => setTag((e.target as HTMLInputElement).value)} style={{ fontSize: '0.8rem' }} />
          <input class="emp-filter-select" placeholder="Location (optional)" value={loc} onInput={e => setLoc((e.target as HTMLInputElement).value)} style={{ fontSize: '0.8rem' }} />
          {addErr && <div style={{ color: 'var(--siomac-red)', fontSize: '0.76rem' }}>{addErr}</div>}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button class="inc-action-btn primary" style={{ fontSize: '0.72rem' }} disabled={create.isPending} onClick={() => void handleAdd()}>
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
            <button class="inc-action-btn" style={{ fontSize: '0.72rem' }} onClick={() => { setShowAdd(false); setAddErr(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {isolations.length === 0 && !showAdd && <EmptyState message="No isolation points recorded." />}

      {isolations.map(iso => (
        <div key={iso.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{iso.description}</span>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {iso.isolation_type.replace(/_/g, ' ')}
                {iso.equipment_tag && ` · Tag: ${iso.equipment_tag}`}
                {iso.location && ` · ${iso.location}`}
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: statusColor(iso.status), whiteSpace: 'nowrap' }}>{iso.status}</span>
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
            {iso.status === 'pending' && (
              <button class="inc-action-btn primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(iso, 'apply')}>Apply</button>
            )}
            {iso.status === 'applied' && (
              <button class="inc-action-btn primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(iso, 'verify')}>Verify</button>
            )}
            {(iso.status === 'pending' || iso.status === 'applied') && (
              <button class="inc-action-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(iso, 'reject')}>Reject</button>
            )}
            {iso.status === 'verified' && (
              <button class="inc-action-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(iso, 'remove')}>Remove</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SimopsTab({ permitId, simops, refetch }: {
  permitId: string;
  simops:   PermitSimops[];
  refetch:  () => void;
}): VNode {
  const check  = useSimopsCheck();
  const action = useSimopsAction();
  const [checkErr, setCheckErr] = useState('');

  async function runCheck() {
    setCheckErr('');
    try { await check.mutateAsync({ permitId }); refetch(); }
    catch (e) { setCheckErr(e instanceof Error ? e.message : 'SIMOPS check failed.'); }
  }

  async function doAction(s: PermitSimops, act: 'resolve' | 'approve-override') {
    try { await action.mutateAsync({ action: act, simopsId: s.id, permitId }); refetch(); }
    catch { /* swallow */ }
  }

  const statusColor = (s: string) =>
    s === 'resolved'   ? 'var(--color-success)'
    : s === 'overridden' ? '#f59e0b'
    : 'var(--siomac-red)';

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {checkErr && <TabActionError message={checkErr} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          {simops.length} conflict{simops.length !== 1 ? 's' : ''} recorded
        </span>
        <button class="inc-action-btn primary" style={{ fontSize: '0.72rem' }} disabled={check.isPending} onClick={() => void runCheck()}>
          <i class="fas fa-diagram-project" /> {check.isPending ? 'Checking…' : 'Run SIMOPS Check'}
        </button>
      </div>

      {simops.length === 0 && (
        <EmptyState message="No SIMOPS conflicts recorded. Run a check to detect conflicts with other active permits." />
      )}

      {simops.map(s => (
        <div key={s.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{s.description}</span>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {s.conflict_type.replace(/_/g, ' ')}
                {s.conflicting_permit_id && ` · Conflicts with ${s.conflicting_permit_id.slice(0, 8)}…`}
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: statusColor(s.status), whiteSpace: 'nowrap' }}>
              {s.status}
            </span>
          </div>
          {s.status !== 'resolved' && s.status !== 'overridden' && (
            <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
              <button class="inc-action-btn primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(s, 'resolve')}>Resolve</button>
              <button class="inc-action-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={action.isPending} onClick={() => void doAction(s, 'approve-override')}>Override</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ApprovalsTab({ permitId, approvals, refetch }: {
  permitId:  string;
  approvals: PermitApproval[];
  refetch:   () => void;
}): VNode {
  const decide = useDecideApproval();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decNote,  setDecNote]  = useState('');
  const [decErr,   setDecErr]   = useState('');

  async function doDecide(approvalId: string, decision: 'approve' | 'reject') {
    setDecErr('');
    try {
      await decide.mutateAsync({ approvalId, permitId, decision, notes: decNote || null });
      setDeciding(null); setDecNote('');
      refetch();
    } catch (e) { setDecErr(e instanceof Error ? e.message : 'Failed to record decision.'); }
  }

  const statusColor = (s: string) =>
    s === 'approved' ? 'var(--color-success)' : s === 'rejected' ? 'var(--siomac-red)' : '#f59e0b';

  const approved = approvals.filter(a => a.status === 'approved').length;

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
        {approved}/{approvals.length} approval{approvals.length !== 1 ? 's' : ''} obtained
      </span>

      {approvals.length === 0 && <EmptyState message="No approval stages configured for this permit." />}

      {approvals.map(a => (
        <div key={a.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{a.approval_type.replace(/_/g, ' ')}</span>
              {a.approver_name && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Approver: {a.approver_name}
                </div>
              )}
              {a.decided_at && (
                <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)' }}>
                  Decided {fmtDt(a.decided_at)}
                </div>
              )}
              {a.notes && (
                <div style={{ fontSize: '0.74rem', fontStyle: 'italic', marginTop: '3px', color: 'var(--text-muted)' }}>
                  {a.notes}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              {a.required && (
                <span style={{ fontSize: '0.65rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Required</span>
              )}
              <span style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: statusColor(a.status) }}>{a.status}</span>
            </div>
          </div>

          {a.status === 'pending' && deciding !== a.id && (
            <div style={{ marginTop: '6px' }}>
              <button class="inc-action-btn primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }} onClick={() => { setDeciding(a.id); setDecNote(''); setDecErr(''); }}>
                Record Decision
              </button>
            </div>
          )}

          {deciding === a.id && (
            <div style={{ marginTop: '8px', padding: '10px', background: 'var(--surface-alt)', borderRadius: '6px', display: 'grid', gap: '6px' }}>
              <input class="emp-filter-select" placeholder="Note (optional)" value={decNote} onInput={e => setDecNote((e.target as HTMLInputElement).value)} style={{ fontSize: '0.78rem' }} />
              {decErr && <div style={{ color: 'var(--siomac-red)', fontSize: '0.73rem' }}>{decErr}</div>}
              <div style={{ display: 'flex', gap: '5px' }}>
                <button class="inc-action-btn primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }} disabled={decide.isPending} onClick={() => void doDecide(a.id, 'approve')}>Approve</button>
                <button class="inc-action-btn" style={{ fontSize: '0.68rem', padding: '2px 8px', color: 'var(--siomac-red)' }} disabled={decide.isPending} onClick={() => void doDecide(a.id, 'reject')}>Reject</button>
                <button class="inc-action-btn" style={{ fontSize: '0.68rem', padding: '2px 8px' }} onClick={() => setDeciding(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ timeline }: { timeline: unknown[] }): VNode {
  if (timeline.length === 0) return <EmptyState message="No timeline events recorded yet." />;
  return (
    <div>
      {(timeline as Record<string, unknown>[]).map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <i class="fas fa-circle-dot" style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.7rem', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {((e.event_type ?? e.type) as string | undefined)?.replace(/\./g, ' ') ?? 'Event'}
            </div>
            {e.description && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{e.description as string}</div>
            )}
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {new Date((e.created_at ?? e.timestamp) as string).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface PermitDetailDrawerProps {
  permit:      PermitListRow;
  onClose:     () => void;
  initialTab?: DrawerTabKey;
}

export function PermitDetailDrawer({ permit, onClose, initialTab = 'overview' }: PermitDetailDrawerProps): VNode {
  const [activeTab, setActiveTab] = useState<DrawerTabKey>(initialTab);
  const [openDlg,   setOpenDlg]   = useState<OpenDlg>('none');

  // Full permit detail (includes hazards, controls, timeline)
  const { data: detailRes, refetch: refetchDetail } = usePermit(permit.id);
  const detail    = detailRes?.data;
  const permitRec = (detail?.permit) ?? {};
  const hazards   = (detail?.hazards) ?? [];
  const controls  = (detail?.controls) ?? [];
  const timeline  = (detail?.timeline) ?? [];

  // Sub-register live data
  const { data: isoRes,       refetch: refetchIso  } = usePermitIsolations(permit.id);
  const { data: simopsRes,    refetch: refetchSim  } = usePermitSimops(permit.id);
  const { data: approvalsRes, refetch: refetchAppr } = usePermitApprovals(permit.id);

  const isolations = isoRes?.data       ?? [];
  const simops     = simopsRes?.data     ?? [];
  const approvals  = approvalsRes?.data  ?? [];

  // Count badges on tabs
  const tabCounts: Partial<Record<DrawerTabKey, number>> = {
    isolations: isolations.length > 0 ? isolations.length : undefined,
    simops:     simops.filter(s => s.status !== 'resolved' && s.status !== 'overridden').length || undefined,
    approvals:  approvals.filter(a => a.status === 'pending').length || undefined,
  };

  const permitNo = permit.permit_number ?? 'PTW';

  function closeDialog() { setOpenDlg('none'); void refetchDetail(); }

  // Forward review steps that don't need a reason dialog: submit (draft →
  // submitted) and advance (submitted → risk_review → … → awaiting_approval).
  const transition = usePermitTransition();
  async function doAction(action: 'submit' | 'advance') {
    try { await transition.mutateAsync({ action, permitId: permit.id }); void refetchDetail(); }
    catch { /* surfaced by the mutation error toast */ }
  }

  const footer = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <ActionButtons status={permit.status} onOpen={setOpenDlg} onAction={a => void doAction(a)} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button class="hse-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );

  return (
    <>
      <Drawer
        open
        title={`${permitNo} — ${permit.title}`}
        sub={permit.site_id ?? undefined}
        onClose={onClose}
        foot={footer}
      >
        {/* Header meta strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '0 0 12px' }}>
          <span class={hsePill(permit.status)} style={{ fontSize: '0.72rem' }}>
            {permit.status.replace(/_/g, ' ')}
          </span>
          {riskPill(permit.risk_level)}
          {permit.specific_location && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <i class="fas fa-location-dot" style={{ marginRight: '4px' }} />
              {permit.specific_location}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.73rem' }}>
              {remainingTime(permit.end_datetime)}
            </span>
            <DiscussionButton module="hse" entityType="permit" entityId={permit.id} recordRef={permitNo} />
          </div>
        </div>

        {/* In-panel tab bar (mirrors JsaDrawer) */}
        <Tabs<DrawerTabKey>
          tabs={DRAWER_TABS}
          active={activeTab}
          onChange={setActiveTab}
          counts={tabCounts}
          barClass="hse-idrawer-tabbar"
          tabClass="hse-idrawer-tab"
        />

        {/* Tab bodies */}
        <div class="hse-drawer-tab-body" style={{ padding: '14px 0', overflowY: 'auto' }}>
          {activeTab === 'overview'   && <OverviewTab permit={permitRec} />}
          {activeTab === 'hazards'    && <HazardsTab hazards={hazards} controls={controls} />}
          {activeTab === 'isolations' && (
            <IsolationsTab permitId={permit.id} isolations={isolations} refetch={() => void refetchIso()} />
          )}
          {activeTab === 'simops' && (
            <SimopsTab permitId={permit.id} simops={simops} refetch={() => void refetchSim()} />
          )}
          {activeTab === 'approvals' && (
            <ApprovalsTab permitId={permit.id} approvals={approvals} refetch={() => void refetchAppr()} />
          )}
          {activeTab === 'timeline' && <TimelineTab timeline={timeline} />}
        </div>
      </Drawer>

      {/* Lifecycle dialogs — each invalidates detail on close */}
      <ApprovePermitDialog    open={openDlg === 'approve'}    onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <RejectPermitDialog     open={openDlg === 'reject'}     onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <RequestChangesDialog   open={openDlg === 'changes'}    onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <ActivatePermitDialog   open={openDlg === 'activate'}   onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <SuspendPermitDialog    open={openDlg === 'suspend'}    onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <RevalidateDialog       open={openDlg === 'revalidate'} onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
      <ExtensionRequestDialog open={openDlg === 'extension'}  onClose={closeDialog} permitId={permit.id} permitNo={permitNo} currentEndDt={permit.end_datetime} />
      <CloseoutDialog         open={openDlg === 'close'}      onClose={() => { closeDialog(); onClose(); }} permitId={permit.id} permitNo={permitNo} />
      <CancelPermitDialog     open={openDlg === 'cancel'}     onClose={closeDialog} permitId={permit.id} permitNo={permitNo} />
    </>
  );
}
