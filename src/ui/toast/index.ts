/**
 * src/ui/toast/index.ts
 *
 * Public API for the Siomac toast system.
 * Back-compatible with the 192 `toast.success/error/warning/info` call sites
 * that import `toast` from '@store'.
 *
 * Usage:
 *   import { toast } from '@ui/toast';
 *   toast('Message');
 *   toast.success('Saved');
 *   toast.error('Failed');
 *   toast.warning('Watch out');
 *   toast.info('FYI');
 *   toast.loading('Working…') → id
 *   toast.action('Done', { label: 'Undo', onClick: () => … }) → id
 *   toast.rich({ title: 'New message', body: '…', actions: […] }) → id
 *   toast.promise(fetch(…), { loading: '…', success: '…', error: '…' })
 *   toast.dismiss(id?)
 */

import type {
  ToastOptions,
  ToastVariant,
  ToastRecord,
  ToastAction,
  RichToastInput,
  ToastPosition,
} from './toastTypes';
import { upsertToast, removeToast, dismissToast } from './toastStore';

export type { ToastRecord, ToastVariant, ToastOptions, ToastAction, RichToastInput };
export { Toaster } from './Toaster';

// ── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;
function makeId(): string {
  return `toast-${Date.now()}-${++_counter}`;
}

// ── Default durations ─────────────────────────────────────────────────────────

function defaultDuration(variant: ToastVariant): number {
  if (variant === 'error' || variant === 'critical') return 6000;
  if (variant === 'warning') return 5000;
  return 4000;
}

// ── Core builder ──────────────────────────────────────────────────────────────

function buildRecord(
  message: string | undefined,
  variant: ToastVariant,
  opts: ToastOptions & Pick<ToastRecord, 'tier'> & {
    title?:     string;
    body?:      string;
    icon?:      string;
    avatarUrl?: string;
    meta?:      string[];
    actions?:   ToastAction[];
    onClick?:   () => void;
  },
): ToastRecord {
  const id       = opts.id ?? makeId();
  const duration = opts.duration ?? defaultDuration(variant);
  return {
    id,
    tier:        opts.tier,
    variant,
    message,
    title:       opts.title,
    body:        opts.body,
    icon:        opts.icon,
    avatarUrl:   opts.avatarUrl,
    meta:        opts.meta,
    actions:     opts.actions,
    duration,
    position:    opts.position ?? 'bottom-right',
    dismissible: opts.dismissible ?? true,
    createdAt:   Date.now(),
    paused:      false,
    remainingMs: duration,
    onClick:     opts.onClick,
    onDismiss:   opts.onDismiss,
  };
}

// ── Public toast function (callable as toast() + toast.success() etc.) ────────

function toastNormal(message: string, opts?: ToastOptions): string {
  const record = buildRecord(message, 'neutral', { tier: 'normal', ...opts });
  upsertToast(record);
  return record.id;
}

// ── Variant helpers ───────────────────────────────────────────────────────────

function toastVariant(variant: ToastVariant) {
  return (message: string, opts?: ToastOptions): string => {
    const record = buildRecord(message, variant, { tier: 'normal', ...opts });
    upsertToast(record);
    return record.id;
  };
}

// ── Loading toast (duration 0 = sticky) ──────────────────────────────────────

function toastLoading(message: string, opts?: ToastOptions): string {
  const record = buildRecord(message, 'neutral', {
    tier: 'loading',
    duration: 0,
    dismissible: false,
    ...opts,
  });
  upsertToast(record);
  return record.id;
}

// ── Action toast (default 8s) ─────────────────────────────────────────────────

interface ActionOpts extends ToastOptions {
  label:      string;
  onClick:    () => void | boolean | Promise<void | boolean>;
  altLabel?:  string;
  onAlt?:     () => void;
  variant?:   ToastVariant;
}

function toastAction(message: string, actionOpts: ActionOpts): string {
  const { label, onClick, altLabel, onAlt, variant = 'neutral', ...rest } = actionOpts;
  const actions: ToastAction[] = [{ label, onClick, tone: 'primary' }];
  if (altLabel && onAlt) {
    actions.push({ label: altLabel, onClick: onAlt, tone: 'secondary' });
  }
  const record = buildRecord(message, variant, {
    tier: 'action',
    duration: rest.duration ?? 8000,
    actions,
    ...rest,
  });
  upsertToast(record);
  return record.id;
}

// ── Rich (full-card) toast — sticky by default ────────────────────────────────

function toastRich(input: RichToastInput): string {
  const { title, body, icon, avatarUrl, variant = 'info', meta, actions, onClick, ...rest } = input;
  const record = buildRecord(undefined, variant, {
    tier: 'rich',
    title,
    body,
    icon,
    avatarUrl,
    meta,
    actions,
    onClick,
    duration: rest.duration ?? 0,  // sticky by default
    ...rest,
  });
  upsertToast(record);
  return record.id;
}

// ── Promise toast ─────────────────────────────────────────────────────────────

interface PromiseMessages<T> {
  loading: string;
  success: string | ((data: T) => string);
  error:   string | ((err: unknown) => string);
}

async function toastPromise<T>(
  promise: Promise<T>,
  messages: PromiseMessages<T>,
): Promise<T> {
  const id = toastLoading(messages.loading);
  try {
    const result = await promise;
    const msg = typeof messages.success === 'function'
      ? messages.success(result)
      : messages.success;
    upsertToast(buildRecord(msg, 'success', { id, tier: 'normal', duration: 4000, dismissible: true }));
    return result;
  } catch (err: unknown) {
    const msg = typeof messages.error === 'function'
      ? messages.error(err)
      : messages.error;
    upsertToast(buildRecord(msg, 'error', { id, tier: 'normal', duration: 6000, dismissible: true }));
    throw err;
  }
}

// ── Dismiss ───────────────────────────────────────────────────────────────────

function toastDismiss(id?: string): void {
  // No id → clear everything instantly. A specific id animates out.
  if (id === undefined) { removeToast(); return; }
  dismissToast(id);
}

// ── Compose the public API object ─────────────────────────────────────────────

export const toast = Object.assign(toastNormal, {
  success: toastVariant('success'),
  error:   toastVariant('error'),
  warning: toastVariant('warning'),
  info:    toastVariant('info'),
  neutral: toastVariant('neutral'),
  loading: toastLoading,
  action:  toastAction,
  rich:    toastRich,
  promise: toastPromise,
  dismiss: toastDismiss,
});

export type Toast = typeof toast;

// ── Unused import suppression ─────────────────────────────────────────────────
// ToastPosition is imported for re-export surface completeness but not used
// directly in this file. Keep this type reference so `verbatimModuleSyntax`
// doesn't strip it during compilation.
export type { ToastPosition };
