/**
 * src/ui/forms/FileInput.tsx — file selection with drop, validation and a list.
 *
 * The 26 raw `type="file"` sites in the app accept anything of any size and
 * report a rejection, if at all, only after the upload fails. This validates
 * BEFORE anything is handed to the caller, and says which file was rejected and
 * why — a silent drop is the worst outcome for an evidence upload.
 *
 * Selection only: this component does not upload. Progress belongs to whatever
 * owns the request, and baking a transport in would make it unusable for the
 * three different upload paths in the app.
 */

import { type VNode } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { useFieldContext, resolveFieldState } from './fieldContext';
import './fileInput.recipe.css';

export interface FileRejection {
  file: File;
  reason: 'type' | 'size' | 'count';
  message: string;
}

export interface FileInputProps {
  /** The currently selected files. Controlled, like every other kit input. */
  files: readonly File[];
  onChange: (files: File[]) => void;
  /** Accept attribute AND the validation rule — one source, so they cannot disagree. */
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  maxFiles?: number;
  /** Called with anything rejected, so the page can surface it its own way. */
  onReject?: (rejections: FileRejection[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  validation?: ValidationState;
  /** Replaces the default "Drop files here" copy. */
  hint?: string;
  /**
   * Renders the COMPACT TRIGGER instead of the dropzone: a single button-shaped
   * control that opens the OS picker, for row/toolbar placements where a
   * dashed drop target is far too much furniture.
   *
   * Its presence is what selects the treatment — one source of truth, so there
   * is no second `variant` prop that can disagree with it.
   *
   * ⭐ It is a `<label>` wrapping the real `<input type="file">`, NOT a
   * `<Button>`. Activating a file picker is native `<label>` behaviour; giving
   * Button a polymorphic escape hatch to emit `<label>` would trade a real
   * semantic boundary for a visual one. The trigger BORROWS the Button recipe's
   * tokens so the two stay visually identical without sharing an element.
   */
  triggerLabel?: string;
  /**
   * Renders a full-width field treatment with the chosen filename on the left
   * and a visually separated picker action on the right. Like the compact
   * trigger, the whole visible control is a native label for the file input.
   */
  fieldLabel?: string;
  /** Field treatment only. Defaults to "Upload". */
  fieldActionLabel?: string;
  /** Trigger only — matches Button's control sizes. */
  size?: ControlSize;
  id?: string;
  name?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Does the file satisfy an `accept` list of extensions and/or MIME patterns? */
function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(rule => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return file.type.startsWith(rule.slice(0, -1));
    return file.type === rule;
  });
}

export function FileInput({
  files, onChange, accept, multiple = false, maxSizeMb, maxFiles,
  onReject, disabled: ownDisabled, readOnly: ownReadOnly, validation: ownValidation,
  hint, triggerLabel, fieldLabel, fieldActionLabel = 'Upload', size = 'md', id: ownId, name, forceState, class: extra, ...aria
}: FileInputProps): VNode {
  const ctx = useFieldContext();
  const { id, describedBy, validation, disabled, readOnly } =
    resolveFieldState(ctx, { validation: ownValidation, disabled: ownDisabled, readOnly: ownReadOnly, id: ownId });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const uid = useId();
  const hintId = `fi${uid}-hint`;
  const inert = disabled || readOnly;

  function accept_(incoming: FileList | File[]): void {
    const list = Array.from(incoming);
    const rejections: FileRejection[] = [];
    const kept: File[] = [];

    for (const file of list) {
      if (!matchesAccept(file, accept)) {
        rejections.push({ file, reason: 'type', message: `${file.name} is not an accepted file type.` });
        continue;
      }
      if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
        rejections.push({ file, reason: 'size', message: `${file.name} is ${formatBytes(file.size)} — the limit is ${maxSizeMb} MB.` });
        continue;
      }
      kept.push(file);
    }

    const combined = multiple ? [...files, ...kept] : kept.slice(0, 1);
    let final = combined;
    if (maxFiles !== undefined && combined.length > maxFiles) {
      final = combined.slice(0, maxFiles);
      for (const over of combined.slice(maxFiles)) {
        rejections.push({ file: over, reason: 'count', message: `Only ${maxFiles} file${maxFiles === 1 ? '' : 's'} can be attached.` });
      }
    }

    if (rejections.length) onReject?.(rejections);
    onChange(final);
    // Reset the native input so re-picking the SAME file fires change again.
    if (inputRef.current) inputRef.current.value = '';
  }

  const forced = forceState === 'hover' || forceState === 'focus' ? forceState : undefined;

  const selectedFiles = files.length > 0 && (
    <ul class="ui-file-list">
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${i}`} class="ui-file-row">
          <LucideIcon name="FileText" class="ui-file-row-icon" />
          <span class="ui-file-row-name" title={f.name}>{f.name}</span>
          <span class="ui-file-row-size">{formatBytes(f.size)}</span>
          {!inert && (
            <button
              type="button"
              class="ui-ctrl-clear"
              aria-label={`Remove ${f.name}`}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              <LucideIcon name="X" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  /* The native input, shared by all three treatments. `hidden` is deliberately NOT
     used on the trigger: a `hidden` input is not focusable, so keyboard users
     would lose the picker entirely. It is clipped instead and the label makes
     the whole control activate it. */
  const nativeInput = (
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="file"
      class="ui-file-input"
      accept={accept}
      multiple={multiple}
      disabled={inert}
      aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
      aria-label={aria['aria-label']}
      /* `onInput`, not `onChange`. The app loads `preact/compat`, which
         remaps `onChange` on form controls to the `input` event — so an
         `onChange` handler here fires on `input` anyway, and binding the
         event explicitly means the component behaves the same with or
         without compat loaded. File inputs fire both natively. */
      onInput={e => { const f = (e.target as HTMLInputElement).files; if (f?.length) accept_(f); }}
    />
  );

  if (triggerLabel !== undefined) {
    return (
      <label
        class={[
          'ui-file-trigger',
          size !== 'md' ? `ui-file-trigger--${size}` : '',
          inert ? 'ui-file-trigger--disabled' : '',
          extra ?? '',
        ].filter(Boolean).join(' ')}
        data-ui-state={forced}
      >
        <LucideIcon name="Paperclip" />
        <span class="ui-file-trigger-label">{triggerLabel}</span>
        {nativeInput}
      </label>
    );
  }

  if (fieldLabel !== undefined) {
    return (
      <div class={extra}>
        <label
          class={[
            'ui-file-field',
            validation !== 'none' ? `ui-file-field--${validation}` : '',
            inert ? 'ui-file-field--disabled' : '',
          ].filter(Boolean).join(' ')}
          data-ui-state={forced}
        >
          {nativeInput}
          <span class={`ui-file-field__value${files.length ? ' has-file' : ''}`}>
            {files[0]?.name ?? fieldLabel}
          </span>
          <span class="ui-file-field__action">{fieldActionLabel}</span>
        </label>
        {selectedFiles}
      </div>
    );
  }

  return (
    <div class={extra}>
      <div
        class={[
          'ui-file',
          dragging ? 'ui-file--dragging' : '',
          validation !== 'none' ? `ui-file--${validation}` : '',
          inert ? 'ui-file--disabled' : '',
        ].filter(Boolean).join(' ')}
        data-ui-state={forced}
        onDragOver={e => { if (!inert) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          if (inert) return;
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer?.files.length) accept_(e.dataTransfer.files);
        }}
      >
        {/* A real file input, visually hidden but focusable and labelled — so
            keyboard users get the OS picker exactly as mouse users do. */}
        {nativeInput}
        <LucideIcon name="Upload" class="ui-file-icon" />
        <div class="ui-file-copy">
          <span class="ui-file-cta">
            {inert ? 'File upload unavailable' : <>Drop {multiple ? 'files' : 'a file'} here, or <u>browse</u></>}
          </span>
          <span class="ui-file-hint" id={hintId}>
            {hint ?? [
              accept ? accept.split(',').map(s => s.trim()).join(', ') : 'Any file type',
              maxSizeMb !== undefined ? `up to ${maxSizeMb} MB` : null,
              maxFiles !== undefined ? `max ${maxFiles}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {selectedFiles}
    </div>
  );
}

/* ── OTP ───────────────────────────────────────────────────────────────────*/

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  validation?: ValidationState;
  'aria-label'?: string;
  class?: string;
}

/**
 * Segmented one-time-code entry.
 *
 * The behaviour that makes or breaks these: pasting a whole code must fill every
 * box (people always paste), and Backspace on an empty box must step back rather
 * than doing nothing.
 */
export function OtpInput({
  value, onChange, length = 6, onComplete,
  disabled = false, validation = 'none', class: extra, ...aria
}: OtpInputProps): VNode {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(length, ' ').slice(0, length).split('');

  function commit(next: string): void {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  return (
    <div
      class={`ui-otp${validation !== 'none' ? ` ui-otp--${validation}` : ''}${extra ? ` ${extra}` : ''}`}
      role="group"
      aria-label={aria['aria-label'] ?? `${length}-digit code`}
    >
      {chars.map((c, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          class={`ui-otp-box${c.trim() ? ' is-filled' : ''}`}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={validation === 'error' ? true : undefined}
          value={c.trim()}
          onInput={e => {
            const t = (e.target as HTMLInputElement).value.replace(/\D/g, '');
            const next = refs.current.map(input => input?.value ?? '').join('');
            commit(next);
            if (t) refs.current[Math.min(i + t.length, length - 1)]?.focus();
          }}
          onKeyDown={e => {
            if (e.key === 'Backspace' && !value[i]) { refs.current[i - 1]?.focus(); return; }
            if (e.key === 'ArrowLeft') { e.preventDefault(); refs.current[i - 1]?.focus(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); refs.current[i + 1]?.focus(); }
          }}
          onPaste={e => {
            // Without this, pasting a code lands entirely in one box.
            e.preventDefault();
            const pasted = e.clipboardData?.getData('text') ?? '';
            commit(pasted);
            refs.current[Math.min(pasted.replace(/\D/g, '').length, length - 1)]?.focus();
          }}
        />
      ))}
    </div>
  );
}
