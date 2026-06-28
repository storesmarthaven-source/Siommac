/**
 * src/components/sections/Settings/ModuleSettingsPanel.tsx
 *
 * Catalog-driven module settings — the admin/superadmin surface over the
 * Settings & Preferences engine (Spec §17–§20). Renders the live catalog for a
 * chosen module (grouped by setting class), edits org-wide values at `global`
 * scope through the governed /api/settings endpoints (validation, scope
 * allowance, critical-elevation and audit are all enforced server-side), and
 * surfaces inherited-vs-overridden source + a per-module change history.
 *
 * Personal/UI preferences (`personal_preference`, `ui_preference`) are NOT shown
 * here — those are per-user and need the owner-scoped preferences endpoint
 * (separate "My Preferences" page, tracked as a follow-up). Showing them in this
 * org-scope editor would be misleading.
 */

import { type VNode }                from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { toast }                     from '@store';
import { dialog }                    from '@lib/dialog';
import { useCan }                    from '@lib/permissions';
import {
  useEffectiveSettings,
  useSetSetting,
  useResetSetting,
  useSettingAudit,
  type EffectiveSetting,
  type SettingScopeType,
  type SettingSource,
  type SettingClass,
} from '@api/settingsCatalog';

// ── Module catalogue (mirrors netlify/functions/lib/settings/manifests) ─────────

interface SettingsModule { key: string; label: string; icon: string; group: ModuleGroup; }
type ModuleGroup = 'General' | 'People' | 'HSE' | 'Platform';

const MODULES: SettingsModule[] = [
  { key: 'system',               label: 'System',                   icon: 'fa-server',              group: 'General' },
  { key: 'company',              label: 'Company & Branding',       icon: 'fa-building',            group: 'General' },
  { key: 'attendance',           label: 'Attendance Rules',         icon: 'fa-clock',               group: 'General' },
  { key: 'employees',            label: 'Employee Master',          icon: 'fa-id-badge',            group: 'People' },
  { key: 'hr_onboarding',        label: 'HR Onboarding',            icon: 'fa-user-check',          group: 'People' },
  { key: 'training',             label: 'Training & Competency',    icon: 'fa-graduation-cap',      group: 'HSE' },
  { key: 'ptw',                  label: 'Permit to Work',           icon: 'fa-clipboard-check',     group: 'HSE' },
  { key: 'sds',                  label: 'SDS / Chemicals',          icon: 'fa-flask',               group: 'HSE' },
  { key: 'incidents',            label: 'Incidents · Investigations', icon: 'fa-triangle-exclamation', group: 'HSE' },
  { key: 'capa_jsa_inspections', label: 'CAPA · JSA · Inspections', icon: 'fa-list-check',          group: 'HSE' },
  { key: 'documents_ppe',        label: 'Documents · PPE',          icon: 'fa-folder-open',         group: 'HSE' },
  { key: 'notifications',        label: 'Notifications Delivery',   icon: 'fa-bell',                group: 'Platform' },
  { key: 'messages',             label: 'Messages Delivery',        icon: 'fa-comments',            group: 'Platform' },
  { key: 'files',                label: 'Files / Evidence',         icon: 'fa-file-shield',         group: 'Platform' },
  { key: 'workflow',             label: 'Workflow',                 icon: 'fa-diagram-project',     group: 'Platform' },
  { key: 'admin',                label: 'Admin',                    icon: 'fa-user-gear',           group: 'Platform' },
  { key: 'command_center',       label: 'Command Center',           icon: 'fa-gauge-high',          group: 'Platform' },
];

const MODULE_GROUPS: ModuleGroup[] = ['General', 'People', 'HSE', 'Platform'];

// Setting classes shown in this org-scope editor (preferences are excluded).
const CLASS_ORDER: SettingClass[] = [
  'module_policy', 'safety_rule', 'workflow_rule', 'notification_rule',
  'message_policy', 'file_policy', 'system_policy', 'system_security', 'audit_policy',
];
const CLASS_LABEL: Record<string, string> = {
  module_policy:     'Module Policy',
  safety_rule:       'Safety Rules',
  workflow_rule:     'Workflow Rules',
  notification_rule: 'Notification Rules',
  message_policy:    'Message Policy',
  file_policy:       'File Policy',
  system_policy:     'System Policy',
  system_security:   'Security',
  audit_policy:      'Audit Policy',
};

const SOURCE_LABEL: Record<SettingSource, string> = {
  user: 'You', role: 'Role', department: 'Dept', site: 'Site', module: 'Module', global: 'Org', default: 'Default',
};

// ── Value coercion helpers ──────────────────────────────────────────────────────

/** Stringify the current value for a text/number/time/select input. */
function toInputValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

// ── A single setting row ────────────────────────────────────────────────────────

function SettingRow({ s, onChanged }: { s: EffectiveSetting; onChanged: () => void }): VNode {
  const setMut   = useSetSetting();
  const resetMut = useResetSetting();
  const busy     = setMut.isPending || resetMut.isPending;

  // Where an org-level edit writes. Most policy settings allow 'global'; some are
  // module-scoped. Site/department/user-only settings can't be edited from this
  // org editor — they're shown read-only with a hint.
  const editScope: SettingScopeType | null =
    s.scope.includes('global') ? 'global' : s.scope.includes('module') ? 'module' : null;
  const editScopeId = editScope === 'module' ? s.moduleKey : null;

  const canEdit = s.editable && editScope !== null;
  const overridden = s.effectiveSource !== 'default';

  const [draft, setDraft] = useState<string>(() => toInputValue(s.effectiveValue));
  useEffect(() => { setDraft(toInputValue(s.effectiveValue)); }, [s.effectiveValue]);

  const askReason = useCallback(async (): Promise<string | null | undefined> => {
    if (!s.isAudited && !s.isCritical) return undefined; // no reason needed
    const r = await dialog.prompt({
      title: `Reason — ${s.label}`,
      text: s.isCritical ? 'This is a critical setting. A reason is recorded in the audit log.' : 'Recorded in the audit log.',
      placeholder: 'Why are you making this change?',
    });
    return r; // string, or null if cancelled
  }, [s.isAudited, s.isCritical, s.label]);

  const commit = useCallback(async (value: unknown) => {
    if (!canEdit || editScope === null) return;
    const reason = await askReason();
    if (reason === null) { setDraft(toInputValue(s.effectiveValue)); return; } // cancelled → revert
    try {
      const res = await setMut.mutateAsync({ settingKey: s.settingKey, scopeType: editScope, scopeId: editScopeId, value, reason: reason || undefined });
      if (!res.success) { toast.error(res.message ?? 'Change was blocked.'); setDraft(toInputValue(s.effectiveValue)); return; }
      toast.success(`${s.label} updated.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
      setDraft(toInputValue(s.effectiveValue));
    }
  }, [canEdit, editScope, editScopeId, s, setMut, askReason, onChanged]);

  const reset = useCallback(async () => {
    if (!canEdit || editScope === null) return;
    if (!(await dialog.confirm({ title: 'Reset to inherited?', text: `"${s.label}" will fall back to its inherited / default value.`, confirmText: 'Reset' }))) return;
    try {
      const res = await resetMut.mutateAsync({ settingKey: s.settingKey, scopeType: editScope, scopeId: editScopeId });
      if (!res.success) { toast.error(res.message ?? 'Reset was blocked.'); return; }
      toast.success(`${s.label} reset.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed.');
    }
  }, [canEdit, editScope, editScopeId, s, resetMut, onChanged]);

  // ── control by data type ──
  const control = (() => {
    if (!canEdit) {
      // read-only display
      if (s.dataType === 'boolean') {
        return <span class={`stg-set-ro-pill ${s.effectiveValue ? 'on' : 'off'}`}>{s.effectiveValue ? 'On' : 'Off'}</span>;
      }
      return <span class="stg-set-ro-val">{toInputValue(s.effectiveValue) || '—'}</span>;
    }
    switch (s.dataType) {
      case 'boolean':
        return (
          <label class="stg-toggle">
            <input type="checkbox" checked={!!s.effectiveValue} disabled={busy} onChange={e => void commit((e.target as HTMLInputElement).checked)} />
            <span class="stg-slider" />
          </label>
        );
      case 'select':
        return (
          <select class="stg-set-input" disabled={busy} value={draft} onChange={e => void commit((e.target as HTMLSelectElement).value)}>
            {!(s.allowedValues ?? []).some(v => String(v) === draft) && draft !== '' && <option value={draft}>{draft}</option>}
            {(s.allowedValues ?? []).map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
          </select>
        );
      case 'number':
      case 'duration':
        return (
          <input
            type="number" class="stg-set-input" value={draft} disabled={busy}
            min={s.minValue ?? undefined} max={s.maxValue ?? undefined}
            onInput={e => setDraft((e.target as HTMLInputElement).value)}
            onBlur={() => { if (draft !== toInputValue(s.effectiveValue)) void commit(draft === '' ? null : Number(draft)); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        );
      case 'time':
        return (
          <input type="time" class="stg-set-input" value={draft} disabled={busy}
            onChange={e => void commit((e.target as HTMLInputElement).value)} />
        );
      case 'json':
      case 'array':
      case 'multi_select':
        return (
          <textarea
            class="stg-set-input stg-set-textarea" rows={3} value={draft} disabled={busy}
            onInput={e => setDraft((e.target as HTMLTextAreaElement).value)}
            onBlur={() => {
              if (draft === toInputValue(s.effectiveValue)) return;
              try { void commit(draft.trim() === '' ? null : JSON.parse(draft)); }
              catch { toast.error('Enter valid JSON.'); setDraft(toInputValue(s.effectiveValue)); }
            }}
          />
        );
      default: // string
        return (
          <input
            type="text" class="stg-set-input" value={draft} disabled={busy}
            onInput={e => setDraft((e.target as HTMLInputElement).value)}
            onBlur={() => { if (draft !== toInputValue(s.effectiveValue)) void commit(draft); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        );
    }
  })();

  return (
    <div class="stg-set-row">
      <div class="stg-set-main">
        <div class="stg-set-label">
          {s.label}
          {s.isCritical  && <span class="stg-set-badge crit"  title="Critical setting — change requires elevation"><i class="fas fa-shield-halved" /> Critical</span>}
          {s.isSensitive && <span class="stg-set-badge sens"  title="Sensitive value"><i class="fas fa-eye-slash" /> Sensitive</span>}
          {s.isAudited   && <span class="stg-set-badge audit" title="Changes are written to the audit log"><i class="fas fa-clock-rotate-left" /> Audited</span>}
        </div>
        {s.description && <div class="stg-set-desc">{s.description}</div>}
        <div class="stg-set-meta">
          <span class={`stg-set-source ${overridden ? 'over' : 'def'}`}>{SOURCE_LABEL[s.effectiveSource]}</span>
          <span class="stg-set-key">{s.settingKey}</span>
          {!canEdit && s.editable && editScope === null && <span class="stg-set-note">Set per-site / department</span>}
          {!s.editable && <span class="stg-set-note">Read-only for your role</span>}
        </div>
      </div>
      <div class="stg-set-control">{control}</div>
      <div class="stg-set-actions">
        {canEdit && overridden && (
          <button type="button" class="stg-set-reset" disabled={busy} onClick={() => void reset()} title="Reset to inherited">
            <i class="fas fa-rotate-left" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Audit history ───────────────────────────────────────────────────────────────

function ModuleAudit({ moduleKey }: { moduleKey: string }): VNode {
  const { data, isLoading } = useSettingAudit({ moduleKey });
  const rows = data?.data ?? [];
  if (isLoading) return <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading history…</div>;
  if (rows.length === 0) return <div class="stg-set-empty">No changes recorded for this module yet.</div>;
  return (
    <div class="stg-set-audit">
      {rows.map(r => (
        <div key={r.id} class="stg-set-audit-row">
          <div class="stg-set-audit-key">{r.setting_key}</div>
          <div class="stg-set-audit-change">
            <span class="old">{toInputValue(r.previous_value) || '—'}</span>
            <i class="fas fa-arrow-right" />
            <span class="new">{toInputValue(r.new_value) || '—'}</span>
          </div>
          <div class="stg-set-audit-meta">
            {new Date(r.changed_at).toLocaleString()}{r.scope_type ? ` · ${r.scope_type}` : ''}{r.reason ? ` · ${r.reason}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────────

export function ModuleSettingsPanel(): VNode {
  const [moduleKey, setModuleKey] = useState<string>(MODULES[0]!.key);
  const [showAudit, setShowAudit] = useState(false);
  const canAudit = useCan('settings.audit_policy.view');

  const { data, isLoading, error, refetch } = useEffectiveSettings(moduleKey);
  const onChanged = useCallback(() => { void refetch(); }, [refetch]);

  const settings = data?.data?.settings ?? [];
  // Exclude per-user preference classes from the org editor.
  const policy = useMemo(
    () => settings.filter(s => s.settingClass !== 'personal_preference' && s.settingClass !== 'ui_preference'),
    [settings],
  );
  const byClass = useMemo(() => {
    const map = new Map<string, EffectiveSetting[]>();
    for (const s of policy) {
      const arr = map.get(s.settingClass) ?? [];
      arr.push(s); map.set(s.settingClass, arr);
    }
    return map;
  }, [policy]);
  const orderedClasses = useMemo(
    () => [...byClass.keys()].sort((a, b) => {
      const ai = CLASS_ORDER.indexOf(a as SettingClass), bi = CLASS_ORDER.indexOf(b as SettingClass);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    }),
    [byClass],
  );

  const active = MODULES.find(m => m.key === moduleKey) ?? MODULES[0]!;

  return (
    <div>
      {/* Module picker */}
      <div class="stg-card">
        <div class="stg-set-pickrow">
          <div class="stg-set-pick">
            <label>Module</label>
            <select class="stg-set-input" value={moduleKey} onChange={e => { setModuleKey((e.target as HTMLSelectElement).value); setShowAudit(false); }}>
              {MODULE_GROUPS.map(g => (
                <optgroup key={g} label={g}>
                  {MODULES.filter(m => m.group === g).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {canAudit && (
            <button type="button" class={showAudit ? 'stg-btn-save' : 'stg-btn-outline'} onClick={() => setShowAudit(v => !v)}>
              <i class="fas fa-clock-rotate-left" /> {showAudit ? 'Hide history' : 'Change history'}
            </button>
          )}
        </div>
        <p class="stg-set-hint">
          <i class={`fas ${active.icon}`} /> Org-wide defaults for <b>{active.label}</b>. Edits apply at the
          organisation scope and are governed + audited. Per-user preferences are managed under My Preferences.
        </p>
      </div>

      {showAudit && canAudit && (
        <div class="stg-card">
          <div class="stg-set-section-title"><i class="fas fa-clock-rotate-left" /> Change history</div>
          <ModuleAudit moduleKey={moduleKey} />
        </div>
      )}

      {/* Settings */}
      {isLoading && <div class="stg-card"><div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading settings…</div></div>}

      {!isLoading && error && (
        <div class="stg-card"><div class="stg-set-empty"><i class="fas fa-lock" /> You don't have access to this module's settings.</div></div>
      )}

      {!isLoading && !error && policy.length === 0 && (
        <div class="stg-card"><div class="stg-set-empty">No org-scope settings defined for this module.</div></div>
      )}

      {!isLoading && !error && orderedClasses.map(cls => (
        <div key={cls} class="stg-card">
          <div class="stg-set-section-title">{CLASS_LABEL[cls] ?? cls}</div>
          <div class="stg-set-list">
            {byClass.get(cls)!.map(s => <SettingRow key={s.settingKey} s={s} onChanged={onChanged} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
