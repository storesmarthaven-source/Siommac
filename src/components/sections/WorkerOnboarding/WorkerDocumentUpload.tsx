/**
 * WorkerDocumentUpload.tsx — the worker's governed submit control for ONE document request.
 *
 * SHAPE FOLLOWS THE APPROVED MOCKUP
 * docs/mockups/onboarding-worker-implementation-ready.html puts this behind a DIALOG opened
 * from the row's action button — not an inline form on the card. The dialog carries the
 * explanatory copy, the file input, a "name · size" summary line, the privacy note, and a
 * primary button that stays disabled until a file is chosen.
 *
 * WHERE IT NECESSARILY DIVERGES
 * The mockup's script closes the dialog and fires a toast; a real presigned upload cannot be
 * one call. This does three server round-trips, in order:
 *   1. POST onboarding/my/document/upload-url  → signed URL + a server-derived path
 *   2. PUT  the raw file to that signed URL      → straight into the private bucket
 *   3. POST onboarding/my/document/commit       → verifies the object, links it, notifies HR
 * The path from step 1 is passed back verbatim in step 3; the server re-derives the expected
 * prefix and refuses anything else, so this cannot submit against another worker's request.
 *
 * The mockup also has no answer for three real states, which are added here rather than
 * invented visually: awaiting review, returned-with-reason, and a required expiry date.
 */

import { useRef, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Modal, LucideIcon } from '@ui';
import { hrOnboardingApi } from '@api/hr/onboarding';
import type { OnboardingWorkerDocumentRequest } from '../../../../types/hrOnboarding';

/** Matches the mockup's accept list. The server re-validates; this only avoids a wasted trip. */
const ACCEPT = '.pdf,.png,.jpg,.jpeg';
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 10 * 1024 * 1024;

type Phase = 'idle' | 'uploading' | 'submitting' | 'failed';

const sizeMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function WorkerDocumentUpload({ request, onSubmitted }: {
  request: OnboardingWorkerDocumentRequest;
  onSubmitted: () => void;
}): VNode | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = phase === 'uploading' || phase === 'submitting';
  // `uploaded` means it is with HR; the worker cannot replace it until HR returns it.
  const awaitingReview = request.status === 'uploaded';
  const returned = request.status === 'rejected';

  const reset = (): void => {
    setFile(null); setExpiry(''); setPhase('idle'); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (e: Event): void => {
    const chosen = (e.target as HTMLInputElement).files?.[0] ?? null;
    setError(null);
    if (!chosen) { setFile(null); return; }
    if (!ALLOWED.has(chosen.type)) { setFile(null); setError('Choose a PDF, PNG or JPG file.'); return; }
    if (chosen.size > MAX_BYTES) { setFile(null); setError('That file is larger than the 10 MB limit.'); return; }
    setFile(chosen);
  };

  async function submit(): Promise<void> {
    if (!file) return;
    setError(null);
    try {
      setPhase('uploading');
      const issued = await hrOnboardingApi.workerDocumentUploadUrl({
        requestId: request.requestId, fileName: file.name, mimeType: file.type, fileSize: file.size,
      });

      const put = await fetch(issued.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      // A failed PUT must not fall through to commit — the server would refuse it anyway,
      // but the worker deserves the real reason.
      if (!put.ok) throw new Error(`The file could not be uploaded (${put.status}). Please try again.`);

      setPhase('submitting');
      await hrOnboardingApi.workerDocumentCommit({
        requestId: request.requestId, path: issued.path,
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        expiryDate: expiry || null,
      });
      reset();
      setOpen(false);
      onSubmitted();
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : 'That submission did not go through.');
    }
  }

  if (awaitingReview) {
    return (
      <p class="wob-doc-state is-review">
        <LucideIcon name="Clock" size={14} /> Submitted — waiting for HR to review it.
      </p>
    );
  }

  return (
    <>
      <div class="wob-doc-action">
        {returned && request.rejectionReason && (
          <p class="wob-doc-state is-returned">
            <LucideIcon name="RotateCcw" size={14} /> Returned: {request.rejectionReason}
          </p>
        )}
        <button type="button" class="btn primary" onClick={() => { reset(); setOpen(true); }}>
          {returned ? 'Resubmit' : 'Upload'}
        </button>
      </div>

      <Modal
        open={open} title={returned ? `Resubmit ${request.label}` : `Upload ${request.label}`}
        icon="fa-file-arrow-up" size="sm"
        onClose={() => { if (!busy) { reset(); setOpen(false); } }}
        onSubmit={() => void submit()}
        submitLabel={phase === 'uploading' ? 'Uploading…' : phase === 'submitting' ? 'Submitting…' : 'Upload document'}
        submitDisabled={!file || busy || (request.requiresExpiry && !expiry)}
      >
        <p class="wob-dialog-copy">
          Upload a clear copy showing your name. Your file is stored against your employee
          record and linked to this onboarding requirement.
        </p>

        <label class="wob-file-pick">
          Document
          <input
            ref={inputRef} type="file" accept={ACCEPT} disabled={busy}
            onChange={pick} aria-label={`Choose a file for ${request.label}`}
          />
        </label>

        {/* The mockup's file summary: name · size, shown only once a file is chosen. */}
        {file && <div class="wob-file-summary">{file.name} · {sizeMb(file.size)}</div>}

        {/* Only asked for when the requirement needs it — the server enforces this too. */}
        {request.requiresExpiry && (
          <label class="wob-expiry">
            Expiry date
            <input type="date" value={expiry} disabled={busy}
              onInput={e => setExpiry((e.target as HTMLInputElement).value)} />
          </label>
        )}

        <p class="wob-dialog-note">
          PDF, PNG and JPG files are accepted, up to 10 MB. Access to your document and every
          review action is recorded.
        </p>

        {error && (
          <p class="wob-doc-state is-error" role="alert">
            <LucideIcon name="TriangleAlert" size={14} /> {error}
            {phase === 'failed' && file && (
              <button type="button" class="wob-retry" onClick={() => void submit()}>Try again</button>
            )}
          </p>
        )}
      </Modal>
    </>
  );
}
