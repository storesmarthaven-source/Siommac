/**
 * src/components/sections/Settings/SwzCard.tsx
 *
 * One setting rendered in the "Enterprise Clean v5" card design, bound to a real
 * catalog EffectiveSetting. Control type follows the setting's data type; writes
 * go through the governed values/set (reason prompt on audited/critical, server
 * errors surfaced); Reset → values/reset; View audit → drawer (lifted to page).
 */
import { type VNode } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { dialog } from '@lib/dialog';
import { useSetSetting, useResetSetting, type EffectiveSetting, type SettingScopeType } from '@api/settingsCatalog';
import { SwzIcon, swzCardIconName } from './swzIcons';

function valStr(s: EffectiveSetting): string {
  if (s.dataType === 'boolean') return s.effectiveValue ? 'on' : 'off';
  if (s.effectiveValue === null || s.effectiveValue === undefined) return '—';
  if (typeof s.effectiveValue === 'object') return JSON.stringify(s.effectiveValue);
  return String(s.effectiveValue);
}
function toInput(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}
function classPill(cls: string): string {
  if (cls.includes('safety')) return 'class-safety';
  if (cls.includes('security')) return 'class-security';
  if (cls.includes('workflow')) return 'class-workflow';
  if (cls.includes('notification')) return 'class-notification';
  if (cls.includes('audit')) return 'class-audit';
  return 'class-policy';
}

export interface SwzCardProps {
  s: EffectiveSetting;
  index: number;
  scopeType: SettingScopeType;
  scopeId: string | null;
  canEdit: boolean;
  canAudit?: boolean;
  onChanged: () => void;
  onViewAudit: (settingKey: string) => void;
}

export function SwzCard({ s, index, scopeType, scopeId, canEdit, canAudit = true, onChanged, onViewAudit }: SwzCardProps): VNode {
  const setMut = useSetSetting();
  const resetMut = useResetSetting();
  const busy = setMut.isPending || resetMut.isPending;
  const overridden = s.effectiveSource !== 'default';

  const [draft, setDraft] = useState<string>(() => toInput(s.effectiveValue));
  useEffect(() => { setDraft(toInput(s.effectiveValue)); }, [s.effectiveValue]);

  const commit = useCallback(async (value: unknown) => {
    if (!canEdit) return;
    let reason: string | undefined;
    if (s.isAudited || s.isCritical) {
      const r = await dialog.prompt({
        title: `Reason — ${s.label}`,
        text: s.isCritical ? 'Critical setting. A reason is recorded in the audit log.' : 'Recorded in the audit log.',
        placeholder: 'Why are you making this change?',
      });
      if (r === null) { setDraft(toInput(s.effectiveValue)); return; }
      reason = r.trim() || undefined;
    }
    try {
      const res = await setMut.mutateAsync({ settingKey: s.settingKey, scopeType, scopeId, value, reason });
      if (!res.success) { toast.error(res.message ?? 'Change was blocked.'); setDraft(toInput(s.effectiveValue)); return; }
      toast.success(`${s.label} updated.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
      setDraft(toInput(s.effectiveValue));
    }
  }, [canEdit, scopeType, scopeId, s, setMut, onChanged]);

  const reset = useCallback(async () => {
    if (!canEdit || !overridden) return;
    if (!(await dialog.confirm({ title: 'Reset to inherited value', text: `"${s.label}" will fall back to the next inherited / default value.`, confirmText: 'Reset' }))) return;
    try {
      const res = await resetMut.mutateAsync({ settingKey: s.settingKey, scopeType, scopeId });
      if (!res.success) { toast.error(res.message ?? 'Reset was blocked.'); return; }
      toast.success(`${s.label} reset.`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed.');
    }
  }, [canEdit, overridden, scopeType, scopeId, s, resetMut, onChanged]);

  const control = (() => {
    if (s.dataType === 'boolean') {
      const on = !!s.effectiveValue;
      return (
        <button type="button" class={`switch${on ? '' : ' off'}`} disabled={!canEdit || busy}
          aria-pressed={on} onClick={() => void commit(!on)}><span /></button>
      );
    }
    if (s.dataType === 'select') {
      return (
        <select class="input-number" disabled={!canEdit || busy} value={draft} onChange={e => void commit((e.target as HTMLSelectElement).value)}>
          {!(s.allowedValues ?? []).some(v => String(v) === draft) && draft !== '' && <option value={draft}>{draft}</option>}
          {(s.allowedValues ?? []).map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
        </select>
      );
    }
    if (s.dataType === 'number' || s.dataType === 'duration') {
      return (
        <input type="number" class="input-number" value={draft} disabled={!canEdit || busy}
          min={s.minValue ?? undefined} max={s.maxValue ?? undefined}
          onInput={e => setDraft((e.target as HTMLInputElement).value)}
          onBlur={() => { if (draft !== toInput(s.effectiveValue)) void commit(draft === '' ? null : Number(draft)); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      );
    }
    if (s.dataType === 'time') {
      return <input type="time" class="input-number" value={draft} disabled={!canEdit || busy} onChange={e => void commit((e.target as HTMLInputElement).value)} />;
    }
    if (s.dataType === 'json' || s.dataType === 'array' || s.dataType === 'multi_select') {
      return (
        <textarea class="input-number" rows={3} value={draft} disabled={!canEdit || busy}
          onInput={e => setDraft((e.target as HTMLTextAreaElement).value)}
          onBlur={() => {
            if (draft === toInput(s.effectiveValue)) return;
            try { void commit(draft.trim() === '' ? null : JSON.parse(draft)); }
            catch { toast.error('Enter valid JSON.'); setDraft(toInput(s.effectiveValue)); }
          }} />
      );
    }
    return (
      <input type="text" class="input-number" value={draft} disabled={!canEdit || busy}
        onInput={e => setDraft((e.target as HTMLInputElement).value)}
        onBlur={() => { if (draft !== toInput(s.effectiveValue)) void commit(draft); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    );
  })();

  return (
    <article class="setting-card wz-section">
      <div class="card-main">
        <div class="card-icon"><SwzIcon name={swzCardIconName(index)} /></div>
        {s.isCritical && <span class="critical-lock"><SwzIcon name="LOCK" />Critical</span>}
        <div class="card-copy">
          <h3>{s.label}</h3>
          <p>{s.description || 'Configure this setting for the current scope.'}</p>
        </div>
        <div class="setting-side">
          <div class="setting-control-row">{control}</div>
          <div class="badge-row">
            <span class={`pill source-${s.effectiveSource}`}>source: {s.effectiveSource}</span>
            <span class={`pill ${classPill(s.settingClass)}`}>class: {s.settingClass}</span>
          </div>
          <span class="setting-subtext">Effective value: {valStr(s)}{canEdit ? '' : ' · read-only for your role'}</span>
        </div>
      </div>
      <footer class="card-footer">
        <button type="button" class="footer-link" disabled={!canEdit || !overridden || busy} onClick={() => void reset()}>
          <SwzIcon name="FLOW" />Reset inherited
        </button>
        {canAudit && (
          <button type="button" class="footer-link" onClick={() => onViewAudit(s.settingKey)}>
            <SwzIcon name="FILE" />View audit
          </button>
        )}
      </footer>
    </article>
  );
}
