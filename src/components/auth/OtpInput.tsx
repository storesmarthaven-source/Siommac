/**
 * src/components/auth/OtpInput.tsx
 *
 * Six-digit OTP row — controlled component.
 * Renders into the existing `.tfa-otp-row` elements in app-shell.html
 * by wiring event handlers in LoginPage's useEffect; this component
 * is used when we render the OTP row from scratch (not applicable here
 * because the HTML already has the static inputs).
 *
 * Instead, we export the imperative helpers that wire the existing DOM inputs.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { forwardRef } from 'preact/compat';
import { useRef, useEffect, useImperativeHandle } from 'preact/hooks';
import type { VNode } from 'preact';

// ─── <OtpInput> component (self-rendering 6-digit row) ────────────────────────
//
// Renders its own `.tfa-otp-row` of digit inputs and wires them via the
// imperative helpers below, exposing an imperative handle. Used by
// TotpSetupPanel / TwoFactorVerifyPanel (which render the row from scratch).

export interface OtpInputHandle {
  /** Concatenated digit value (may be < length if incomplete). */
  getValue(): string;
  /** Clear all digits + error styling. */
  clear(): void;
  /** Focus the first digit. */
  focusFirst(): void;
}

export interface OtpInputProps {
  /** DOM id for the row — also the handle target for the helpers. */
  id: string;
  /** Fired when all `length` digits are filled (or a full code is pasted). */
  onComplete: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocusFirst?: boolean;
}

export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  { id, onComplete, length = 6, disabled = false, autoFocusFirst = false },
  ref,
): VNode {
  const containerRef  = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const firstInput = () => containerRef.current?.querySelector<HTMLInputElement>('.tfa-otp-digit') ?? null;

  useImperativeHandle(ref, () => ({
    getValue:   () => otpValue(id),
    clear:      () => otpClear(id),
    focusFirst: () => firstInput()?.focus(),
  }), [id]);

  useEffect(() => {
    const cleanup = wireOtpRow(id, () => onCompleteRef.current(otpValue(id)));
    if (autoFocusFirst) firstInput()?.focus();
    return cleanup;
  }, [id, length]);  // re-wire if the row identity/size changes

  return (
    <div id={id} class="tfa-otp-row" ref={containerRef}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          class="tfa-otp-digit"
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
});

// ─── Imperative OTP helpers (used by LoginPage to wire existing DOM) ──────────

/** Read the 6-digit value from an existing OTP row. */
export function otpValue(rowId: string): string {
  return [...document.querySelectorAll<HTMLInputElement>(`#${rowId} .tfa-otp-digit`)]
    .map(el => el.value)
    .join('');
}

/** Clear all inputs in an existing OTP row and remove error styling. */
export function otpClear(rowId: string): void {
  document.querySelectorAll<HTMLInputElement>(`#${rowId} .tfa-otp-digit`).forEach(el => {
    el.value = '';
    el.classList.remove('is-error');
  });
}

/** Wire keyboard/input/paste behaviour on an existing OTP row. Returns a cleanup fn. */
export function wireOtpRow(rowId: string, onComplete: () => void): () => void {
  const digits = document.querySelectorAll<HTMLInputElement>(`#${rowId} .tfa-otp-digit`);
  const arr    = [...digits];
  const handlers: Array<[Element, string, EventListener]> = [];

  function on(el: Element, evt: string, fn: EventListener) {
    el.addEventListener(evt, fn);
    handlers.push([el, evt, fn]);
  }

  arr.forEach((el, i) => {
    on(el, 'input', () => {
      el.value = el.value.replace(/\D/g, '').slice(-1);
      const next = arr[i + 1];
      if (el.value && i < arr.length - 1 && next) next.focus();
      if (otpValue(rowId).length === 6) onComplete();
    });

    on(el, 'keydown', (e) => {
      const ke   = e as KeyboardEvent;
      const prev = arr[i - 1];
      const next = arr[i + 1];
      if (ke.key === 'Backspace' && !el.value && i > 0 && prev) {
        prev.value = '';
        prev.focus();
      }
      if (ke.key === 'ArrowLeft'  && i > 0              && prev) prev.focus();
      if (ke.key === 'ArrowRight' && i < arr.length - 1 && next) next.focus();
    });

    on(el, 'paste', (e) => {
      const pe     = e as ClipboardEvent;
      const pasted = (pe.clipboardData ?? (window as unknown as { clipboardData?: DataTransfer }).clipboardData)
        ?.getData('text')
        .replace(/\D/g, '') ?? '';
      if (pasted.length >= 6) {
        pe.preventDefault();
        arr.forEach((d, j) => { d.value = pasted[j] ?? ''; });
        onComplete();
      }
    });
  });

  return () => {
    handlers.forEach(([el, evt, fn]) => el.removeEventListener(evt, fn));
  };
}
