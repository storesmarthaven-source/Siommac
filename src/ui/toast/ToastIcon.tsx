import type { ToastVariant } from "./toastTypes";
import { LucideIcon, type LucideName } from '../LucideIcon';

export function ToastIcon({ variant, icon }: { variant: ToastVariant; icon?: LucideName | null }) {
  if (icon === null) return null;
  if (icon) return <div className="siomac-toast__icon siomac-toast__icon--custom" aria-hidden="true"><LucideIcon name={icon} /></div>;
  if (variant === "success") {
    return (
      <div className="siomac-toast__icon siomac-toast__icon--tone siomac-toast__icon--success" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" />
          <path d="M16 27.5l6.5 6.5L37 18" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    );
  }

  if (variant === "error") {
    return (
      <div className="siomac-toast__icon siomac-toast__icon--tone siomac-toast__icon--error" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <path d="M18.5 5.5h15L46.5 18.5v15l-13 13h-15l-13-13v-15z" stroke-linejoin="round" />
          <line x1="26" y1="16" x2="26" y2="30" stroke-linecap="round" />
          <circle cx="26" cy="37" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </div>
    );
  }

  if (variant === "warning") {
    return (
      <div className="siomac-toast__icon siomac-toast__icon--tone siomac-toast__icon--warning" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <path d="M26 7L48 45H4L26 7Z" stroke-linejoin="round" />
          <line x1="26" y1="20" x2="26" y2="31" stroke-linecap="round" />
          <circle cx="26" cy="38" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </div>
    );
  }

  if (variant === "loading") {
    return (
      <div className="siomac-toast__icon siomac-toast__icon--tone siomac-toast__icon--loading" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <path d="M44 26a18 18 0 1 1-7.2-14.4" stroke-linecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className="siomac-toast__icon siomac-toast__icon--tone siomac-toast__icon--info" aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" />
        <circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none" />
        <line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round" />
      </svg>
    </div>
  );
}
