import { toast } from '@store';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

/**
 * Route the studio's toasts through the ERP toast system (@store) so they match
 * the rest of the app (stacking, variants, a11y) instead of the studio's own
 * bespoke toast. Defaults to a success confirmation — pass a variant for errors.
 */
export function showToast(message: string, variant: ToastVariant = 'success'): void {
  toast[variant](message);
}
