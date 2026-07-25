import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { HrfinPill } from '@ui';
import { usePayGroups } from '@api/finance/payroll';
import {
  payPoliciesApi, usePayPolicies, usePayPolicy, usePayPolicyMutation, usePayPolicyOverview,
  type PayPolicyOverview, type PayPolicyType, type PayPolicyWorkspace,
} from '@api/finance/payPolicies';
import { PayPolicyWizard } from './PayPolicyWizard';
import './payPolicySetup.css';

const today = (): string => new Date().toISOString().slice(0, 10);
const key = (): string => crypto.randomUUID();
const title = (v: string): string => v.replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const detailTabs = ['overview', 'components', 'sources', 'costing', 'versions', 'usage', 'audit'] as const;

const POLICY_TYPE_LABEL: Record<PayPolicyType, string> = {
  standard_salary: 'Standard salaried', hourly_shift: 'Hourly / shift',
  offshore_rotation: 'Offshore rotation', marine_voyage: 'Marine / voyage',
};
const PAY_BASIS_LABEL: Record<PayPolicyType, string> = {
  standard_salary: 'Salary + allowances', hourly_shift: 'Hours + premiums',
  offshore_rotation: 'Offshore day rate', marine_voyage: 'Sea-day rate',
};
const policyGlyph = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
};
const fmtDay = (iso: string | null): string =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtActivity = (iso: string): string => {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10) === today()
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const integrityColor: Record<PayPolicyOverview['integrity'][number]['tone'], string> = {
  ok: 'var(--gn-ink)', warning: 'var(--am-ink)', danger: 'var(--rd)',
};

function replaceQueryValue(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url);
}

export function PayPolicySetup({ onFullPage }: { onFullPage?: (v: boolean) => void } = {}): VNode {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get('policy'));
  const [wizard, setWizard] = useState(false);
  const list = usePayPolicies({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
  const overview = usePayPolicyOverview();
  const canDraft = can('finance.payroll.policies.draft');
  useEffect(() => {
    replaceQueryValue('policy', selected);
    if (!selected) replaceQueryValue('policyTab', null);
  }, [selected]);
  // Wizard and policy detail are full-page views — tell the shell to hide its header + tabs.
  useEffect(() => {
    onFullPage?.(wizard || selected != null);
    return () => onFullPage?.(false);
  }, [wizard, selected, onFullPage]);

  if (wizard) return <PayPolicyWizard onClose={() => setWizard(false)} onCreated={id => { setWizard(false); setSelected(id); }} />;
  if (selected) return <PayPolicyDetail policyId={selected} onBack={() => setSelected(null)} />;

  const next = (): void => {
    if (!list.data?.nextCursor) return;
    setCursorHistory(h => [...h, cursor ?? '']);
    setCursor(list.data.nextCursor);
  };
  const previous = (): void => {
    const prior = cursorHistory.at(-1);
    setCursor(prior ?? undefined);
    setCursorHistory(h => h.slice(0, -1));
  };

  const ov = overview.data;
  const m = ov?.metrics;

  return (
    <div class="pps">
      {/* Command band — configuration position, all figures derived from the overview read model */}
      <section class="pps-band" aria-label="Configuration position">
        <div class="pps-band-lead">
          <span>Configuration position</span>
          <h2>{ov ? `${ov.band.configuredPolicies} configured pay ${ov.band.configuredPolicies === 1 ? 'policy' : 'policies'}` : 'Pay policy configuration'}</h2>
        </div>
        <div class="pps-fact"><span>Covered employees</span><strong>{ov ? ov.band.coveredEmployees : '—'}</strong></div>
        <div class="pps-fact"><span>Pay groups</span><strong>{ov ? `${ov.band.payGroupsAssigned} assigned` : '—'}</strong></div>
        <div class="pps-fact"><span>Draft versions</span><strong>{ov ? `${ov.band.draftVersions} in review` : '—'}</strong></div>
        <div class="pps-fact"><span>Next effective date</span><strong>{ov?.band.nextEffectiveDate ? fmtDay(ov.band.nextEffectiveDate) : '—'}</strong></div>
        <div class="pps-fact"><span>Integrity</span><strong>{ov ? (ov.band.integrityFindings ? `${ov.band.integrityFindings} finding${ov.band.integrityFindings === 1 ? '' : 's'}` : 'Clean') : '—'}</strong></div>
      </section>

      {/* Metric row */}
      <section class="pps-metrics" aria-label="Pay policy metrics">
        <div class="pps-metric"><div class="pps-mico blue">P</div><div><div class="k">Active policies</div><div class="v">{m ? m.activePolicies : '—'}</div><div class="s">{m ? `${m.retiringPolicies} retiring · ${m.pendingVersions} pending version` : ' '}</div></div></div>
        <div class="pps-metric"><div class="pps-mico green">#</div><div><div class="k">Assigned employees</div><div class="v">{m ? m.assignedEmployees : '—'}</div><div class="s">Effective today</div></div></div>
        <div class="pps-metric"><div class="pps-mico blue">W</div><div><div class="k">Work patterns</div><div class="v">{m ? m.workPatterns : '—'}</div><div class="s">{m ? (m.workPatternLabels.join(', ') || 'None active') : ' '}</div></div></div>
        <div class={`pps-metric${m?.setupFindings ? ' is-flag' : ''}`}><div class={`pps-mico ${m?.setupFindings ? 'amber' : 'green'}`}>!</div><div><div class="k">Setup findings</div><div class="v">{m ? m.setupFindings : '—'}</div><div class="s">{m ? (m.blockingFindings ? `${m.blockingFindings} blocks activation` : 'None blocking') : ' '}</div></div></div>
        <div class="pps-metric"><div class="pps-mico blue">V</div><div><div class="k">Versions this year</div><div class="v">{m ? m.versionsThisYear : '—'}</div><div class="s">All changes retained</div></div></div>
      </section>

      {/* Activation-blocked banner — only when a real in-review version has preflight blockers */}
      {ov?.banner && (
        <section class="pps-banner">
          <div class="pps-bico">!</div>
          <div class="pps-btext">
            <div class="pps-beyebrow">ACTIVATION BLOCKED</div>
            <div class="pps-btitle">{ov.banner.title}</div>
            <div class="pps-bsub">{ov.banner.detail}</div>
          </div>
          <div class="pps-bbtns"><button type="button" class="is-primary" onClick={() => setSelected(ov.banner!.policyId)}>Review draft</button></div>
          <div class="pps-bmeta"><div class="k">OWNER</div><div class="v">{ov.banner.ownerLabel}</div></div>
        </section>
      )}

      <div class="pps-grid">
        <div class="pps-col">
          {/* Policy directory */}
          <section class="pps-card">
            <div class="pps-sechead">
              <div class="pps-sico">P</div>
              <div><strong>Policy directory</strong><span>Approved configurations and pending versions available to pay groups.</span></div>
              <div class="aux">
                <button type="button" onClick={() => { void list.refetch(); void overview.refetch(); }}>Refresh</button>
                {canDraft && <button type="button" class="is-primary" onClick={() => setWizard(true)}>+ New pay policy</button>}
              </div>
            </div>
            <div class="pps-tabs" role="tablist" aria-label="Policy Status">
              {['', 'draft', 'active', 'retired'].map(s => (
                <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} class={status === s ? 'active' : ''}
                  onClick={() => { setStatus(s); setCursor(undefined); setCursorHistory([]); }}>{s ? title(s) : 'All Policies'}</button>
              ))}
            </div>
            <div class="pps-toolbar">
              <input aria-label="Search Pay Policies" value={search} placeholder="Search policy, code or pay group…"
                onInput={e => { setSearch(e.currentTarget.value); setCursor(undefined); setCursorHistory([]); }} />
              <span>{list.data ? `${list.data.total} polic${list.data.total === 1 ? 'y' : 'ies'}` : 'Loading…'}</span>
            </div>
            <div class="pps-register" aria-live="polite">
              {list.isLoading ? <div class="pps-state">Loading Pay Policies…</div>
                : list.isError ? <div class="pps-state is-error">Pay Policies Could Not Be Loaded. <button onClick={() => void list.refetch()}>Retry</button></div>
                : !list.data?.items.length ? <div class="pps-state">{search || status ? 'No pay policies match this view.' : 'No pay policies yet — create the first one.'}</div>
                : (
                  <table>
                    <thead><tr><th>Policy</th><th>Work pattern</th><th>Pay basis</th><th class="num">Pay groups</th><th>Current version</th><th>Status</th><th aria-label="Open" /></tr></thead>
                    <tbody>{list.data.items.map(p => (
                      <tr key={p.id} onClick={() => setSelected(p.id)} class="pps-row">
                        <td><div class="pps-pkg"><span class="pps-glyph">{policyGlyph(p.name)}</span><div><strong>{p.name}</strong><small>{p.code}</small></div></div></td>
                        <td>{POLICY_TYPE_LABEL[p.policyType]}</td>
                        <td>{PAY_BASIS_LABEL[p.policyType]}</td>
                        <td class="num">{p.assignmentCount}</td>
                        <td>{p.currentVersion ? <>v{p.currentVersion.versionNo} <small>{fmtDay(p.currentVersion.effectiveFrom)}</small></> : '—'}</td>
                        <td><HrfinPill tone={p.status === 'active' ? 'ok' : p.status === 'retired' ? 'nu' : 'wn'}>{title(p.status)}</HrfinPill></td>
                        <td><button type="button" aria-label={`Open ${p.name}`} onClick={e => { e.stopPropagation(); setSelected(p.id); }}>→</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
            </div>
            <div class="pps-footer">
              <span>{list.data ? `Showing ${list.data.items.length} Of ${list.data.total}` : '—'}</span>
              <div><button type="button" disabled={!cursorHistory.length} onClick={previous}>Previous</button><button type="button" disabled={!list.data?.nextCursor} onClick={next}>Next</button></div>
            </div>
          </section>

          {/* Configuration dependencies */}
          <section class="pps-card">
            <div class="pps-sechead">
              <div class="pps-sico">L</div>
              <div><strong>Configuration dependencies</strong><span>Each active policy resolves these governed records before a run can snapshot it.</span></div>
            </div>
            <div class="pps-composition">
              <div><b>1</b><strong>Statutory profile</strong><span>PAYE, NIS and Health Surcharge version selected by pay date and employee determination.</span></div>
              <div><b>2</b><strong>Work pattern &amp; time rules</strong><span>Calendar, shift or crew rotation pattern with qualifying-time controls.</span></div>
              <div><b>3</b><strong>Pay components</strong><span>Catalogued earnings and deductions with typed rate basis and eligibility rules.</span></div>
              <div><b>4</b><strong>Cost &amp; payment policy</strong><span>Cost-centre dimension plus TTD disbursement controls.</span></div>
            </div>
          </section>
        </div>

        <aside class="pps-col">
          {/* Policy integrity */}
          <section class="pps-card">
            <div class="pps-sechead pps-sechead--plain"><strong>Policy integrity</strong></div>
            <div class="pps-summary">
              {overview.isLoading && !ov ? <div class="pps-state">Checking…</div>
                : !ov ? <div class="pps-state">Integrity unavailable.</div>
                : ov.integrity.map(r => (
                  <div class="pps-srow" key={r.code}><span>{r.label}</span><strong style={{ color: integrityColor[r.tone] }}>{r.value}</strong></div>
                ))}
            </div>
          </section>

          {/* Upcoming changes */}
          <section class="pps-card">
            <div class="pps-sechead pps-sechead--plain"><strong>Upcoming changes</strong></div>
            <div class="pps-attention">
              {ov?.upcoming.length === 0 ? <div class="pps-state">No scheduled changes.</div>
                : (ov?.upcoming ?? []).map((u, i) => (
                  <button type="button" class="pps-arow" key={`${u.policyId}-${i}`} onClick={() => setSelected(u.policyId)}>
                    <span class={`pps-signal ${u.tone}`} />
                    <div class="pps-acopy"><strong>{u.title}</strong><small>{u.detail}</small></div>
                    <span class="pps-ameta">{u.meta}</span>
                  </button>
                ))}
            </div>
          </section>

          {/* Recent activity */}
          <section class="pps-card">
            <div class="pps-sechead pps-sechead--plain"><strong>Recent activity</strong></div>
            <div class="pps-acts">
              {ov?.activity.length === 0 ? <div class="pps-state">No policy activity yet.</div>
                : (ov?.activity ?? []).map(a => (
                  <div class="pps-act" key={a.id}>
                    <div class={`pps-adot ${a.tone}`} />
                    <div><div class="pps-at">{a.label}</div><div class="pps-as">{a.detail}</div></div>
                    <div class="pps-am">{fmtActivity(a.occurredAt)}</div>
                  </div>
                ))}
            </div>
          </section>
        </aside>
      </div>

    </div>
  );
}

function PayPolicyDetail({ policyId, onBack }: { policyId: string; onBack: () => void }): VNode {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('policyTab');
    return requested && detailTabs.includes(requested as typeof detailTabs[number]) ? requested : 'overview';
  });
  const [editWizard, setEditWizard] = useState(false);
  const ws = usePayPolicy(policyId);
  const groups = usePayGroups();
  const submit = usePayPolicyMutation(({ versionId, requestKey }: { versionId: string; requestKey: string }) => payPoliciesApi.submit(versionId, requestKey));
  const activate = usePayPolicyMutation(({ versionId, requestKey }: { versionId: string; requestKey: string }) => payPoliciesApi.activate(policyId, versionId, requestKey));
  const copyVersion = usePayPolicyMutation(payPoliciesApi.copyVersion);
  const assign = usePayPolicyMutation(payPoliciesApi.assign);
  const endAssignment = usePayPolicyMutation(payPoliciesApi.endAssignment);
  const retire = usePayPolicyMutation(payPoliciesApi.retire);
  const [preflight, setPreflight] = useState<Awaited<ReturnType<typeof payPoliciesApi.preflight>> | null>(null);
  const [assignGroup, setAssignGroup] = useState('');
  const [assignFrom, setAssignFrom] = useState(today());
  useEffect(() => replaceQueryValue('policyTab', tab), [tab]);
  if (ws.isLoading) return <div class="pps-state">Loading Policy Workspace…</div>;
  if (ws.isError || !ws.data) return <div class="pps-state is-error">Policy Workspace Could Not Be Loaded. <button onClick={onBack}>Back To Policies</button></div>;
  const d = ws.data;
  if (editWizard) return <PayPolicyWizard workspace={d} onClose={() => setEditWizard(false)} onCreated={() => setEditWizard(false)} />;
  const version = d.version;
  const runPreflight = async (): Promise<void> => {
    if (!version) return;
    try { setPreflight(await payPoliciesApi.preflight(version.id)); } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Preflight Failed.'); }
  };
  const doSubmit = async (): Promise<void> => {
    if (!version) return;
    const pf = preflight ?? await payPoliciesApi.preflight(version.id);
    setPreflight(pf);
    if (!pf.ready) return;
    try { await submit.mutateAsync({ versionId: version.id, requestKey: key() }); toast('Pay Policy Submitted For Review.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Submission Failed.'); }
  };
  const doActivate = async (): Promise<void> => {
    if (!version) return;
    const ok = await dialog.confirm({ title: `Activate ${d.policy.code} v${version.versionNo}?`, text: 'Activation independently revalidates the checksum, supersedes the prior effective version, notifies the preparer and sends a payroll handoff.', confirmText: 'Activate Policy', icon: 'question' });
    if (!ok) return;
    try { await activate.mutateAsync({ versionId: version.id, requestKey: key() }); toast('Pay Policy Activated.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Activation Failed.'); }
  };
  const doAssign = async (): Promise<void> => {
    if (!version || !assignGroup) return;
    try { await assign.mutateAsync({ policyId, versionId: version.id, payGroupId: assignGroup, effectiveFrom: assignFrom, idempotencyKey: key() }); setAssignGroup(''); toast('Pay Group Assigned.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Assignment Failed.'); }
  };
  const doCopyVersion = async (): Promise<void> => {
    const source = d.versions.find(item => item.status === 'active');
    if (!source) return;
    const effectiveFrom = await dialog.prompt({
      title: 'Create New Policy Version', text: 'Enter the effective date for the new draft (YYYY-MM-DD).',
      value: today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveFrom === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      await dialog.error('Enter the effective date as YYYY-MM-DD.');
      return;
    }
    const changeSummary = await dialog.prompt({
      title: 'Change Summary', text: 'Describe the governed change in this version.',
      type: 'textarea', placeholder: 'Required change summary', confirmText: 'Create Draft',
    });
    if (changeSummary === null) return;
    if (changeSummary.trim().length < 3) {
      await dialog.error('A change summary of at least three characters is required.');
      return;
    }
    try {
      await copyVersion.mutateAsync({
        policyId, sourceVersionId: source.id, effectiveFrom, changeSummary: changeSummary.trim(), idempotencyKey: key(),
      });
      toast('New Pay Policy Version Created.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Version Could Not Be Created.'); }
  };
  const doEndAssignment = async (assignmentId: string, effectiveFrom: string): Promise<void> => {
    const effectiveTo = await dialog.prompt({
      title: 'End Pay-Group Assignment', text: 'Enter the final effective date (YYYY-MM-DD).',
      value: effectiveFrom > today() ? effectiveFrom : today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveTo === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom) {
      await dialog.error('Enter a valid date on or after the assignment start.');
      return;
    }
    const reason = await dialog.prompt({
      title: 'Assignment End Reason', type: 'textarea', placeholder: 'Required reason', confirmText: 'End Assignment',
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      await dialog.error('A reason of at least three characters is required.');
      return;
    }
    try {
      await endAssignment.mutateAsync({ policyId, assignmentId, effectiveTo, reason: reason.trim(), idempotencyKey: key() });
      toast('Pay-Group Assignment Ended.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Assignment Could Not Be Ended.'); }
  };
  const doRetire = async (): Promise<void> => {
    const effectiveTo = await dialog.prompt({
      title: `Retire ${d.policy.code}`, text: 'Enter the final effective date (YYYY-MM-DD).',
      value: today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveTo === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
      await dialog.error('Enter the effective date as YYYY-MM-DD.');
      return;
    }
    const reason = await dialog.prompt({
      title: 'Retirement Reason', type: 'textarea', placeholder: 'Required reason', confirmText: 'Retire Policy',
    });
    if (reason === null || reason.trim().length < 3) {
      if (reason !== null) await dialog.error('A reason of at least three characters is required.');
      return;
    }
    try {
      await retire.mutateAsync({ policyId, effectiveTo, reason: reason.trim(), idempotencyKey: key() });
      toast('Pay Policy Retired.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Policy Could Not Be Retired.'); }
  };
  return (
    <div class="pps pps-detail">
      <div class="pps-detail-head"><div><button type="button" onClick={onBack}>← Pay Policies</button><h2>{d.policy.name}</h2><span>{d.policy.code} · {title(d.policy.policyType)} · Local T&amp;T / TTD</span></div>
        <div><button type="button" onClick={() => void runPreflight()}>Run Preflight</button>
          {version?.status === 'draft' && can('finance.payroll.policies.draft') && <button type="button" onClick={() => setEditWizard(true)}>Edit Draft</button>}
          {d.policy.status === 'active' && !d.versions.some(x => ['draft', 'pending_approval', 'approved'].includes(x.status))
            && can('finance.payroll.policies.draft') && <button type="button" disabled={copyVersion.isPending} onClick={() => void doCopyVersion()}>Create New Version</button>}
          {version?.status === 'draft' && can('finance.payroll.policies.submit') && <button class="is-primary" type="button" disabled={!preflight?.ready || submit.isPending} onClick={() => void doSubmit()}>Submit For Approval</button>}
          {version?.status === 'approved' && can('finance.payroll.policies.activate') && <button class="is-primary" type="button" disabled={activate.isPending} onClick={() => void doActivate()}>Activate Policy</button>}
          {d.policy.status === 'active' && !d.versions.some(x => ['draft', 'pending_approval', 'approved'].includes(x.status))
            && can('finance.payroll.policies.activate') && <button type="button" disabled={retire.isPending} onClick={() => void doRetire()}>Retire Policy</button>}</div></div>
      <div class="pps-position">
        <div><span>Current Version</span><strong>{version ? `v${version.versionNo}` : '—'}</strong></div>
        <div><span>Version Status</span><strong>{version ? title(version.status) : '—'}</strong></div>
        <div><span>Effective From</span><strong>{version?.effectiveFrom ?? '—'}</strong></div>
        <div><span>Assigned Pay Groups</span><strong>{d.assignments.filter(x => x.status === 'active').length}</strong></div>
      </div>
      {preflight && <div class={`pps-preflight ${preflight.ready ? 'ready' : 'blocked'}`}><strong>{preflight.ready ? 'Configuration Ready' : `${preflight.blockers.length} Configuration Blockers`}</strong>
        <span>{preflight.ready ? `Checksum ${preflight.checksum.slice(0, 12)}…` : preflight.blockers.map(x => x.message).join(' ')}</span></div>}
      <nav class="pps-tabs" aria-label="Pay Policy Sections">{detailTabs.map(x => <button type="button" class={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{title(x === 'costing' ? 'cost & payment' : x)}</button>)}</nav>
      <PolicyTab tab={tab} data={d} groups={groups.data ?? []} assignGroup={assignGroup} setAssignGroup={setAssignGroup}
        assignFrom={assignFrom} setAssignFrom={setAssignFrom} onAssign={() => void doAssign()} assigning={assign.isPending}
        onEndAssignment={doEndAssignment} endingAssignment={endAssignment.isPending} />
    </div>
  );
}

function PolicyTab({ tab, data, groups, assignGroup, setAssignGroup, assignFrom, setAssignFrom, onAssign, assigning, onEndAssignment, endingAssignment }: {
  tab: string; data: PayPolicyWorkspace; groups: { id: string; code: string; name: string }[]; assignGroup: string;
  setAssignGroup: (v: string) => void; assignFrom: string; setAssignFrom: (v: string) => void; onAssign: () => void; assigning: boolean;
  onEndAssignment: (assignmentId: string, effectiveFrom: string) => Promise<void>; endingAssignment: boolean;
}): VNode {
  const v = data.version;
  const [compareFrom, setCompareFrom] = useState('');
  const [compareTo, setCompareTo] = useState('');
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof payPoliciesApi.compare>> | null>(null);
  const compareVersions = async (): Promise<void> => {
    if (!compareFrom || !compareTo) return;
    try { setComparison(await payPoliciesApi.compare(data.policy.id, compareFrom, compareTo)); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Versions Could Not Be Compared.'); }
  };
  if (tab === 'overview') return <section class="pps-panel"><h3>Policy Composition</h3><div class="pps-composition">
    <div><b>1</b><strong>Approved T&amp;T Statutory Version</strong><span>Resolved By Effective Pay Date</span></div>
    <div><b>2</b><strong>{data.components.length} Pay Components</strong><span>Canonical Catalogue Bindings</span></div>
    <div><b>3</b><strong>{data.sourceRules.length} Source Controls</strong><span>Named Owners And Conflict Outcomes</span></div>
    <div><b>4</b><strong>TTD Payment Control</strong><span>Primary Bank Account Required</span></div>
  </div></section>;
  if (tab === 'components') return <section class="pps-panel"><h3>Pay Components</h3><table><thead><tr><th>Component</th><th>Kind</th><th>Calculation Basis</th><th>Rate Source</th><th>Eligibility</th><th>State</th></tr></thead>
    <tbody>{data.components.map(c => <tr><td><strong>{c.componentName}</strong><small>{c.componentCode}</small></td><td>{title(c.componentKind)}</td><td>{title(c.calculationBasis)}</td><td>{title(c.rateSource)}</td><td>{title(c.eligibilitySource)}</td><td>{c.required ? 'Required' : 'Optional'}</td></tr>)}</tbody></table></section>;
  if (tab === 'sources') return <section class="pps-panel"><h3>Source Controls</h3>{data.sourceRules.map(s => <div class="pps-source"><div><strong>{title(s.sourceType)}</strong><small>{title(s.reconciliationKey)}</small></div><span>{title(s.ownerRole)}</span><span>{title(s.lateInputPolicy)}</span><span>{title(s.conflictOutcome)}</span></div>)}</section>;
  if (tab === 'costing') return <section class="pps-panel"><h3>Cost &amp; Payment</h3><div class="pps-review">
    <div><span>Payroll Currency</span><strong>TTD</strong></div><div><span>Payment Destination</span><strong>Primary Bank Account</strong></div>
    <div><span>Missing Bank Account</span><strong>Blocks Release</strong></div><div><span>Cost Centre</span><strong>Required From Employee Assignment</strong></div>
  </div></section>;
  if (tab === 'versions') return <section class="pps-panel"><h3>Version History</h3>
    {data.versions.length > 1 && <div class="pps-add">
      <select aria-label="Compare From Version" value={compareFrom} onChange={e => { setCompareFrom(e.currentTarget.value); setComparison(null); }}><option value="">Compare From</option>{data.versions.map(x => <option value={x.id}>v{x.versionNo}</option>)}</select>
      <select aria-label="Compare To Version" value={compareTo} onChange={e => { setCompareTo(e.currentTarget.value); setComparison(null); }}><option value="">Compare To</option>{data.versions.map(x => <option value={x.id}>v{x.versionNo}</option>)}</select>
      <button type="button" disabled={!compareFrom || !compareTo || compareFrom === compareTo} onClick={() => void compareVersions()}>Compare Versions</button>
    </div>}
    {comparison && <div class="pps-preflight ready"><strong>{comparison.changes.length ? `${comparison.changes.length} Governed Changes` : 'No Governed Differences'}</strong>
      <span>{comparison.changes.map(change => title(change.field)).join(', ') || 'The selected versions have identical effective controls, components, and sources.'}</span></div>}
    <table><thead><tr><th>Version</th><th>Effective Period</th><th>Change</th><th>Prepared By</th><th>Checksum</th><th>Status</th></tr></thead>
    <tbody>{data.versions.map(x => <tr><td>v{x.versionNo}</td><td>{x.effectiveFrom}{x.effectiveTo ? ` – ${x.effectiveTo}` : ' – Open'}</td><td>{x.changeSummary}</td><td>{x.preparedBy}</td><td>{x.checksum ? `${x.checksum.slice(0, 12)}…` : '—'}</td><td>{title(x.status)}</td></tr>)}</tbody></table></section>;
  if (tab === 'usage') return <section class="pps-panel"><h3>Pay-Group Assignments</h3>
    {v?.status === 'active' && can('finance.payroll.policies.assign') && <div class="pps-add"><select value={assignGroup} onChange={e => setAssignGroup(e.currentTarget.value)}><option value="">Select Active Pay Group</option>{groups.map(g => <option value={g.id}>{g.code} — {g.name}</option>)}</select><input type="date" value={assignFrom} onInput={e => setAssignFrom(e.currentTarget.value)} /><button type="button" disabled={!assignGroup || assigning} onClick={() => onAssign()}>Assign Pay Group</button></div>}
    {!data.assignments.length ? <div class="pps-state">No Pay Groups Are Assigned.</div> : data.assignments.map(a => <div class="pps-source"><div><strong>{a.payGroupName}</strong><small>{a.payGroupCode} · {a.memberCount} Current Members</small></div><span>{title(a.frequency)}</span><span>v{a.versionNo} From {a.effectiveFrom}</span><span>{title(a.status)}</span>
      {a.status === 'active' && can('finance.payroll.policies.assign') && <button type="button" disabled={endingAssignment} onClick={() => void onEndAssignment(a.id, a.effectiveFrom)}>End Assignment</button>}</div>)}</section>;
  return <section class="pps-panel"><h3>Policy Audit History</h3>{!data.audit.length ? <div class="pps-state">No Policy Events Yet.</div> : data.audit.map(e => <div class="pps-source"><div><strong>{title(e.type.replace('finance.payroll.policy.', ''))}</strong><small>{new Date(e.occurredAt).toLocaleString()}</small></div><span>{e.actorId ?? 'System'}</span></div>)}</section>;
}
