import type { ToastVariant } from "./toastTypes";

export function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <div className="siomac-toast__icon" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" />
          <path d="M16 27.5l6.5 6.5L37 18" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    );
  }

  if (variant === "error") {
    return (
      <div className="siomac-toast__icon" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" />
          <path d="M18 18l16 16M34 18L18 34" stroke-linecap="round" />
        </svg>
      </div>
    );
  }

  if (variant === "warning") {
    return (
      <div className="siomac-toast__icon" aria-hidden="true">
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
      <div className="siomac-toast__icon siomac-toast__icon--loading" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <path d="M44 26a18 18 0 1 1-7.2-14.4" stroke-linecap="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className="siomac-toast__icon" aria-hidden="true">
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" />
        <circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none" />
        <line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round" />
      </svg>
    </div>
  );
}
