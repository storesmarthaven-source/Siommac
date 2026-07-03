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
