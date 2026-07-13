/**
 * src/components/sections/HR/OnboardingHandoffsWorkspace.tsx
 *
 * HR ▸ Onboarding ▸ Handoffs — the CROSS-CASE handoff control center (Phase 3).
 * Case Detail shows one case's handoffs read-only; this workspace is where HR works
 * the whole queue of module handoffs and acts on them (retry a failed one, mark it
 * accepted / completed, cancel). Handoffs are grouped into module lanes (HR Documents,
 * IT, HSE, Training, Payroll, Supervisor, …) with a table per lane, plus a payload
 * viewer modal.
 *
 * Delivery to the real target modules isn't built (those receivers are a later phase),
 * so these actions are the MANUAL lifecycle a human drives — the honest model, not a
 * faked auto-delivery. Every transition is FSM-validated server-side (delivered
 * included) and audited.
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader, Modal } from '@ui';
import {
  useOnboardingHandoffsList,
  useOnboardingRetryHandoff, useOnboardingAcceptHandoff, useOnboardingCompleteHandoff, useOnboardingCancelHandoff,
} from '@api/hr/onboarding';
import type { OnboardingHandoffRow } from '../../../../types/hrOnboarding';
import { handoffStatusPill, pillClass, humanize, fmtDateTime } from './onboardingStatus';
import './onboardingCase.css';

const HANDOFF_STATUSES = ['pending', 'sent', 'accepted', 'blocked', 'delivered', 'completed', 'failed', 'cancelled'];
const OPEN_HANDOFF = new Set(['pending', 'sent', 'accepted', 'blocked', 'delivered', 'failed']);

// Friendly lane titles + icons for the module keys handoffs target. Unknown modules
// fall through to a humanized label with a generic icon (never dropped).
const MODULE_META: Record<string, { label: string; icon: string }> = {
  documents: { label: 'HR Documents', icon: 'fa-folder-open' },
  it: { label: 'IT / Admin', icon: 'fa-laptop' },
  hse: { label: 'HSE', icon: 'fa-helmet-safety' },
  training: { label: 'Training & Competency', icon: 'fa-graduation-cap' },
  payroll: { label: 'Payroll / Finance', icon: 'fa-money-check-dollar' },
  finance: { label: 'Payroll / Finance', icon: 'fa-money-check-dollar' },
  supervisor: { label: 'Supervisor', icon: 'fa-user-tie' },
  security: { label: 'Security / Access', icon: 'fa-id-badge' },
  hr: { label: 'HR', icon: 'fa-users' },
};
const moduleLabel = (m: string): string => MODULE_META[m]?.label ?? humanize(m);
const moduleIcon = (m: string): string => MODULE_META[m]?.icon ?? 'fa-arrow-right-arrow-left';

export function OnboardingHandoffsWorkspace({
  onBack, onOpenCase, onToast,
}: { onBack: () => void; onOpenCase: (caseId: string) => void; onToast: (m: string) => void }): VNode {
  const [status, setStatus] = useState('');
  const [module, setModule] = useState('');
  const [query, setQuery] = useState('');
  const [payloadRow, setPayloadRow] = useState<OnboardingHandoffRow | null>(null);

  const handoffsQ = useOnboardingHandoffsList({ statuses: status ? [status] : undefined, targetModules: module ? [module] : undefined });
  const all = handoffsQ.data ?? [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter(h => h.caseNo.toLowerCase().includes(q) || (h.employeeName ?? '').toLowerCase().includes(q) || (h.handoffType ?? '').toLowerCase().includes(q)) : all;
  }, [all, query]);
  const modules = useMemo(() => Array.from(new Set(all.map(h => h.targetModule))).sort(), [all]);

  const kpi = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    return {
      pending: rows.filter(h => h.status === 'pending' || h.status === 'sent').length,
      failed: rows.filter(h => h.status === 'failed').length,
      blocked: rows.filter(h => h.status === 'blocked').length,
      doneWeek: rows.filter(h => h.status === 'completed' && h.lastEventAt && new Date(h.lastEventAt).getTime() >= weekAgo).length,
    };
  }, [rows]);

  // group into lanes by target module (preserve a stable, sensible order)
  const lanes = useMemo(() => {
    const byModule = new Map<string, OnboardingHandoffRow[]>();
    for (const h of rows) byModule.set(h.targetModule, [...(byModule.get(h.targetModule) ?? []), h]);
    const order = ['documents', 'it', 'hse', 'training', 'payroll', 'finance', 'supervisor', 'security', 'hr'];
    return Array.from(byModule.entries()).sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rows]);

  // ── mutations ─────────────────────────────────────────────────────────────────
  const retryMut = useOnboardingRetryHandoff(), acceptMut = useOnboardingAcceptHandoff();
  const completeMut = useOnboardingCompleteHandoff(), cancelMut = useOnboardingCancelHandoff();
  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function handleRetry(h: OnboardingHandoffRow): Promise<void> { await run(() => retryMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff re-queued'); }
  async function handleAccept(h: OnboardingHandoffRow): Promise<void> { await run(() => acceptMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff accepted'); }
  async function handleComplete(h: OnboardingHandoffRow): Promise<void> { await run(() => completeMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff completed'); }
  async function handleCancel(h: OnboardingHandoffRow): Promise<void> { const r = await dialog.prompt({ title: `Cancel the ${moduleLabel(h.targetModule)} handoff for ${h.caseNo}?`, text: 'Reason (optional)' }); if (r === null) return; await run(() => cancelMut.mutateAsync({ handoffId: h.handoffId, reason: r || null }), 'Handoff cancelled'); }

  // Retry every failed handoff currently in view.
  async function retryAllFailed(): Promise<void> {
    const failed = rows.filter(h => h.status === 'failed');
    if (!failed.length) { onToast('No failed handoffs to retry'); return; }
    if (!await dialog.confirm({ title: `Retry ${failed.length} failed handoff${failed.length === 1 ? '' : 's'}?` })) return;
    for (const h of failed) { try { await retryMut.mutateAsync({ handoffId: h.handoffId }); } catch { /* continue */ } }
    onToast(`Re-queued ${failed.length} handoff${failed.length === 1 ? '' : 's'}`);
  }

  // Lifecycle buttons — only the transitions the FSM allows from the current status.
  // Complete is offered for any non-terminal state (the server rejects illegal edges,
  // e.g. pending→completed, with a clear message — this just avoids offering obvious
  // no-ops).
  const lifecycleActions = (h: OnboardingHandoffRow): VNode => (
    <>
      {h.status === 'failed' && <button class="obx-mini" onClick={() => void handleRetry(h)}>Retry</button>}
      {(h.status === 'pending' || h.status === 'sent') && <button class="obx-mini" onClick={() => void handleAccept(h)}>Accept</button>}
      {(h.status === 'accepted' || h.status === 'delivered' || h.status === 'blocked') && <button class="obx-mini" onClick={() => void handleComplete(h)}>Complete</button>}
      {OPEN_HANDOFF.has(h.status) && <button class="obx-mini" onClick={() => void handleCancel(h)}>Cancel</button>}
    </>
  );

  return (
    <div class="hr-onboarding-handoffs">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-arrow-right-arrow-left"
        module="HR · Onboarding"
        title="Handoffs"
        sub="Cross-case module handoff queue — retry, accept, complete, or cancel."
        actions={<button class="obx-btn" onClick={() => void retryAllFailed()}>Retry Failed</button>}
      />

      <div class="obx-toolbar">
        <input class="ui-input" style={{ flex: 1, minWidth: 160 }} placeholder="Search case, employee, type…" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <select class="ui-select" value={module} onChange={e => setModule((e.target as HTMLSelectElement).value)}>
          <option value="">All modules</option>
          {modules.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}
        </select>
        <select class="ui-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {HANDOFF_STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>

      {handoffsQ.isLoading && !handoffsQ.data ? <div class="obx-empty">Loading…</div>
        : !rows.length ? <div class="obx-section"><div class="obx-empty">No handoffs match these filters.</div></div>
        : lanes.map(([mod, items]) => (
          <div class="obx-lane" key={mod}>
            <div class="obx-lane-head"><i class={`fas ${moduleIcon(mod)}`} />{moduleLabel(mod)}<span class="obx-lane-count">{items.length}</span></div>
            <div class="obx-section">
              <div class="obx-section-body">
                <table class="obx-table">
                  <thead><tr><th>Case</th><th>Employee</th><th>Type</th><th>Owner</th><th>Status</th><th>Last event</th><th>Actions</th></tr></thead>
                  <tbody>{items.map(h => (
                    <tr key={h.handoffId}>
                      <td><b>{h.caseNo}</b></td>
                      <td class="obx-meta">{h.employeeName ?? '—'}</td>
                      <td class="obx-meta">{humanize(h.handoffType ?? '—')}</td>
                      <td class="obx-meta">{h.ownerName ?? '—'}</td>
                      <td>
                        <span class={`obx-pill ${pillClass(handoffStatusPill(h.status))}`}>{handoffStatusPill(h.status).label}</span>
                        {h.status === 'failed' && h.failureReason && <div class="obx-meta" style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{h.failureReason}</div>}
                      </td>
                      <td class="obx-meta">{fmtDateTime(h.lastEventAt ?? h.createdAt)}</td>
                      <td>
                        <div class="obx-rowbtns" style={{ flexWrap: 'wrap' }}>
                          <button class="obx-mini" onClick={() => setPayloadRow(h)}>Payload</button>
                          <button class="obx-mini" onClick={() => onOpenCase(h.caseId)}>Open Case</button>
                          {lifecycleActions(h)}
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        ))}

      {payloadRow && (
        <Modal open title={`Handoff payload — ${moduleLabel(payloadRow.targetModule)}`} icon="fa-code" onClose={() => setPayloadRow(null)}
          footer={<button class="obx-btn" onClick={() => setPayloadRow(null)}>Close</button>}>
          <div style={{ marginBottom: 10, fontSize: 13, color: '#64748b' }}>
            {payloadRow.caseNo}{payloadRow.employeeName ? ` · ${payloadRow.employeeName}` : ''} · {humanize(payloadRow.handoffType ?? '—')}
          </div>
          <pre class="obx-payload">{JSON.stringify(payloadRow.payload ?? {}, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}
