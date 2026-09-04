import type { LucideName } from '../LucideIcon';

export type ToastId = string;

export type ToastVariant = "success" | "error" | "warning" | "info" | "loading";

export type ToastTier = "normal" | "action" | "rich";

export type ToastActionTone = "primary" | "secondary" | "danger";

export interface ToastActionButton {
  label: string;
  onClick?: () => void | Promise<void>;
  href?: string;
  dismissOnClick?: boolean;
  tone?: ToastActionTone;
}

export interface ToastDetailItem {
  label: string;
  value: string;
}

export interface ToastFilePreview {
  name: string;
  type?: "pdf" | "csv" | "xlsx" | "doc" | "image" | "file";
  sizeLabel?: string;
  subtitle?: string;
  meta?: ToastDetailItem[];
}

export interface ToastOptions {
  id?: ToastId;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  dismissible?: boolean;
  ariaLive?: "polite" | "assertive";
  /** Override the tone icon with any Lucide icon; null hides the icon. */
  icon?: LucideName | null;
  /** Show the progress line when duration is greater than zero. */
  progress?: boolean;
  /** Allow supporting content and actions to expand beneath the stable header. */
  expandable?: boolean;
  /** Start with supporting content expanded. Only applies to expandable toasts. */
  defaultExpanded?: boolean;
}

export interface ToastActionOptions extends ToastOptions {
  title: string;
  description?: string;
  variant?: Exclude<ToastVariant, "loading">;
  moduleLabel?: string;
  statusLabel?: string;
  details?: ToastDetailItem[];
  note?: string;
  actions: ToastActionButton[];
}

export interface ToastRichOptions extends ToastOptions {
  title: string;
  description?: string;
  variant?: Exclude<ToastVariant, "loading">;
  moduleLabel?: string;
  statusLabel?: string;
  details?: ToastDetailItem[];
  note?: string;
  file?: ToastFilePreview;
  actions?: ToastActionButton[];
}

export interface ToastRecord {
  id: ToastId;
  tier: ToastTier;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
  dismissible: boolean;
  ariaLive: "polite" | "assertive";
  createdAt: number;
  icon?: LucideName | null;
  progress?: boolean;
  expandable?: boolean;
  defaultExpanded?: boolean;
  moduleLabel?: string;
  statusLabel?: string;
  details?: ToastDetailItem[];
  note?: string;
  file?: ToastFilePreview;
  actions?: ToastActionButton[];
  /** True while the card is animating out (exit slide). Removed from store
   *  after TOAST_EXIT_MS so the CSS animation completes before the DOM node
   *  disappears. */
  exiting?: boolean;
}
