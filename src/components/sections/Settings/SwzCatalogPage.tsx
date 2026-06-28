/**
 * src/components/sections/Settings/SwzCatalogPage.tsx
 *
 * A catalog-backed Settings page in the "Enterprise Clean v5" design: module
 * header + left tabs (real setting-classes, or modules for My Preferences) + a
 * grid of SwzCards bound to live catalog data, plus the audit drawer. Used for
 * the module-policy / platform-policy pages, My Preferences (user scope), and
 * Critical Governance (cross-module).
 */
import { type VNode } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { dialog } from '@lib/dialog';
import { useCan } from '@lib/permissions';
import { useSessionStore, selectUserId } from '@store/session';
import {
  useEffectiveSettings, useMyPreferences, useCriticalSettings, useSettingAudit,
  type EffectiveSetting, type SettingScopeType, type SettingClass,
} from '@api/settingsCatalog';
import type { SwzPage } from './settingsNav';
import { SwzCard } from './SwzCard';
import { SwzIcon, swzCardIconName } from './swzIcons';

const CLASS_ORDER: SettingClass[] = [
  'module_policy', 'safety_rule', 'workflow_rule', 'notification_rule',
  'message_policy', 'file_policy', 'system_policy', 'system_security', 'audit_policy',
  'personal_preference', 'ui_preference',
];
const CLASS_LABEL: Record<string, string> = {
  module_policy: 'Module Policy', safety_rule: 'Safety', workflow_rule: 'Workflow', notification_rule: 'Notifications',
  message_policy: 'Messages', file_policy: 'Files', system_policy: 'System', system_security: 'Security', audit_policy: 'Audit',
  personal_preference: 'Personal', ui_preference: 'Appearance',
};
const MODULE_LABEL: Record<string, string> = {
  system: 'System & Display', notifications: 'Notifications', messages: 'Messages', command_center: 'Command Center',
};
const prettyModule = (k: string) => MODULE_LABEL[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function SwzCatalogPage({ pageMeta }: { pageMeta: SwzPage }): VNode {
  const userId = useSessionStore(selectUserId);
  const canAudit = useCan('settings.audit_policy.view');

  const catalogQ  = useEffectiveSettings(pageMeta.kind === 'catalog' ? (pageMeta.moduleKey ?? null) : null);
  const myPrefsQ  = useMyPreferences(pageMeta.kind === 'myprefs');
  const criticalQ = useCriticalSettings(pageMeta.kind === 'critical');
  const active = pageMeta.kind === 'catalog' ? catalogQ : pageMeta.kind === 'myprefs' ? myPrefsQ : criticalQ;

  const refetch = active.refetch;
  const onChanged = useCallback(() => { void refetch(); }, [refetch]);

  const rawSettings: EffectiveSetting[] = pageMeta.kind === 'catalog'
    ? (catalogQ.data?.data?.settings ?? [])
    : ((active.data as { data?: EffectiveSetting[] } | undefined)?.data ?? []);

  // org-policy pages exclude personal/ui prefs (those live in My Preferences).
  const settings = useMemo(
    () => pageMeta.kind === 'catalog'
      ? rawSettings.filter(s => s.settingClass !== 'personal_preference' && s.settingClass !== 'ui_preference')
      : rawSettings,
    [rawSettings, pageMeta.kind],
  );

  // Tabs: by module for My Preferences, else by setting class.
  const tabKeyOf = (s: EffectiveSetting) => (pageMeta.kind === 'myprefs' ? s.moduleKey : s.settingClass);
  const tabLabelOf = (k: string) => (pageMeta.kind === 'myprefs' ? prettyModule(k) : (CLASS_LABEL[k] ?? k));

  const byTab = useMemo(() => {
    const m = new Map<string, EffectiveSetting[]>();
    for (const s of settings) { const k = tabKeyOf(s); const a = m.get(k) ?? []; a.push(s); m.set(k, a); }
    return m;
  }, [settings, pageMeta.kind]);

  const tabs = useMemo(() => {
    const keys = [...byTab.keys()];
    if (pageMeta.kind !== 'myprefs') {
      keys.sort((a, b) => {
        const ai = CLASS_ORDER.indexOf(a as SettingClass), bi = CLASS_ORDER.indexOf(b as SettingClass);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
    } else keys.sort();
    return keys;
  }, [byTab, pageMeta.kind]);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const curTab = activeTab && byTab.has(activeTab) ? activeTab : (tabs[0] ?? null);
  const curSettings = curTab ? (byTab.get(curTab) ?? []) : [];

  // Audit drawer
  const [auditFilter, setAuditFilter] = useState<{ settingKey?: string; moduleKey?: string } | null>(null);
  const auditQ = useSettingAudit(auditFilter ?? {}, !!auditFilter && canAudit);
  const auditRows = auditQ.data?.data ?? [];
  const openModuleAudit = () => { if (pageMeta.moduleKey) setAuditFilter({ moduleKey: pageMeta.moduleKey }); };
  const onViewAudit = useCallback((settingKey: string) => setAuditFilter({ settingKey }), []);

  // Per-setting scope + canEdit.
  const scopeFor = (s: EffectiveSetting): { scopeType: SettingScopeType; scopeId: string | null; canEdit: boolean } => {
    if (pageMeta.kind === 'myprefs') return { scopeType: 'user', scopeId: userId, canEdit: s.editable };
    const editScope: SettingScopeType | null = s.scope.includes('global') ? 'global' : s.scope.includes('module') ? 'module' : null;
    return { scopeType: editScope ?? 'global', scopeId: editScope === 'module' ? s.moduleKey : null, canEdit: s.editable && editScope !== null };
  };

  const scopeLabel = pageMeta.kind === 'myprefs' ? 'Scope: You' : 'Scope: Global';
  const onScope = () => void dialog.alert({
    title: scopeLabel.replace('Scope: ', 'Scope — '),
    text: pageMeta.kind === 'myprefs'
      ? 'These are your personal preferences (user scope).'
      : 'Edits apply at the organisation (global) scope. Site/department/role overrides are managed per record.',
    icon: 'info',
  });

  return (
    <div class="settings-content"><div class="content-shell">
      <div class="breadcrumb"><span>Settings</span><span class="sep">›</span><span>{pageMeta.group}</span><span class="sep">›</span><span>{pageMeta.label}</span></div>

      <section class="top-panel">
        <div class="module-icon"><SwzIcon name={pageMeta.iconKey} /></div>
        <div>
          <h1>{pageMeta.title}</h1>
          <p>{pageMeta.desc}</p>
        </div>
        <div class="top-actions">
          <button class="action-btn" onClick={onScope}><SwzIcon name="GLOBE" />{scopeLabel}</button>
          {canAudit && pageMeta.moduleKey && <button class="action-btn" onClick={openModuleAudit}><SwzIcon name="SHIELD" />View audit</button>}
          <button class="action-btn save" onClick={() => toast.info('Changes are saved automatically as you edit each setting.')}><SwzIcon name="SAVE" />Save</button>
        </div>
      </section>

      <section class="workspace">
        <aside class="section-tabs">
          {tabs.length === 0 && <div style={{ padding: '8px', fontSize: '12px', color: '#9aa6b6' }}>No settings</div>}
          {tabs.map((k, i) => (
            <button key={k} type="button" class={`tab-btn${k === curTab ? ' active' : ''}`} onClick={() => setActiveTab(k)}>
              <SwzIcon name={swzCardIconName(i)} /><span>{tabLabelOf(k)}</span><span class="tab-count">{byTab.get(k)!.length}</span>
            </button>
          ))}
        </aside>

        <section class="settings-pane">
          <div class="subpage-summary">
            <h2>{curTab ? tabLabelOf(curTab) : pageMeta.title} settings</h2>
            <p>{pageMeta.title} · {curTab ? tabLabelOf(curTab) : 'All'}: {curSettings.length} configurable {curSettings.length === 1 ? 'setting' : 'settings'} for the selected scope.</p>
          </div>

          {active.isLoading && <div class="swz-loading"><i class="fas fa-spinner fa-spin" /> Loading settings…</div>}
          {!active.isLoading && active.error && <div class="swz-empty"><i class="fas fa-lock" /> You don't have access to these settings.</div>}
          {!active.isLoading && !active.error && settings.length === 0 && <div class="swz-empty">No settings defined for this area.</div>}

          {!active.isLoading && !active.error && curSettings.length > 0 && (
            <section class="setting-grid">
              {curSettings.map((s, i) => {
                const sc = scopeFor(s);
                return <SwzCard key={s.settingKey} s={s} index={i} scopeType={sc.scopeType} scopeId={sc.scopeId} canEdit={sc.canEdit} canAudit={canAudit} onChanged={onChanged} onViewAudit={onViewAudit} />;
              })}
            </section>
          )}
        </section>
      </section>

      {auditFilter && (
        <>
          <div class="swz-backdrop" onClick={() => setAuditFilter(null)} />
          <aside class="swz-drawer">
            <div class="drawer-head"><h2>Settings Audit</h2><button type="button" class="xbtn" onClick={() => setAuditFilter(null)}>×</button></div>
            <div class="drawer-body">
              {auditQ.isLoading && <div class="swz-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>}
              {!auditQ.isLoading && auditRows.length === 0 && <div class="swz-empty">No changes recorded yet.</div>}
              {auditRows.map(r => (
                <div key={r.id} class="audit-item">
                  <b>{r.setting_key}</b>
                  <div class="audit-change">
                    <span class="old">{r.previous_value === null || r.previous_value === undefined ? '—' : String(r.previous_value)}</span>
                    <span>→</span>
                    <span class="new">{r.new_value === null || r.new_value === undefined ? '—' : String(r.new_value)}</span>
                  </div>
                  <div class="audit-meta">{new Date(r.changed_at).toLocaleString()}{r.scope_type ? ` · ${r.scope_type}` : ''}{r.reason ? ` · ${r.reason}` : ''}</div>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div></div>
  );
}
