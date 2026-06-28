/**
 * src/lib/dialog.ts — the app-wide popup / prompt / toast system.
 *
 * A small, typed, ergonomic API over the `cpop` engine (src/lib/popup.ts) — the same
 * popup the rest of the app uses (e.g. the session-expired notice). Use THIS instead of
 * the browser's `alert` / `confirm` / `prompt`, or raw `cpop.fire`, everywhere:
 *
 *   await dialog.confirm({ title: 'Delete item?', danger: true });   // → boolean
 *   const name = await dialog.prompt({ title: 'Rename', value: cur }); // → string | null
 *   dialog.success('Saved', 'Your changes are live.');
 *   dialog.error('Failed', err.message);
 *   dialog.toast({ text: 'Copied', icon: 'success' });
 *   dialog.loading(); … dialog.close();
 *
 * Imperative + framework-free, so it works from components, hooks, stores, and plain modules.
 */
import { cpop } from './popup';

export type DialogIcon = 'success' | 'error' | 'warning' | 'info' | 'question';

export interface ConfirmOptions {
  title: string;
  text?: string;
  html?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button + warning icon (deletes etc.). */
  danger?: boolean;
  icon?: DialogIcon;
}

export interface PromptOptions {
  title: string;
  text?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** Single-line type, or a multi-line textarea. */
  type?: 'text' | 'password' | 'email' | 'number' | 'textarea';
}

export interface ToastOptions {
  text?: string;
  title?: string;
  icon?: DialogIcon;
  /** ms before auto-dismiss (default 3000). */
  duration?: number;
  position?: 'top-end' | 'top-start' | 'bottom-end' | 'bottom-start' | 'top' | 'bottom';
}

export const dialog = {
  /** Notifications — a modal with an icon + message + OK. */
  success: (title: string, text?: string) => cpop.fire({ icon: 'success', title, text }),
  error:   (title: string, text?: string) => cpop.fire({ icon: 'error', title, text }),
  warning: (title: string, text?: string) => cpop.fire({ icon: 'warning', title, text }),
  info:    (title: string, text?: string) => cpop.fire({ icon: 'info', title, text }),
  /** Generic alert with custom icon/html. */
  alert: (o: { title: string; text?: string; html?: string; icon?: DialogIcon }) =>
    cpop.fire({ icon: o.icon ?? 'info', title: o.title, text: o.text, html: o.html }),

  /** Yes/No confirmation → resolves true only if confirmed. */
  async confirm(o: ConfirmOptions): Promise<boolean> {
    const r = await cpop.fire({
      icon: o.icon ?? (o.danger ? 'warning' : 'question'),
      title: o.title, text: o.text, html: o.html,
      showCancelButton: true,
      confirmButtonText: o.confirmText ?? (o.danger ? 'Delete' : 'Confirm'),
      cancelButtonText: o.cancelText ?? 'Cancel',
    });
    return r.isConfirmed;
  },

  /** Text prompt → resolves the entered value, or null if cancelled. */
  async prompt(o: PromptOptions): Promise<string | null> {
    const r = await cpop.fire({
      icon: false,
      title: o.title, text: o.text,
      input: o.type ?? 'text',
      inputValue: o.value,
      inputPlaceholder: o.placeholder,
      showCancelButton: true,
      confirmButtonText: o.confirmText ?? 'OK',
      cancelButtonText: o.cancelText ?? 'Cancel',
    });
    return r.isConfirmed ? (r.inputValue ?? '') : null;
  },

  /** Non-blocking corner toast. */
  toast: (o: ToastOptions) => cpop.fire({
    toast: true, icon: o.icon ?? 'success', title: o.title, text: o.text,
    timer: o.duration ?? 3000, timerProgressBar: true, position: o.position ?? 'top-end',
  }),

  /** Blocking spinner — call dialog.close() when done. */
  loading: () => cpop.showLoading(),
  close: () => cpop.close(),
};
