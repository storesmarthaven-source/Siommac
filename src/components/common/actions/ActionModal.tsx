/**
 * src/components/common/actions/ActionModal.tsx
 *
 * Presentational lifecycle-action modal: header (icon+title+subtitle), the affected
 * record (title, badges, field list), an optional warning, an optional reason input,
 * "what happens next", and Cancel / confirm. Preact — `class`, Escape + backdrop close.
 * Usually driven imperatively via openActionModal() (see ActionModalProvider).
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActionModalConfig, ActionTone } from './actionModalTypes';
import { canConfirm } from './actionModalValidation';
import './actionModalStyles.css';

function toneClass(tone?: ActionTone): string {
  return `am-tone-${tone ?? 'default'}`;
}
function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is pre-screened: null/undefined/''/boolean handled above; remaining type is string|number in practice
  return String(value);
}

interface Props {
  open: boolean;
  config: ActionModalConfig;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ActionModal({ open, config, busy, onCancel, onConfirm }: Props): VNode | null {
  const [reason, setReason] = useState('');

  // Reset the reason whenever a new action opens.
  useEffect(() => { if (open) setReason(''); }, [open, config]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const tone = config.tone ?? 'default';
  const record = config.record;
  const confirmEnabled = canConfirm(config, reason) && !busy;

  return (
    <div class="am-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div class={`am-modal ${toneClass(tone)}`} role="alertdialog" aria-modal="true" aria-label={config.title}>
        <header class="am-header">
          <span class={`am-icon ${toneClass(tone)}`}>{config.icon ? <i class={`fas ${config.icon}`} /> : '!'}</span>
          <div class="am-titles">
            <h3>{config.title}</h3>
            {config.subtitle && <p>{config.subtitle}</p>}
          </div>
        </header>

        <div class="am-body">
          {record && (
            <div class="am-record">
              <div class="am-record-head">
                {record.icon && <span class="am-record-icon"><i class={`fas ${record.icon}`} /></span>}
                <div class="am-record-titles">
                  <strong>{record.title}</strong>
                  {record.subtitle && <span>{record.subtitle}</span>}
                </div>
                {record.badges?.length ? (
                  <div class="am-record-badges">
                    {record.badges.map((b) => <span key={b.label} class={`am-badge ${toneClass(b.tone)}`}>{b.label}</span>)}
                  </div>
                ) : null}
              </div>
              {record.fields?.length ? (
                <div class="am-record-fields">
                  {record.fields.map((f) => (
                    <div class="am-record-row" key={f.label}>
                      <span>{f.label}</span>
                      <strong class={toneClass(f.tone)}>{fmt(f.value)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {config.warning && (
            <div class={`am-warning ${toneClass(tone === 'default' ? 'warning' : tone)}`}>
              <i class="fas fa-triangle-exclamation" aria-hidden="true" /> <span>{config.warning}</span>
            </div>
          )}

          {config.reason && (
            <label class="am-reason">
              <span>{config.reason.label ?? 'Reason'}{config.reason.required ? ' *' : ' (optional)'}</span>
              {config.reason.type === 'text'
                ? <input type="text" value={reason} placeholder={config.reason.placeholder} onInput={(e) => setReason((e.currentTarget).value)} />
                : <textarea rows={3} value={reason} placeholder={config.reason.placeholder} onInput={(e) => setReason((e.currentTarget).value)} />}
            </label>
          )}

          {config.whatNext?.length ? (
            <div class="am-next">
              <div class="am-next-title">What happens next</div>
              <ul>{config.whatNext.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          ) : null}
        </div>

        <footer class="am-footer">
          <button type="button" class="am-btn am-btn-ghost" onClick={onCancel} disabled={busy}>{config.cancelLabel ?? 'Cancel'}</button>
          <button type="button" class={`am-btn am-btn-primary ${toneClass(tone)}`} onClick={() => onConfirm(reason.trim())} disabled={!confirmEnabled}>
            {busy ? 'Working…' : (config.confirmLabel ?? 'Confirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}
