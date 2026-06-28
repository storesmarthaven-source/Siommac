/**
 * src/components/sections/Settings/MyPreferencesPanel.tsx
 *
 * The current user's own personal + UI preferences, resolved at their user scope
 * via /api/settings/my-preferences and edited (user scope) through the same
 * governed values/set endpoint. Available to every role — these are self-data,
 * so they don't require the module-policy view permissions the admin Module
 * Settings surface needs. Grouped by module for readability.
 */

import { type VNode }            from 'preact';
import { useCallback, useMemo }  from 'preact/hooks';
import { useSessionStore, selectUserId } from '@store/session';
import { useMyPreferences, type EffectiveSetting } from '@api/settingsCatalog';
import { SettingField }          from './SettingField';

const MODULE_LABEL: Record<string, string> = {
  system: 'System & Display', notifications: 'Notifications', messages: 'Messages',
  command_center: 'Command Center', company: 'Company', attendance: 'Attendance',
};
const prettyModule = (k: string) => MODULE_LABEL[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function MyPreferencesPanel(): VNode {
  const userId = useSessionStore(selectUserId);
  const { data, isLoading, error, refetch } = useMyPreferences(!!userId);
  const onChanged = useCallback(() => { void refetch(); }, [refetch]);
  const prefs = data?.data ?? [];

  const byModule = useMemo(() => {
    const map = new Map<string, EffectiveSetting[]>();
    for (const s of prefs) { const a = map.get(s.moduleKey) ?? []; a.push(s); map.set(s.moduleKey, a); }
    return map;
  }, [prefs]);
  const modules = useMemo(() => [...byModule.keys()].sort(), [byModule]);

  return (
    <div>
      <div class="stg-card">
        <p class="stg-set-hint">
          <i class="fas fa-user-gear" /> These preferences apply to <b>your account only</b> and override the
          organisation defaults where allowed. Changes take effect immediately.
        </p>
      </div>

      {isLoading && <div class="stg-card"><div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading your preferences…</div></div>}

      {!isLoading && error && (
        <div class="stg-card"><div class="stg-set-empty"><i class="fas fa-circle-exclamation" /> Couldn't load your preferences. Please try again.</div></div>
      )}

      {!isLoading && !error && prefs.length === 0 && (
        <div class="stg-card"><div class="stg-set-empty">No personal preferences are available yet.</div></div>
      )}

      {!isLoading && !error && modules.map(m => (
        <div key={m} class="stg-card">
          <div class="stg-set-section-title">{prettyModule(m)}</div>
          <div class="stg-set-list">
            {byModule.get(m)!.map(s => (
              <SettingField
                key={s.settingKey} s={s}
                scopeType="user" scopeId={userId} canEdit={s.editable}
                onChanged={onChanged}
                note={!s.editable ? 'Locked by your organisation' : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
