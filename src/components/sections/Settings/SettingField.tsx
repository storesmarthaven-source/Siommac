/**
 * src/components/sections/Settings/SettingField.tsx
 *
 * One catalog setting rendered as a labelled, governed control — shared by the
 * org-scope Module Settings editor and the user-scope My Preferences page. The
 * caller decides the target scope (global/module vs user) and whether it's
 * editable; this component renders the right control for the data type, prompts
 * for an audit reason on audited/critical edits, surfaces server governance
 * errors, and offers reset-to-inherited.
 */

import { type VNode }                from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { toast }                     from '@store';
import { dialog }                    from '@lib/dialog';
import {
  useSetSetting, useResetSetting,
  type EffectiveSetting, type SettingScopeType, type SettingSource,
} from '@api/settingsCatalog';

const SOURCE_LABEL: Record<SettingSource, string> = {
  user: 'You', role: 'Role', department: 'Dept', site: 'Site', module: 'Module', global: 'Org', default: 'Default',
};

/** Stringify the current value for a text/number/time/select/JSON input. */
export function toInputValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

export interface SettingFieldProps {
  s:         EffectiveSetting;
  scopeType: SettingScopeType;
  scopeId:   string | null;
  canEdit:   boolean;
  onChanged: () => void;
  /** Optional muted note shown when not editable (e.g. "Read-only for your role"). */
  note?:     string;
}

export function SettingField({ s, scopeType, scopeId, canEdit, onChanged, note }: SettingFieldProps): VNode {
  const setMut   = useSetSetting();
  const resetMut = useResetSetting();
  const busy     = setMut.isPending || resetMut.isPending;
  const overridden = s.effectiveSource !== 'default';

  const [draft, setDraft] = useState<string>(() => toInputValue(s.effectiveValue));
  useEffect(() => { setDraft(toInputValue(s.effectiveValue)); }, [s.effectiveValue]);

  const askReason = useCallback(async (): Promise<string | null | undefined> => {
    if (!s.isAudited && !s.isCritical) return undefined;
    return dialog.prompt({
      title: `Reason — ${s.label}`,
      text: s.isCritical ? 'This is a critical setting. A reason is recorded in the audit log.' : 'Recorded in the audit log.',
      placeholder: 'Why are you making this change?',
    });
  }, [s.isAudited, s.isCritical, s.label]);

  const commit = useCallback(async (value: unknown) => {
    if (!canEdit) return;
    const reason = await askReason();
    if (reason === null) { setDraft(toInputValue(s.effectiveValue)); return; } // cancelled → revert
    try {
      const res = await setMut.mutateAsync({ settingKey: s.settingKey, scopeType, scopeId, value, reason: reason || undefined });
      if (!res.success) { toast.error(res.message ?? 'Change was blocked.'); setDraft(toInputValue(s.effectiveValue)); return; }
      toast.success(`${s.label} updated.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
      setDraft(toInputValue(s.effectiveValue));
    }
  }, [canEdit, scopeType, scopeId, s, setMut, askReason, onChanged]);

  const reset = useCallback(async () => {
    if (!canEdit) return;
    if (!(await dialog.confirm({ title: 'Reset to inherited?', text: `"${s.label}" will fall back to its inherited / default value.`, confirmText: 'Reset' }))) return;
    try {
      const res = await resetMut.mutateAsync({ settingKey: s.settingKey, scopeType, scopeId });
      if (!res.success) { toast.error(res.message ?? 'Reset was blocked.'); return; }
      toast.success(`${s.label} reset.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed.');
    }
  }, [canEdit, scopeType, scopeId, s, resetMut, onChanged]);

  const control = (() => {
    if (!canEdit) {
      if (s.dataType === 'boolean') return <span class={`stg-set-ro-pill ${s.effectiveValue ? 'on' : 'off'}`}>{s.effectiveValue ? 'On' : 'Off'}</span>;
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
        return <input type="time" class="stg-set-input" value={draft} disabled={busy} onChange={e => void commit((e.target as HTMLInputElement).value)} />;
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
          {!canEdit && note && <span class="stg-set-note">{note}</span>}
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
