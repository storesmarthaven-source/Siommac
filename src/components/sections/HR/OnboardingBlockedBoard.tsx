/**
 * src/components/sections/HR/OnboardingBlockedBoard.tsx
 *
 * HR ▸ Onboarding ▸ Blocked — the CROSS-CASE blocker board (Phase 4). Unresolved
 * blockers across every active case, grouped into columns by the module that owns the
 * block (Documents, Training, HSE, Payroll, IT/Access, Supervisor, …). Each card
 * carries the case, employee, owner, age, severity, and the actions: Notify Owner,
 * Escalate, Resolve, Waive, plus Open Case / linked task / linked handoff.
 *
 * Every action hits the real onboarding API (resolve/escalate/waive already existed;
 * notify-owner sends a real in-app notification to the blocker's owner). Waiver needs
 * a reason (server-enforced) and is settings-gated. Mutations invalidate ['hr','onboarding'].
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader, Modal, Field, TextareaInput } from '@ui';
import {
  useOnboardingBlockersList,
  useOnboardingResolveBlocker, useOnboardingEscalateBlocker, useOnboardingWaiveBlocker, useOnboardingNotifyBlockerOwner,
} from '@api/hr/onboarding';
import type { OnboardingBlockerRow } from '../../../../types/hrOnboarding';
import { severityPill, pillClass, humanize, fmtDate } from './onboardingStatus';
import './onboardingCase.css';

// Active (unresolved) blocker statuses — the board only shows work that still needs it.
const ACTIVE_STATUSES = ['active', 'acknowledged', 'waiting_on_owner', 'escalated'];
const MODULE_META: Record<string, { label: string; icon: string }> = {
  documents: { label: 'Documents', icon: 'fa-folder-open' },
  training: { label: 'Training', icon: 'fa-graduation-cap' },
  hse: { label: 'HSE', icon: 'fa-helmet-safety' },
  payroll: { label: 'Payroll', icon: 'fa-money-check-dollar' },
  finance: { label: 'Payroll / Finance', icon: 'fa-money-check-dollar' },
  it: { label: 'IT / Access', icon: 'fa-laptop' },
  access: { label: 'IT / Access', icon: 'fa-laptop' },
  supervisor: { label: 'Supervisor', icon: 'fa-user-tie' },
  profile: { label: 'Profile Data', icon: 'fa-id-card' },
  hr: { label: 'HR', icon: 'fa-users' },
};
const moduleLabel = (m: string): string => MODULE_META[m]?.label ?? humanize(m);
const moduleIcon = (m: string): string => MODULE_META[m]?.icon ?? 'fa-triangle-exclamation';

export function OnboardingBlockedBoard({
  onBack, onOpenCase, onToast,
}: { onBack: () => void; onOpenCase: (caseId: string) => void; onToast: (m: string) => void }): VNode {
  const [severity, setSeverity] = useState('');
  const [query, setQuery] = useState('');
  const [waiveFor, setWaiveFor] = useState<OnboardingBlockerRow | null>(null);
  const [waiveReason, setWaiveReason] = useState('');

  const blockersQ = useOnboardingBlockersList({ statuses: ACTIVE_STATUSES, severities: severity ? [severity] : undefined });
  const all = blockersQ.data ?? [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter(b => b.caseNo.toLowerCase().includes(q) || (b.employeeName ?? '').toLowerCase().includes(q) || b.blockerTitle.toLowerCase().includes(q)) : all;
  }, [all, query]);

  const kpi = useMemo(() => ({
    active: rows.length,
    critical: rows.filter(b => b.severity === 'critical').length,
    escalated: rows.filter(b => b.status === 'escalated').length,
    avgAge: rows.length ? Math.round(rows.reduce((s, b) => s + b.ageDays, 0) / rows.length) : 0,
  }), [rows]);

  const columns = useMemo(() => {
    const byModule = new Map<string, OnboardingBlockerRow[]>();
    for (const b of rows) byModule.set(b.blockingModule, [...(byModule.get(b.blockingModule) ?? []), b]);
    const order = ['documents', 'training', 'hse', 'payroll', 'finance', 'it', 'access', 'supervisor', 'profile', 'hr'];
    return Array.from(byModule.entries()).sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rows]);

  // ── mutations ─────────────────────────────────────────────────────────────────
  const resolveMut = useOnboardingResolveBlocker(), escalateMut = useOnboardingEscalateBlocker();
  const waiveMut = useOnboardingWaiveBlocker(), notifyMut = useOnboardingNotifyBlockerOwner();
  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function handleResolve(b: OnboardingBlockerRow): Promise<void> { const n = await dialog.prompt({ title: `Resolution note for: ${b.blockerTitle}` }); if (n === null) return; await run(() => resolveMut.mutateAsync({ blockerId: b.blockerId, note: n || null }), 'Blocker resolved'); }
  async function handleEscalate(b: OnboardingBlockerRow): Promise<void> { const n = await dialog.prompt({ title: `Escalation note for: ${b.blockerTitle}` }); if (n === null) return; await run(() => escalateMut.mutateAsync({ blockerId: b.blockerId, note: n || null }), 'Blocker escalated'); }
  async function handleNotify(b: OnboardingBlockerRow): Promise<void> { await run(() => notifyMut.mutateAsync({ blockerId: b.blockerId }), 'Owner notified'); }
  function openWaive(b: OnboardingBlockerRow): void { setWaiveFor(b); setWaiveReason(''); }
  async function submitWaive(): Promise<void> {
    if (!waiveFor) return;
    if (!waiveReason.trim()) { onToast('A waiver reason is required'); return; }
    await run(() => waiveMut.mutateAsync({ blockerId: waiveFor.blockerId, reason: waiveReason.trim() }), 'Blocker waived');
    setWaiveFor(null);
  }

  const card = (b: OnboardingBlockerRow): VNode => {
    const sp = severityPill(b.severity);
    return (
      <div class={`obx-blockcard sev-${b.severity}`} key={b.blockerId}>
        <div class="obx-blockcard-title">{b.blockerTitle}</div>
        <div class="obx-blockcard-row"><span>{b.caseNo}{b.employeeName ? ` · ${b.employeeName}` : ''}</span><span class={`obx-pill ${pillClass(sp)}`}>{sp.label}</span></div>
        <div class="obx-blockcard-row"><span>Owner: {b.ownerName ?? 'Unassigned'}</span><span>{b.ageDays}d old</span></div>
        {b.dueAt && <div class="obx-blockcard-row"><span>Due {fmtDate(b.dueAt)}</span><span class="obx-pill amber" style={{ height: 18 }}>{humanize(b.status)}</span></div>}
        <div class="obx-blockcard-foot">
          <button class="obx-mini" onClick={() => onOpenCase(b.caseId)}>Open Case</button>
          <button class="obx-mini" onClick={() => void handleNotify(b)} disabled={!b.ownerId} title={b.ownerId ? '' : 'No owner to notify — escalate to assign one'}>Notify Owner</button>
          <button class="obx-mini" onClick={() => void handleEscalate(b)}>Escalate</button>
          <button class="obx-mini" onClick={() => void handleResolve(b)}>Resolve</button>
          <button class="obx-mini" onClick={() => openWaive(b)}>Waive</button>
        </div>
      </div>
    );
  };

  return (
    <div class="hr-onboarding-blocked">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-triangle-exclamation"
        module="HR · Onboarding"
        title="Blocked"
        sub="Active onboarding blockers grouped by the module that owns them."
        meta={[
          { icon: 'fa-triangle-exclamation', label: `${kpi.active} active` },
          { icon: 'fa-fire', label: `${kpi.critical} critical` },
          { icon: 'fa-arrow-up-right-dots', label: `${kpi.escalated} escalated` },
          { icon: 'fa-hourglass-half', label: `avg ${kpi.avgAge}d old` },
        ]}
      />

      <div class="obx-toolbar">
        <input class="ui-input" style={{ flex: 1, minWidth: 160 }} placeholder="Search case, employee, blocker…" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <select class="ui-select" value={severity} onChange={e => setSeverity((e.target as HTMLSelectElement).value)}>
          <option value="">All severities</option>
          {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>

      {blockersQ.isLoading && !blockersQ.data ? <div class="obx-empty">Loading…</div>
        : !rows.length ? <div class="obx-section"><div class="obx-empty">No active blockers — nothing is holding up onboarding right now.</div></div>
        : (
          <div class="obx-blockgrid">
            {columns.map(([mod, items]) => (
              <div class="obx-blockcol" key={mod}>
                <div class="obx-blockcol-head"><i class={`fas ${moduleIcon(mod)}`} />{moduleLabel(mod)}<span class="obx-blockcol-count">{items.length}</span></div>
                <div class="obx-blockcards">{items.map(card)}</div>
              </div>
            ))}
          </div>
        )}

      {waiveFor && (
        <Modal open title="Waive Blocker" icon="fa-circle-check" onClose={() => setWaiveFor(null)}
          onSubmit={() => void submitWaive()} submitLabel="Waive Blocker" submitDisabled={waiveMut.isPending || !waiveReason.trim()}>
          <div style={{ marginBottom: 10, fontSize: 13, color: '#64748b' }}>
            Waiving <b>{waiveFor.blockerTitle}</b> on {waiveFor.caseNo} clears the block without completing the underlying work. This is audited.
          </div>
          <Field label="Waiver reason (required)">
            <TextareaInput value={waiveReason} onInput={setWaiveReason} placeholder="Why is it safe to waive this blocker?" rows={3} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
