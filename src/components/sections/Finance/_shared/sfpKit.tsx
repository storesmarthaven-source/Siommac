/**
 * src/components/sections/Finance/_shared/sfpKit.tsx
 *
 * Shared primitives for the Statutory full-page design system (.sfp) — icons,
 * form fields (text / money / select), toggle switch, and the version status
 * pill. Reused across every Statutory full page (Edit NIS Band, Pay Component,
 * Import wizard, New Rate Version) so the look + behaviour stay DRY.
 *
 * Styling lives in ../statutoryForms.css (`.sfp*`). Import that CSS from the page.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { PageHeader } from '@ui';
import { AppTopBar } from '@shared/AppTopBar';

// ── Icons (ported from the 2026-07 mockups) ─────────────────────────────────────
type IconProps = { size?: number };
const svg = (size: number, inner: ComponentChildren, sw = 1.7): VNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round">{inner}</svg>
);

export const IconFile  = ({ size = 24 }: IconProps): VNode => svg(size, <><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M12 11v6M9 14h6"/></>, 1.6);
export const IconDoc   = ({ size = 24 }: IconProps): VNode => svg(size, <><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/></>);
export const IconLayers= ({ size = 24 }: IconProps): VNode => svg(size, <><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 9h1M9 13h6M9 17h6"/></>);
export const IconClose = ({ size = 20 }: IconProps): VNode => svg(size, <path d="M18 6 6 18M6 6l12 12"/>, 2);
export const IconOk    = ({ size = 16 }: IconProps): VNode => svg(size, <path d="M20 6 9 17l-5-5"/>, 2.2);
// Filled white circle with a navy check — for the primary (navy) button.
export const IconOkBadge = ({ size = 17 }: IconProps): VNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="11" fill="#fff" />
    <path d="M16.5 9 10.75 15 7.5 12" fill="none" stroke="var(--siomac-navy, #1b2d54)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
export const IconBad   = ({ size = 16 }: IconProps): VNode => svg(size, <><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></>, 2);
export const IconInfo  = ({ size = 15 }: IconProps): VNode => svg(size, <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></>, 1.8);
export const IconArrow = ({ size = 14 }: IconProps): VNode => svg(size, <path d="M5 12h14M13 6l6 6-6 6"/>, 2);
export const IconChevronLeft = ({ size = 16 }: IconProps): VNode => svg(size, <path d="m15 18-6-6 6-6"/>, 2.1);
// Navy filled circle with a white chevron — the back-button icon badge.
export const IconChevronLeftBadge = ({ size = 22 }: IconProps): VNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="11" fill="var(--siomac-navy, #1b2d54)" />
    <path d="m13.5 8-4 4 4 4" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
export const IconCoins = ({ size = 16 }: IconProps): VNode => svg(size, <><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/></>);
export const IconBook  = ({ size = 16 }: IconProps): VNode => svg(size, <><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/></>);
export const IconClock = ({ size = 16 }: IconProps): VNode => svg(size, <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>);
export const IconShield= ({ size = 16 }: IconProps): VNode => svg(size, <path d="M12 3 4 6v6c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V6l-8-3Z"/>);
export const IconEye   = ({ size = 16 }: IconProps): VNode => svg(size, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>);
export const IconUpload= ({ size = 22 }: IconProps): VNode => svg(size, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5-5 5 5M12 5v12"/></>);
export const IconAlert = ({ size = 16 }: IconProps): VNode => svg(size, <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></>);
export const IconTrash = ({ size = 16 }: IconProps): VNode => svg(size, <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>, 1.8);
export const IconGavel = ({ size = 16 }: IconProps): VNode => svg(size, <><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/></>);
export const IconSpark = ({ size = 16 }: IconProps): VNode => svg(size, <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>);

// ── Version status pill ─────────────────────────────────────────────────────────
export type VersionStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'retired';
export function pillClass(status: string): string {
  switch (status) {
    case 'active':           return 'active';
    case 'pending_approval': return 'pending';
    case 'approved':         return 'approved';
    case 'retired':          return 'retired';
    default:                 return 'draft';
  }
}
export function StatusPill({ status, label }: { status: string; label: string }): VNode {
  return (
    <span class={`sfp-pill ${pillClass(status)}`}>
      {status === 'active' && <span class="sfp-dot" />}
      {label}
    </span>
  );
}

// ── Standard page shell for the Statutory full pages ────────────────────────────
// Renders like every other Siomac sub-module page: a back link + the standard
// PageHeader (which carries the ProfilePill / "employee-master top bar") + the form
// content in a normal content-area panel. NOT a floating card on a grey letterbox.
export function StatFormShell({ icon, title, sub, statusLabel, backLabel = 'Statutory Configuration', onBack, actions, stepper, children }: {
  icon: ComponentChildren;    // an icon node (Lucide SVG) for the header chip
  title: string;
  sub?: string;
  statusLabel?: string | null; // version/record status → header meta chip
  backLabel?: string;
  onBack: () => void;
  actions?: ComponentChildren;
  stepper?: ComponentChildren; // a <Stepper/> rendered as a separate box above the card
  children: ComponentChildren;
}): VNode {
  return (
    <div class="sfp">
      {/* New employee-master top bar (search + AI + profile cluster). The standalone
          ProfilePill is retired — the page header below hides it (hidePill). */}
      <AppTopBar />
      {/* Header + back button. The back button is absolutely positioned top-right of the
          header (out of flow) so it sits up by the header without shifting the stepper. */}
      <div class="sfp-headwrap">
        <PageHeader
          icon={icon}
          module="Finance · Statutory Configuration"
          title={title}
          sub={sub}
          meta={statusLabel ? [{ icon: 'fa-circle-dot', label: statusLabel }] : []}
          hidePill
          actions={actions}
        />
        <button type="button" class="sfp-back" onClick={onBack}>
          <IconChevronLeftBadge /> Back to {backLabel}
        </button>
      </div>
      {/* Wizard stepper (optional) — a separate box above the form card. */}
      {stepper}
      <div class="sfp-card">{children}</div>
    </div>
  );
}

/** Reusable minimum-character validator. Returns an error message if the (non-empty)
 *  value is shorter than `min`, else undefined. Empty is left to a `required` check. */
export function minLenError(value: string, min: number): string | undefined {
  const v = value.trim();
  return v !== '' && v.length < min ? `Must be at least ${min} character${min === 1 ? '' : 's'}.` : undefined;
}

/** Field info (i) icon that shows `hint` as a tooltip on hover/focus. Renders
 *  nothing when there's no hint, so the form never shows a dead, tooltip-less icon. */
const InfoHint = ({ hint }: { hint?: string }): VNode | null =>
  hint ? <span class="sfp-info" data-tip={hint} tabIndex={0} role="img" aria-label={hint}><IconInfo /></span> : null;

// ── Text field (plain input + inline validation) ────────────────────────────────
export function TextField({ label, hint, value, onInput, error, show, required, disabled, placeholder, mono, wide, minLength }: {
  label: string; hint?: string; value: string; onInput: (v: string) => void;
  error?: string; show: boolean; required?: boolean; disabled?: boolean; placeholder?: string; mono?: boolean; wide?: boolean;
  /** Minimum character count — enforced inline (UI-kit standard) when set. */
  minLength?: number;
}): VNode {
  const hasVal = value.trim() !== '';
  const effError = error ?? (minLength ? minLenError(value, minLength) : undefined);
  const bad = !!effError && (hasVal || show);
  const ok = !effError && hasVal;
  return (
    <div class={`sfp-field${wide ? ' wide' : ''}`}>
      <label class="sfp-lab">{label}{required && <span class="sfp-req">*</span>} <InfoHint hint={hint} /></label>
      <div class="sfp-ctl">
        <input class={`sfp-inp${bad ? ' is-bad' : ok ? ' is-ok' : ''}`} value={value} disabled={disabled} placeholder={placeholder}
          style={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : undefined}
          onInput={e => onInput((e.currentTarget as HTMLInputElement).value)} />
        {bad ? <span key="bad" class="sfp-state bad"><IconBad /></span> : ok ? <span key="ok" class="sfp-state ok"><IconOk /></span> : null}
      </div>
      {bad ? <span class="sfp-err-msg">{effError}</span> : hint ? <span class="sfp-hint">{hint}</span> : null}
    </div>
  );
}

// ── Money field (TTD currency-prefix group) ─────────────────────────────────────
export function MoneyField({ label, hint, value, onInput, error, show, required, disabled, placeholder, currency = 'TTD' }: {
  label: string; hint?: string; value: string; onInput: (v: string) => void;
  error?: string; show: boolean; required?: boolean; disabled?: boolean; placeholder?: string; currency?: string;
}): VNode {
  const hasVal = value.trim() !== '';
  const bad = !!error && (hasVal || show);
  const ok = !error && hasVal;
  return (
    <div class="sfp-field">
      <label class="sfp-lab">{label}{required && <span class="sfp-req">*</span>} <InfoHint hint={hint} /></label>
      <div class={`sfp-cur-grp${ok ? ' is-ok' : ''}${bad ? ' is-bad' : ''}`}>
        <span class="sfp-cur">{currency}</span>
        <input type="number" step="0.01" inputMode="decimal" value={value} disabled={disabled} placeholder={placeholder}
          onInput={e => onInput((e.currentTarget as HTMLInputElement).value)} />
        {ok && <span class="sfp-state ok"><IconOk /></span>}
        {bad && <span class="sfp-state bad"><IconBad /></span>}
      </div>
      {bad ? <span class="sfp-err-msg">{error}</span> : hint ? <span class="sfp-hint">{hint}</span> : null}
    </div>
  );
}

// ── Select field (native, styled) ───────────────────────────────────────────────
export function SelectField({ label, hint, value, onChange, options, error, show, required, disabled }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  error?: string; show: boolean; required?: boolean; disabled?: boolean;
}): VNode {
  const hasVal = value.trim() !== '';
  const bad = !!error && (hasVal || show);
  const ok = !error && hasVal && !disabled;
  return (
    <div class="sfp-field">
      <label class="sfp-lab">{label}{required && <span class="sfp-req">*</span>} <InfoHint hint={hint} /></label>
      <div class="sfp-ctl">
        <select class={`sfp-select${bad ? ' is-bad' : ok ? ' is-ok' : ''}${ok || bad ? ' has-state' : ''}`} value={value} disabled={disabled}
          onChange={e => onChange((e.currentTarget as HTMLSelectElement).value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {ok && <span class="sfp-state ok" style={{ right: 34 }}><IconOk /></span>}
        {bad && <span class="sfp-state bad" style={{ right: 34 }}><IconBad /></span>}
      </div>
      {bad ? <span class="sfp-err-msg">{error}</span> : hint ? <span class="sfp-hint">{hint}</span> : null}
    </div>
  );
}

// ── Toggle switch field ─────────────────────────────────────────────────────────
export function ToggleField({ label, hint, on, onToggle, disabled }: {
  label: string; hint?: string; on: boolean; onToggle: (v: boolean) => void; disabled?: boolean;
}): VNode {
  return (
    <div class="sfp-field">
      <label class="sfp-lab">{label} <InfoHint hint={hint} /></label>
      <div class="sfp-toggle-row">
        <span class="sfp-sw-wrap">
          <button type="button" class={`sfp-switch${on ? ' on' : ''}`} disabled={disabled} aria-pressed={on}
            aria-label={label} onClick={() => onToggle(!on)}><span class="knob" /></button>
        </span>
        <span class={`sfp-sw-txt${on ? '' : ' off'}`}>{on ? 'Yes' : 'No'}</span>
      </div>
    </div>
  );
}
