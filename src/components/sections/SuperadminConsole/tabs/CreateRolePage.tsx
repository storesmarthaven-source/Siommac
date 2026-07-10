/**
 * CreateRolePage.tsx
 *
 * Full-page (not a modal) 4-step wizard for creating or editing a custom role.
 * Renders as a 3-pane layout inside the console content area:
 *   [Step Rail 224px] | [Form 1fr] | [Live Summary 284px]
 *
 * Steps:
 *   1. Role Details  — name, description
 *   2. Capability Defaults — module accordion with capability checkboxes
 *   3. High-Risk Review   — confirm selected high/critical capabilities
 *   4. Review & Publish   — summary, then create + set permissions
 *
 * Vocabulary (per the canonical model):
 *   - Capabilities are "Granted" / "Not granted" (checkbox)
 *   - Risk tiers: low / medium / high / critical
 *
 * Constraints:
 *   - Backend: createRoleApi (name, label, description) + setRolePermissionApi per cap
 *   - Assignment Scope and Approval Requirement are NOT supported by the backend — omitted
 *   - High-risk role capability changes: no separate maker-checker API exists yet — logged as gap
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect, useCallback } from 'preact/hooks';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import type { RoleRow } from '@lib/superadminApi';
import { setRolePermissionApi, setRolePermissionWithReasonApi } from '@lib/superadminApi';
import { toast } from '@store/ui';
import { useCreateRole, useUpdateRole, useRolePermissions } from '../hooks';
import '../ac.css';

// Grouped modules from the catalogue
interface ModuleGroup {
  module: string;
  keys: string[];
  highRiskCount: number;
}

function buildModuleGroups(search: string): ModuleGroup[] {
  const q = search.toLowerCase().trim();
  const byModule = new Map<string, string[]>();
  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key as keyof typeof PERMISSION_META];
    if (!meta) continue;
    if (q && !meta.label.toLowerCase().includes(q) && !meta.description.toLowerCase().includes(q) && !key.includes(q)) continue;
    const list = byModule.get(meta.module) ?? [];
    if (!byModule.has(meta.module)) byModule.set(meta.module, list);
    list.push(key);
  }
  return [...byModule.entries()].map(([module, keys]) => ({
    module,
    keys,
    highRiskCount: keys.filter(k => {
      const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
      return m?.risk === 'high' || m?.risk === 'critical';
    }).length,
  })).sort((a, b) => b.keys.length - a.keys.length);
}

const MODULE_ICON: Record<string, string> = {
  HR: 'fa-user', Finance: 'fa-dollar-sign', HSE: 'fa-shield-halved',
  Communications: 'fa-comment', Workflow: 'fa-diagram-project',
  Settings: 'fa-gear', Auth: 'fa-lock',
};
const MODULE_COLOR: Record<string, { bg: string; clr: string }> = {
  HR:             { bg: 'var(--ac-accent-bg)', clr: 'var(--ac-accent)' },
  Finance:        { bg: 'var(--ac-green-bg)',  clr: 'var(--ac-green)' },
  HSE:            { bg: 'var(--ac-amber-bg)',  clr: 'var(--ac-amber)' },
  Communications: { bg: 'var(--ac-purple-bg)', clr: 'var(--ac-purple)' },
};
function modStyle(m: string) {
  return MODULE_COLOR[m] ?? { bg: '#f1f3f7', clr: '#566074' };
}
function modIcon(m: string) { return MODULE_ICON[m] ?? 'fa-cube'; }

// ── Step-rail ─────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, title: 'Role Details',        desc: 'Define role information' },
  { n: 2, title: 'Capability Defaults', desc: 'Select default access capabilities' },
  { n: 3, title: 'High-Risk Review',    desc: 'Review and confirm high-risk capabilities' },
  { n: 4, title: 'Review & Publish',    desc: 'Review summary and publish role' },
];

function StepRail({ step }: { step: number }): VNode {
  return (
    <div class="ac-cr-rail">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {STEPS.map((s, idx) => {
          const state = s.n < step ? 'done' : s.n === step ? 'active' : 'pending';
          return (
            <div key={s.n} class="ac-cr-step-row">
              <div class="ac-cr-step-left">
                <div class={`ac-cr-step-num ${state}`}>
                  {state === 'done' ? <i class="fas fa-check" style={{ fontSize: '12px' }} /> : s.n}
                </div>
                {idx < STEPS.length - 1 && <div class="ac-cr-step-line" />}
              </div>
              <div class="ac-cr-step-info">
                <div class={`ac-cr-step-title${state === 'active' ? ' active' : ''}`}>{s.title}</div>
                <div class="ac-cr-step-desc">{s.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div class="ac-cr-info-box">
        <i class="fas fa-triangle-exclamation" />
        <div>
          <div class="ac-cr-info-title">High-Risk Capabilities</div>
          <div class="ac-cr-info-body">Roles with high-risk capabilities will be flagged for review. Step-up approval for individual role-capability changes is planned.</div>
        </div>
      </div>
    </div>
  );
}

// ── Live Summary (right panel) ─────────────────────────────────────────────────

function RoleSummary({ label, description, selected }: {
  label: string;
  description: string;
  selected: Set<string>;
}): VNode {
  const highRisk = [...selected].filter(k => {
    const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
    return m?.risk === 'high' || m?.risk === 'critical';
  }).length;

  return (
    <div class="ac-cr-summary">
      <div class="ac-cr-sum-head">Role Summary</div>

      {label && (
        <div style={{ marginBottom: '14px', padding: '11px 13px', background: '#fff', border: '1px solid var(--ac-line)', borderRadius: '9px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ac-ink)', marginBottom: '3px' }}>{label}</div>
          {description && <div style={{ fontSize: '12.5px', color: 'var(--ac-muted)', lineHeight: 1.5 }}>{description}</div>}
          <div style={{ marginTop: '7px' }}>
            <span class="ac-badge grey" style={{ fontSize: '10.5px' }}>Custom</span>
          </div>
        </div>
      )}

      <div class="ac-cr-sum-tiles">
        <div class="ac-cr-sum-tile">
          <span class="ac-cr-tile-ico blue"><i class="fas fa-table-cells" /></span>
          <div>
            <div class="ac-cr-sum-val">{selected.size}</div>
            <div class="ac-cr-sum-lbl">Selected Capabilities</div>
            <div class="ac-cr-sum-hint">Across {new Set([...selected].map(k => PERMISSION_META[k as keyof typeof PERMISSION_META]?.module).filter(Boolean)).size} module(s)</div>
          </div>
        </div>
        <div class="ac-cr-sum-tile">
          <span class="ac-cr-tile-ico red"><i class="fas fa-shield-halved" /></span>
          <div>
            <div class="ac-cr-sum-val" style={{ color: highRisk > 0 ? 'var(--ac-red)' : 'var(--ac-ink)' }}>{highRisk}</div>
            <div class="ac-cr-sum-lbl">High-Risk Capabilities</div>
            <div class="ac-cr-sum-hint">Require additional review</div>
          </div>
        </div>
      </div>

      {highRisk > 0 && (
        <div style={{ padding: '10px 12px', background: 'var(--ac-amber-bg)', borderLeft: '3px solid var(--ac-amber)', borderRadius: '8px', fontSize: '12.5px', color: '#7a4a00', lineHeight: 1.5 }}>
          <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
          This role includes <strong>{highRisk}</strong> high-risk capability{highRisk !== 1 ? 'ies' : 'y'}. These will be logged for audit and flagged for review.
        </div>
      )}
    </div>
  );
}

// ── Step 1: Role Details ───────────────────────────────────────────────────────

function StepDetails({ label, description, onLabel, onDesc }: {
  label: string; description: string;
  onLabel: (v: string) => void; onDesc: (v: string) => void;
}): VNode {
  const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (
    <div>
      <div class="ac-cr-section-title">Role Details</div>
      <div class="ac-cr-section-sub">Provide basic information for this role.</div>

      <div class="ac-cr-form-grid">
        <div>
          <label class="ac-field-lbl">Display Name <span class="ac-field-req">*</span></label>
          <input class="ac-input" value={label} onInput={e => onLabel((e.target as HTMLInputElement).value)} placeholder="e.g. Finance Manager" maxLength={60} />
          {name && <div class="ac-field-hint">Internal ID: <code style={{ fontFamily: 'monospace', fontSize: '11px' }}>{name}</code></div>}
          {!label.trim() && <div class="ac-field-hint" style={{ color: 'var(--ac-red)' }}>Required</div>}
        </div>
        <div>
          <label class="ac-field-lbl">Role Type</label>
          <input class="ac-input" value="Custom Role" disabled style={{ background: '#f4f5f7', color: 'var(--ac-muted)' }} />
          <div class="ac-field-hint">New roles are always custom roles.</div>
        </div>
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label class="ac-field-lbl">Description</label>
        <textarea class="ac-textarea" value={description} onInput={e => onDesc((e.target as HTMLTextAreaElement).value)} placeholder="Briefly describe the responsibilities of this role…" maxLength={250} rows={3} />
        <div class="ac-cr-char-count">{description.length}/250</div>
      </div>
    </div>
  );
}

// ── Step 2: Capability Defaults ────────────────────────────────────────────────

function StepCapabilities({ selected, onToggle, onToggleAll }: {
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
}): VNode {
  const [capSearch, setCapSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => buildModuleGroups(capSearch), [capSearch]);

  const toggleExpand = (mod: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod); else next.add(mod);
      return next;
    });
  };

  const allKeys = PERMISSION_KEYS as unknown as string[];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div>
          <div class="ac-cr-section-title">Capability Defaults</div>
          <div class="ac-cr-section-sub" style={{ marginBottom: 0 }}>Select default access for this role.</div>
        </div>
        <button type="button" class="ac-btn sm ghost" style={{ marginTop: '2px' }} onClick={() => {
          const allSelected = allKeys.every(k => selected.has(k));
          onToggleAll(allKeys, !allSelected);
        }}>
          {allKeys.every(k => selected.has(k)) ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      <div class="ac-cr-cap-search">
        <div class="ac-cr-cap-search-wrap">
          <i class="fas fa-magnifying-glass" />
          <input value={capSearch} onInput={e => setCapSearch((e.target as HTMLInputElement).value)} placeholder="Search capabilities…" />
        </div>
      </div>

      {groups.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
          <i class="fas fa-filter" style={{ display: 'block', fontSize: '18px', marginBottom: '6px', color: '#cbd3e0' }} />
          No capabilities match the search.
        </div>
      ) : (
        <div class="ac-cr-accordion">
          {groups.map(g => {
            const isOpen = expanded.has(g.module);
            const selCount = g.keys.filter(k => selected.has(k)).length;
            const style = modStyle(g.module);
            return (
              <div key={g.module} class="ac-cr-acc-group">
                <div class={`ac-cr-acc-head${isOpen ? ' open' : ''}`} onClick={() => toggleExpand(g.module)}>
                  <span class="ac-cr-acc-ico" style={{ background: style.bg, color: style.clr }}>
                    <i class={`fas ${modIcon(g.module)}`} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="ac-cr-acc-name">{g.module}</div>
                  </div>
                  <span class={`ac-cr-acc-count${selCount > 0 ? ' has-sel' : ''}`}>
                    {selCount}/{g.keys.length} selected
                  </span>
                  {g.highRiskCount > 0 && (
                    <span class="ac-risk high" style={{ fontSize: '10.5px' }}>{g.highRiskCount} high-risk</span>
                  )}
                  <i class={`fas ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} ac-cr-acc-chev`} />
                </div>
                {isOpen && (
                  <div class="ac-cr-acc-body">
                    <div class="ac-cr-cap-grid">
                      {g.keys.map(k => {
                        const meta = PERMISSION_META[k as keyof typeof PERMISSION_META];
                        if (!meta) return null;
                        const isHigh = meta.risk === 'high' || meta.risk === 'critical';
                        return (
                          <label key={k} class="ac-cr-cap-row">
                            <input type="checkbox" checked={selected.has(k)} onChange={e => onToggle(k, (e.target as HTMLInputElement).checked)} />
                            <span class="ac-cr-cap-name">
                              {meta.label}
                              {isHigh && <span class="ac-risk high" style={{ fontSize: '10px', marginLeft: '5px' }}>High</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 3: High-Risk Review ───────────────────────────────────────────────────

function StepHighRiskReview({ selected, reason, onReason }: {
  selected: Set<string>; reason: string; onReason: (v: string) => void;
}): VNode {
  const highRiskKeys = [...selected].filter(k => {
    const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
    return m?.risk === 'high' || m?.risk === 'critical';
  });
  const criticalKeys = [...selected].filter(k => CRITICAL_GRANT_KEYS.has(k));

  if (highRiskKeys.length === 0) {
    return (
      <div>
        <div class="ac-cr-section-title">High-Risk Review</div>
        <div class="ac-cr-section-sub">No high-risk or critical capabilities selected.</div>
        <div style={{ padding: '28px', textAlign: 'center', background: 'var(--ac-green-bg)', borderRadius: '10px', color: '#157a3a', marginTop: '12px' }}>
          <i class="fas fa-circle-check" style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }} />
          <div style={{ fontWeight: 700, fontSize: '14px' }}>No high-risk capabilities</div>
          <div style={{ fontSize: '13px', marginTop: '4px', opacity: .85 }}>This role only contains standard capabilities.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div class="ac-cr-section-title">High-Risk Review</div>
      <div class="ac-cr-section-sub" style={{ marginBottom: '14px' }}>
        Review and confirm the <strong>{highRiskKeys.length}</strong> high-risk capability{highRiskKeys.length !== 1 ? 'ies' : 'y'} selected for this role.
      </div>

      <div style={{ padding: '10px 14px', background: 'var(--ac-amber-bg)', border: '1px solid rgba(217,119,6,.25)', borderLeft: '4px solid var(--ac-amber)', borderRadius: '9px', fontSize: '13px', color: '#7a4a00', marginBottom: '14px', lineHeight: 1.5 }}>
        <i class="fas fa-triangle-exclamation" style={{ marginRight: '8px' }} />
        These capabilities grant elevated access and are audited. Any <strong>critical</strong> capability is not applied on publish — it is submitted for a second superadmin's approval (maker-checker).
      </div>

      <div style={{ border: '1px solid var(--ac-line)', borderRadius: '10px', overflow: 'hidden' }}>
        {highRiskKeys.map((k, idx) => {
          const meta = PERMISSION_META[k as keyof typeof PERMISSION_META];
          if (!meta) return null;
          const isLast = idx === highRiskKeys.length - 1;
          const isCritical = CRITICAL_GRANT_KEYS.has(k);
          return (
            <div key={k} class="ac-cr-hr-row" style={{ borderBottom: isLast ? 'none' : undefined, padding: '12px 16px' }}>
              <span class="ac-cr-hr-ico"><i class="fas fa-shield-halved" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div class="ac-cr-hr-name">{meta.label}{isCritical && <span class="ac-badge red" style={{ fontSize: '10px', marginLeft: '6px' }}>Needs approval</span>}</div>
                <div class="ac-cr-hr-sub">{meta.module} · {meta.group}</div>
                <div style={{ fontSize: '11.5px', color: 'var(--ac-muted)', marginTop: '2px' }}>{meta.description}</div>
              </div>
              <span class={`ac-risk ${meta.risk}`}>{meta.risk}</span>
            </div>
          );
        })}
      </div>

      {criticalKeys.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <label class="ac-field-lbl">
            Reason for requesting {criticalKeys.length} critical capability{criticalKeys.length !== 1 ? 'ies' : 'y'} <span class="ac-field-req">*</span>
          </label>
          <textarea class="ac-textarea" value={reason} onInput={e => onReason((e.target as HTMLTextAreaElement).value)}
            placeholder="Describe why this role needs these critical capabilities and who authorised it…" maxLength={500} rows={3} />
          <div class="ac-field-hint">Shown to the approving superadmin and recorded in the audit log. Required to submit the critical grants for approval.</div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Review & Publish ───────────────────────────────────────────────────

function StepReview({ label, description, selected }: {
  label: string; description: string; selected: Set<string>;
}): VNode {
  const modules = [...new Set([...selected].map(k => PERMISSION_META[k as keyof typeof PERMISSION_META]?.module).filter(Boolean))];
  const highRisk = [...selected].filter(k => {
    const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
    return m?.risk === 'high' || m?.risk === 'critical';
  }).length;

  return (
    <div>
      <div class="ac-cr-section-title">Review &amp; Publish</div>
      <div class="ac-cr-section-sub">Review the role configuration before publishing.</div>

      <div style={{ border: '1px solid var(--ac-line)', borderRadius: '11px', overflow: 'hidden', marginBottom: '14px' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--ac-line)', background: '#f9fafb' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ac-faint)', marginBottom: '8px' }}>Role Details</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--ac-ink)', marginBottom: '3px' }}>{label}</div>
          {description && <div style={{ fontSize: '13px', color: 'var(--ac-muted)' }}>{description}</div>}
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <span class="ac-badge grey">Custom Role</span>
            {highRisk > 0 && <span class="ac-badge red"><i class="fas fa-shield-halved" style={{ fontSize: '10px' }} /> {highRisk} High-Risk</span>}
          </div>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ac-faint)', marginBottom: '10px' }}>Capabilities</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '12.5px' }}>
            <div style={{ background: 'var(--ac-accent-bg)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: '22px', color: 'var(--ac-accent)' }}>{selected.size}</div>
              <div style={{ color: '#1d4ed8', fontWeight: 600, fontSize: '12px' }}>Total Selected</div>
            </div>
            <div style={{ background: 'var(--ac-red-bg)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: '22px', color: 'var(--ac-red)' }}>{highRisk}</div>
              <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: '12px' }}>High-Risk</div>
            </div>
            <div style={{ background: '#f1f3f7', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: '22px', color: 'var(--ac-ink)' }}>{modules.length}</div>
              <div style={{ color: '#566074', fontWeight: 600, fontSize: '12px' }}>Modules</div>
            </div>
          </div>
          {modules.length > 0 && (
            <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--ac-muted)' }}>
              Modules: {modules.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────────────────────

export interface CreateRolePageProps {
  /** When editing an existing role, pass it here. New role = undefined. */
  role?: RoleRow;
  onDone: () => void;
}

export function CreateRolePage({ role: existingRole, onDone }: CreateRolePageProps): VNode {
  const [step, setStep] = useState(1);
  const [label, setLabel]       = useState(existingRole?.label ?? '');
  const [description, setDesc]  = useState(existingRole?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [criticalReason, setCriticalReason] = useState('');
  const [publishing, setPublishing] = useState(false);

  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  // Load existing permissions if editing
  const existingPermsQ = useRolePermissions(existingRole?.name ?? null);
  // Initialise selected set from existing permissions once loaded (runs when data arrives)
  useEffect(() => {
    if (existingRole && existingPermsQ.data) {
      setSelected(new Set(existingPermsQ.data));
    }
  }, [existingRole, existingPermsQ.data]);

  const toggle = useCallback((key: string, on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback((keys: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) keys.forEach(k => next.add(k)); else keys.forEach(k => next.delete(k));
      return next;
    });
  }, []);

  const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Critical capabilities are not applied on publish — they are submitted for approval, so a
  // reason is required before the wizard can advance past the High-Risk Review step.
  const criticalCaps = useMemo(() => [...selected].filter(k => CRITICAL_GRANT_KEYS.has(k)), [selected]);

  const canNext: boolean = (() => {
    if (step === 1) return label.trim().length >= 2 && label.trim().length <= 60;
    if (step === 2) return true; // no mandatory caps
    if (step === 3) return criticalCaps.length === 0 || criticalReason.trim().length > 0;
    return false;
  })();

  const publish = async () => {
    if (!name || publishing) return;
    const roleName = existingRole?.name ?? name;
    setPublishing(true);
    try {
      // 1. Create or update the role record first.
      if (existingRole) {
        const res = await updateRole.mutateAsync({ roleName, patch: { label: label.trim(), description: description.trim() } });
        if (!res.success) { toast.error(res.message ?? 'Failed to update role.'); return; }
      } else {
        const res = await createRole.mutateAsync({ name, label: label.trim(), description: description.trim() });
        if (!res.success) { toast.error(res.message ?? 'Failed to create role.'); return; }
      }

      // 2. Diff capabilities (empty prev for a new role).
      const prev = new Set(existingRole ? (existingPermsQ.data ?? []) : []);
      const toRevoke = existingRole ? [...prev].filter(k => !selected.has(k)) : [];
      const toGrant  = [...selected].filter(k => !prev.has(k));
      const criticalGrants = toGrant.filter(k => CRITICAL_GRANT_KEYS.has(k));
      const normalGrants   = toGrant.filter(k => !CRITICAL_GRANT_KEYS.has(k));

      // 3. Apply revokes + non-critical grants immediately — check EVERY result.
      const immediate = await Promise.allSettled([
        ...normalGrants.map(k => setRolePermissionApi(roleName, k, true)),
        ...toRevoke.map(k => setRolePermissionApi(roleName, k, false)),
      ]);
      const immediateFailed = immediate.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

      // 4. Submit critical grants for maker-checker approval (with the step-3 reason).
      const critical = await Promise.allSettled(
        criticalGrants.map(k => setRolePermissionWithReasonApi(roleName, k, true, criticalReason.trim())),
      );
      const pendingCount   = critical.filter(r => r.status === 'fulfilled' && r.value.success && r.value.pending).length;
      const criticalFailed = critical.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

      // 5. Honest summary — applied / sent for approval / failed.
      const appliedCount = (normalGrants.length + toRevoke.length) - immediateFailed;
      const failed = immediateFailed + criticalFailed;
      const bits: string[] = [];
      if (appliedCount > 0) bits.push(`${appliedCount} applied`);
      if (pendingCount > 0) bits.push(`${pendingCount} sent for approval`);
      if (failed > 0)       bits.push(`${failed} failed`);
      const head = `Role "${label.trim()}" ${existingRole ? 'updated' : 'created'}`;
      const msg  = bits.length ? `${head} — ${bits.join(', ')}` : head;
      if (failed > 0) toast.error(msg); else toast.success(msg);

      onDone();
    } catch {
      toast.error('An error occurred. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div class="ac-scope">
      {/* Back breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', fontSize: '13px', color: 'var(--ac-muted)' }}>
        <button type="button" class="ac-btn sm ghost" onClick={onDone}>
          <i class="fas fa-chevron-left" style={{ fontSize: '11px' }} /> Back to Roles
        </button>
        <span style={{ color: 'var(--ac-faint)' }}>›</span>
        <span style={{ color: 'var(--ac-ink)', fontWeight: 600 }}>
          {existingRole ? `Edit Role — ${existingRole.label}` : 'Create Role'}
        </span>
      </div>

      <div class="ac-cr-page">
        {/* Left step rail */}
        <StepRail step={step} />

        {/* Center form */}
        <div class="ac-cr-form">
          {step === 1 && <StepDetails label={label} description={description} onLabel={setLabel} onDesc={setDesc} />}
          {step === 2 && <StepCapabilities selected={selected} onToggle={toggle} onToggleAll={toggleAll} />}
          {step === 3 && <StepHighRiskReview selected={selected} reason={criticalReason} onReason={setCriticalReason} />}
          {step === 4 && <StepReview label={label} description={description} selected={selected} />}
        </div>

        {/* Right summary */}
        <RoleSummary label={label} description={description} selected={selected} />
      </div>

      {/* Footer */}
      <div class="ac-cr-footer" style={{ marginTop: '14px', border: '1px solid var(--ac-line)', borderRadius: 'var(--ac-r)', background: '#fff', boxShadow: 'var(--ac-shadow)' }}>
        <button type="button" class="ac-btn" onClick={onDone} disabled={publishing}>Cancel</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {step > 1 && (
            <button type="button" class="ac-btn" onClick={() => setStep(s => s - 1)} disabled={publishing}>
              <i class="fas fa-chevron-left" style={{ fontSize: '11px' }} /> Back
            </button>
          )}
          {step < 4 ? (
            <button type="button" class="ac-btn primary" disabled={!canNext} onClick={() => setStep(s => s + 1)}>
              Next <i class="fas fa-chevron-right" style={{ fontSize: '11px' }} />
            </button>
          ) : (
            <button type="button" class="ac-btn primary" onClick={() => void publish()} disabled={publishing || !name}>
              {publishing
                ? <><i class="fas fa-spinner fa-spin" /> Publishing…</>
                : <><i class="fas fa-circle-check" /> {existingRole ? 'Save Changes' : 'Publish Role'}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
