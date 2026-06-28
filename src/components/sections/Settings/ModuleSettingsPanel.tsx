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
 * here — those are per-user and live on the My Preferences page. Showing them in
 * this org-scope editor would be misleading.
 */

import { type VNode }                from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { useCan }                    from '@lib/permissions';
import {
  useEffectiveSettings, useSettingAudit,
  type EffectiveSetting, type SettingScopeType, type SettingClass,
} from '@api/settingsCatalog';
import { SettingField, toInputValue } from './SettingField';

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

// ── A setting, scoped to org-level editing ──────────────────────────────────────

function OrgSettingField({ s, onChanged }: { s: EffectiveSetting; onChanged: () => void }): VNode {
  // Org edits write at 'global'; some settings are module-scoped. Site/department/
  // user-only settings can't be edited from this org editor (shown read-only).
  const editScope: SettingScopeType | null =
    s.scope.includes('global') ? 'global' : s.scope.includes('module') ? 'module' : null;
  const editScopeId = editScope === 'module' ? s.moduleKey : null;
  const canEdit = s.editable && editScope !== null;
  const note = !s.editable ? 'Read-only for your role' : (editScope === null ? 'Set per-site / department' : undefined);

  return (
    <SettingField s={s} scopeType={editScope ?? 'global'} scopeId={editScopeId} canEdit={canEdit} onChanged={onChanged} note={note} />
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
            {byClass.get(cls)!.map(s => <OrgSettingField key={s.settingKey} s={s} onChanged={onChanged} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
