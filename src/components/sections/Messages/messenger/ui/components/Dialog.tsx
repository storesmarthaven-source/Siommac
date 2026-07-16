// Ported verbatim from the bundle (ui/components/Dialog.tsx).
import { X } from "./icons";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  icon: ComponentChildren;
  children: ComponentChildren;
  onClose(): void;
  size?: "small" | "medium" | "large";
}

export function Dialog({ open, title, description, icon, children, onClose, size = "medium" }: DialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previous?.focus(); };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="sm-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className={`sm-dialog sm-dialog--${size}`} role="dialog" aria-modal="true" aria-labelledby="sm-dialog-title">
        <header className="sm-dialog__header">
          <span className="sm-dialog__icon" aria-hidden="true">{icon}</span>
          <span className="sm-dialog__heading">
            <h2 id="sm-dialog-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </span>
          <button ref={closeRef} className="sm-icon-button sm-dialog__close" type="button" aria-label={`Close ${title}`} onClick={onClose}><X /></button>
        </header>
        <div className="sm-dialog__body">{children}</div>
      </section>
    </div>
  );
}
