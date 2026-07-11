/**
 * src/components/sections/AccessControl/pages/AcCreateRolePage.tsx
 *
 * Access Control — Create / Edit Role wizard (reproduces rbac-mockups/create-role.html):
 * a 4-step modal — Role Details · Capability Defaults · High-Risk Review · Review &
 * Publish — with a right-hand live summary. Wired: create/update the role, apply
 * non-critical grants/revokes immediately, and submit critical grants through the
 * maker-checker flow (reason required). Same contract as CreateRolePage ({ role?, onDone }).
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { useCreateRole, useUpdateRole, useRolePermissions } from '@sections/SuperadminConsole/hooks';
import { setRolePermissionApi, setRolePermissionWithReasonApi, type RoleRow } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import { toast } from '@store/ui';

const STEPS = [
  { n: 1, title: 'Role Details', desc: 'Define role information and scope' },
  { n: 2, title: 'Capability Defaults', desc: 'Select default access capabilities' },
  { n: 3, title: 'High-Risk Review', desc: 'Review and confirm high-risk capabilities' },
  { n: 4, title: 'Review & Publish', desc: 'Review summary and publish role' },
];
const MOD_STYLE: Record<string, { icon: string; bg: string; fg: string }> = {
  Finance: { icon: 'fa-dollar-sign', bg: 'var(--green-bg)', fg: 'var(--green)' },
  HR: { icon: 'fa-user', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  HSE: { icon: 'fa-helmet-safety', bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  Operations: { icon: 'fa-gears', bg: 'var(--purple-bg)', fg: 'var(--purple)' },
};
const modStyle = (m: string) => MOD_STYLE[m] ?? { icon: 'fa-cube', bg: '#eef1f7', fg: '#64748b' };

export function AcCreateRolePage({ role: existingRole, onDone }: { role?: RoleRow; onDone: () => void }): VNode {
  const [step, setStep] = useState(1);
  const [label, setLabel] = useState(existingRole?.label ?? '');
  const [description, setDesc] = useState(existingRole?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [openMods, setOpen] = useState<Set<string>>(new Set());
  const [capSearch, setCapSearch] = useState('');
  const [publishing, setPublishing] = useState(false);

  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const existingPermsQ = useRolePermissions(existingRole?.name ?? null);
  useEffect(() => { if (existingRole && existingPermsQ.data) setSelected(new Set(existingPermsQ.data)); }, [existingRole, existingPermsQ.data]);

  const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const groups = useMemo(() => {
    const byMod = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      if (capSearch && !PERMISSION_META[k]!.label.toLowerCase().includes(capSearch.toLowerCase())) continue;
      const m = PERMISSION_META[k]!.module; (byMod.get(m) ?? byMod.set(m, []).get(m)!).push(k);
    }
    return byMod;
  }, [capSearch]);

  const prev = useMemo(() => new Set(existingRole ? (existingPermsQ.data ?? []) : []), [existingRole, existingPermsQ.data]);
  const newCritical = useMemo(() => [...selected].filter(k => CRITICAL_GRANT_KEYS.has(k) && !prev.has(k)), [selected, prev]);
  const summary = useMemo(() => ({
    selected: selected.size,
    modules: new Set([...selected].map(k => PERMISSION_META[k as PermissionKey]?.module)).size,
    critical: [...selected].filter(k => CRITICAL_GRANT_KEYS.has(k)).length,
  }), [selected]);

  const toggle = (k: string) => setSelected(prevS => { const n = new Set(prevS); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleMod = (m: string) => setOpen(p => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; });
  const selectAllIn = (keys: PermissionKey[], on: boolean) => setSelected(p => { const n = new Set(p); keys.forEach(k => on ? n.add(k) : n.delete(k)); return n; });

  const canNext = step === 1 ? label.trim().length >= 2 : step === 3 ? (newCritical.length === 0 || reason.trim().length > 0) : true;

  const publish = async () => {
    if (!name || publishing) return;
    const roleName = existingRole?.name ?? name;
    setPublishing(true);
    try {
      const res = existingRole
        ? await updateRole.mutateAsync({ roleName, patch: { label: label.trim(), description: description.trim() } })
        : await createRole.mutateAsync({ name, label: label.trim(), description: description.trim() });
      if (!res.success) { toast.error(res.message ?? 'Failed to save role.'); return; }

      const toRevoke = existingRole ? [...prev].filter(k => !selected.has(k)) : [];
      const toGrant = [...selected].filter(k => !prev.has(k));
      const critical = toGrant.filter(k => CRITICAL_GRANT_KEYS.has(k));
      const normal = toGrant.filter(k => !CRITICAL_GRANT_KEYS.has(k));

      const results = await Promise.allSettled([
        ...normal.map(k => setRolePermissionApi(roleName, k, true)),
        ...toRevoke.map(k => setRolePermissionApi(roleName, k, false)),
      ]);
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

      const crit = await Promise.allSettled(critical.map(k => setRolePermissionWithReasonApi(roleName, k, true, reason.trim())));
      const pendingN = crit.filter(r => r.status === 'fulfilled' && r.value.success && r.value.pending).length;
      const critFailed = crit.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

      const bits: string[] = [];
      if (normal.length + toRevoke.length - failed > 0) bits.push(`${normal.length + toRevoke.length - failed} applied`);
      if (pendingN > 0) bits.push(`${pendingN} sent for approval`);
      if (failed + critFailed > 0) bits.push(`${failed + critFailed} failed`);
      const head = `Role "${label.trim()}" ${existingRole ? 'updated' : 'created'}`;
      if (failed + critFailed > 0) { toast.error(`${head} — ${bits.join(', ')}. Fix the failed capabilities and retry.`); return; }
      toast.success(bits.length ? `${head} — ${bits.join(', ')}` : head);
      onDone();
    } catch { toast.error('An error occurred. Please try again.'); }
    finally { setPublishing(false); }
  };

  const stepNum = (s: { n: number }) => step === s.n ? 'cr-step-active' : step > s.n ? 'cr-step-done' : 'cr-step-inactive';

  return (
    <div class="acx"><div class="acx-cr-overlay"><div class="cr-modal">
      <div class="cr-header">
        <span class="cr-header-ico"><i class="fas fa-user-gear" /></span>
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="row" style={{ gap: '10px', alignItems: 'center' }}>
            <span class="cr-modal-title">{existingRole ? 'Edit Role' : 'Create Role'}</span>
            <span class="badge grey">{existingRole ? 'Editing' : 'Draft'}</span>
          </div>
          <div class="cr-modal-sub">Define role details, assign capabilities, and publish with appropriate approvals.</div>
        </div>
        <button class="cr-close" onClick={onDone}><i class="fas fa-xmark" /></button>
      </div>

      <div class="cr-body">
        {/* Step rail */}
        <div class="cr-rail">
          <div class="cr-stepper">
            {STEPS.map((s, i) => (
              <div class="cr-step-row" key={s.n} onClick={() => (s.n < step || canNext) && setStep(s.n)}>
                <div class="cr-step-left">
                  <div class={`cr-step-num ${stepNum(s)}`}>{step > s.n ? <i class="fas fa-check" style={{ fontSize: '11px' }} /> : s.n}</div>
                  {i < STEPS.length - 1 && <div class="cr-step-line" />}
                </div>
                <div class={`cr-step-info${step === s.n ? ' cr-step-info-active' : ''}`}>
                  <div class="cr-step-title">{s.title}</div>
                  <div class="cr-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div class="cr-info-box">
            <i class="fas fa-triangle-exclamation" />
            <div><div class="cr-info-title">Approval Required for Critical Capabilities</div><div class="cr-info-body">Roles with high-risk capabilities require approval (Maker-Checker) before access is granted.</div></div>
          </div>
        </div>

        {/* Form */}
        <div class="cr-form">
          {step === 1 && (
            <>
              <div class="cr-section-head"><div class="cr-section-title">Role Details</div><div class="cr-section-sub">Provide basic information and scope for this role.</div></div>
              <div class="grid-2" style={{ marginBottom: '16px' }}>
                <div><label class="field-lbl">Role Name <span class="req">*</span></label><input class="input" value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} placeholder="e.g. Finance Manager" />{name && <div class="sub" style={{ marginTop: '5px' }}>Key: <span class="mono">{name}</span></div>}</div>
                <div><label class="field-lbl">Role Type</label><div class="cr-sel-wrap"><i class="fas fa-tag cr-sel-ico" /><select class="select" style={{ paddingLeft: '34px' }} disabled><option>{existingRole?.isSystem ? 'System Role' : 'Custom Role'}</option></select></div></div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label class="field-lbl">Description</label>
                <div style={{ position: 'relative' }}><textarea class="input" style={{ resize: 'none', height: '82px', paddingBottom: '26px' }} maxLength={250} value={description} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} placeholder="What is this role for?" /><span class="cr-char-count">{description.length}/250</span></div>
              </div>
              <div class="grid-2">
                <div><label class="field-lbl">Assignment Scope</label><div class="cr-sel-wrap"><i class="fas fa-globe cr-sel-ico" /><select class="select" style={{ paddingLeft: '34px' }}><option>Global (All Organizations)</option><option>Department Scoped</option></select></div></div>
                <div><label class="field-lbl">Approval Requirement</label><div class="cr-sel-wrap"><i class="fas fa-shield-halved cr-sel-ico" /><select class="select" style={{ paddingLeft: '34px' }}><option>Require Approval (Maker-Checker)</option></select></div></div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div class="between" style={{ marginBottom: '12px', alignItems: 'flex-start' }}>
                <div><div class="cr-section-title">Capability Defaults</div><div class="cr-section-sub">Select the default access capabilities for this role.</div></div>
                <span class="link" onClick={() => setOpen(new Set(openMods.size === groups.size ? [] : groups.keys()))}>{openMods.size === groups.size ? 'Collapse All' : 'Expand All'}</span>
              </div>
              <div style={{ position: 'relative', marginBottom: '12px' }}><i class="fas fa-magnifying-glass" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)', fontSize: '12px' }} /><input class="input" placeholder="Search capabilities…" style={{ paddingLeft: '34px' }} value={capSearch} onInput={e => setCapSearch((e.target as HTMLInputElement).value)} /></div>
              <div class="cr-accordion">
                {[...groups.entries()].map(([mod, keys]) => {
                  const st = modStyle(mod); const open = openMods.has(mod); const sel = keys.filter(k => selected.has(k)).length; const allOn = sel === keys.length;
                  return (
                    <div class={`cr-acc-group${open ? ' cr-acc-open' : ''}`} key={mod}>
                      <div class="cr-acc-head" onClick={() => toggleMod(mod)}>
                        <span class="cr-acc-ico" style={{ background: st.bg, color: st.fg }}><i class={`fas ${st.icon}`} /></span>
                        <div class="grow"><div class="cr-acc-name">{mod}</div><div class="cr-acc-desc">{keys.length} capabilities</div></div>
                        <span class={`cr-acc-count${sel > 0 ? ' cr-acc-count-active' : ''}`}>{sel} of {keys.length} selected</span>
                        <i class={`fas fa-chevron-${open ? 'down' : 'right'} cr-acc-chev`} />
                      </div>
                      {open && (
                        <div class="cr-acc-body">
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}><span class="link" onClick={() => selectAllIn(keys, !allOn)}>{allOn ? 'Deselect all' : 'Select all'}</span></div>
                          <div class="cr-cap-grid">
                            {keys.map(k => (
                              <div class="cr-cap-row" key={k} onClick={() => toggle(k)}>
                                <span class={`check${selected.has(k) ? ' on' : ''}`}>{selected.has(k) && <i class="fas fa-check" />}</span>
                                <span class="cr-cap-name">{PERMISSION_META[k]!.label}</span>
                                {CRITICAL_GRANT_KEYS.has(k) && <span class="badge red" style={{ fontSize: '10.5px', padding: '2px 7px', marginLeft: '5px' }}>High Risk</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div class="cr-section-head"><div class="cr-section-title">High-Risk Review</div><div class="cr-section-sub">These capabilities require maker-checker approval before they take effect.</div></div>
              {newCritical.length === 0 ? <div class="ac-empty">No new high-risk capabilities selected — nothing needs approval.</div> : (
                <>
                  <div class="cr-accordion" style={{ marginBottom: '16px' }}>
                    {newCritical.map(k => (
                      <div class="cr-acc-group" key={k}><div class="cr-acc-head" style={{ cursor: 'default' }}><span class="cr-acc-ico" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}><i class="fas fa-shield-halved" /></span><div class="grow"><div class="cr-acc-name">{PERMISSION_META[k as PermissionKey]!.label}</div><div class="cr-acc-desc">{PERMISSION_META[k as PermissionKey]!.module}</div></div><span class="badge red">High Risk</span></div></div>
                    ))}
                  </div>
                  <label class="field-lbl">Reason for granting these critical capabilities <span class="req">*</span></label>
                  <textarea class="input" style={{ height: '82px', resize: 'none' }} value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} placeholder="Justify why this role needs these high-risk capabilities…" />
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div class="cr-section-head"><div class="cr-section-title">Review &amp; Publish</div><div class="cr-section-sub">Confirm the role configuration before publishing.</div></div>
              <div class="card" style={{ marginBottom: '14px' }}><div class="card-pad">
                <div class="between" style={{ marginBottom: '8px' }}><span class="muted">Role name</span><b>{label.trim() || '—'}</b></div>
                <div class="between" style={{ marginBottom: '8px' }}><span class="muted">Capabilities selected</span><b>{summary.selected}</b></div>
                <div class="between" style={{ marginBottom: '8px' }}><span class="muted">High-risk (approval-gated)</span><b style={{ color: 'var(--red)' }}>{summary.critical}</b></div>
                <div class="between"><span class="muted">Description</span><span class="muted" style={{ maxWidth: '60%', textAlign: 'right' }}>{description.trim() || '—'}</span></div>
              </div></div>
              {newCritical.length > 0 && <div class="cr-info-box" style={{ marginBottom: '0' }}><i class="fas fa-triangle-exclamation" /><div><div class="cr-info-title">{newCritical.length} capability(ies) will be submitted for approval</div><div class="cr-info-body">Non-critical grants apply immediately; critical grants become effective after a second superadmin approves.</div></div></div>}
            </>
          )}
        </div>

        {/* Summary */}
        <div class="cr-summary">
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px' }}>Role Summary</div>
          <div class="cr-sum-tiles">
            <div class="cr-sum-tile"><span class="cr-tile-ico blue"><i class="fas fa-table-cells" /></span><div><div class="cr-sum-val">{summary.selected}</div><div class="cr-sum-lbl">Selected Capabilities</div><div class="sub">Across {summary.modules} modules</div></div></div>
            <div class="cr-sum-tile"><span class="cr-tile-ico red"><i class="fas fa-shield-halved" /></span><div><div class="cr-sum-val" style={{ color: 'var(--red)' }}>{summary.critical}</div><div class="cr-sum-lbl">High-Risk Capabilities</div><div class="sub">Require additional review</div></div></div>
            <div class="cr-sum-tile"><span class="cr-tile-ico green"><i class="fas fa-users" /></span><div><div class="cr-sum-val">{existingRole?.userCount ?? 0}</div><div class="cr-sum-lbl">Users Impacted</div><div class="sub">Current members</div></div></div>
            <div class="cr-sum-tile"><span class="cr-tile-ico amber"><i class="fas fa-clock" /></span><div><div class="cr-sum-val" style={{ fontSize: '15px', marginTop: '2px' }}>Maker-Checker</div><div class="cr-sum-lbl">Approval Workflow</div><div class="sub">2-step approval</div></div></div>
          </div>
        </div>
      </div>

      <div class="cr-footer">
        <button class="btn" onClick={onDone}>Cancel</button>
        <div class="row" style={{ gap: '10px' }}>
          {step > 1 && <button class="btn" onClick={() => setStep(step - 1)}><i class="fas fa-arrow-left" /> Back</button>}
          {step < 4 ? <button class="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next <i class="fas fa-arrow-right" /></button>
                    : <button class="btn primary" disabled={publishing || !name} onClick={publish}><i class="fas fa-circle-check" /> {publishing ? 'Publishing…' : (existingRole ? 'Save Role' : 'Publish Role')}</button>}
        </div>
      </div>
    </div></div></div>
  );
}
