/**
 * src/ui/toast/toastTypes.ts
 *
 * Type definitions for the Siomac toast system.
 * This module is the single source of truth for all toast-related types.
 */

export type ToastVariant =
  | 'neutral'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'critical';

export type ToastTier = 'normal' | 'action' | 'rich' | 'loading';

export type ToastPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-center';

export interface ToastAction {
  label:    string;
  onClick?: () => void | boolean | Promise<void | boolean>;
  tone?:    'primary' | 'secondary' | 'danger';
}

export interface ToastOptions {
  id?:          string;
  title?:       string;
  duration?:    number;
  position?:    ToastPosition;
  dismissible?: boolean;
  onDismiss?:   () => void;
}

export interface RichToastInput extends ToastOptions {
  title:       string;
  body?:       string;
  icon?:       string;
  avatarUrl?:  string;
  variant?:    ToastVariant;
  meta?:       string[];
  actions?:    ToastAction[];
  onClick?:    () => void;
}

export interface ToastRecord {
  id:          string;
  tier:        ToastTier;
  variant:     ToastVariant;
  title?:      string;
  message?:    string;
  body?:       string;
  icon?:       string;
  avatarUrl?:  string;
  meta?:       string[];
  actions?:    ToastAction[];
  duration:    number;
  position:    ToastPosition;
  dismissible: boolean;
  createdAt:   number;
  paused:      boolean;
  remainingMs: number;
  /** True once the toast is animating out; the card plays its exit + height
   *  collapse, then the store removes it after the animation window. */
  exiting?:    boolean;
  onClick?:    () => void;
  onDismiss?:  () => void;
}
