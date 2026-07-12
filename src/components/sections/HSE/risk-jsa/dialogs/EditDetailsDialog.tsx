/**
 * src/components/sections/HSE/risk-jsa/dialogs/EditDetailsDialog.tsx
 *
 * Inline edit-with-autosave for a Risk/JSA record's header fields (spec §13).
 * Debounced autosave through the versioned update endpoints: each save carries
 * the version it last saw; a stale version → the backend returns a conflict and
 * the dialog stops and offers to reload. Shows live Saving… / Saved status.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { Modal, Field, TextInput, TextareaInput } from '@ui';
import {
  useUpdateHazard, useUpdateAssessment, useUpdateJsa, hseRiskJsaKeys,
} from '@api/hse/riskJsa';

type Ent = 'hazard' | 'assessment' | 'jsa';
type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export function EditDetailsDialog({ open, onClose, entityType, entityId, entityRef, initial }: {
  open: boolean;
  onClose: () => void;
  entityType: Ent;
  entityId: string;
  entityRef: string;
  initial: { title: string; description?: string; reviewDueAt?: string | null; version?: number };
}): VNode {
  const qc = useQueryClient();
  const updHazard = useUpdateHazard();
  const updRa = useUpdateAssessment();
  const updJsa = useUpdateJsa();

  const [title, setTitle] = useState(initial.title);
  const [desc, setDesc] = useState(initial.description ?? '');
  const [reviewDue, setReviewDue] = useState(initial.reviewDueAt ? initial.reviewDueAt.slice(0, 10) : '');
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState('');

  const versionRef = useRef<number | undefined>(initial.version);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-seed when opening (or switching record).
  useEffect(() => {
    if (!open) return;
    setTitle(initial.title);
    setDesc(initial.description ?? '');
    setReviewDue(initial.reviewDueAt ? initial.reviewDueAt.slice(0, 10) : '');
    versionRef.current = initial.version;
    dirty.current = false;
    setState('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityId]);

  function queueSave() {
    if (state === 'conflict') return;
    dirty.current = true;
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 900);
  }

  async function save() {
    if (!dirty.current || state === 'conflict' || !title.trim()) { setState('idle'); return; }
    const common = { title: title.trim(), description: desc, reviewDueAt: reviewDue || null, version: versionRef.current };
    const res = entityType === 'hazard'
      ? await updHazard.mutateAsync({ hazardId: entityId, ...common })
      : entityType === 'assessment'
        ? await updRa.mutateAsync({ assessmentId: entityId, ...common })
        : await updJsa.mutateAsync({ jsaId: entityId, ...common });

    if (res.conflict) { setState('conflict'); return; }
    if (res.success) {
      if (versionRef.current != null) versionRef.current += 1;
      dirty.current = false;
      setSavedAt(new Date().toLocaleTimeString());
      setState('saved');
    } else {
      setState('error');
    }
  }

  function reload() {
    void qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all });
    onClose();
  }

  const statusLine =
    state === 'saving'   ? <span style={{ color: 'var(--text-muted)' }}><i class="fas fa-spinner fa-spin" /> Saving…</span>
    : state === 'saved'  ? <span style={{ color: 'var(--color-success, #16a34a)' }}><i class="fas fa-check" /> Saved {savedAt}</span>
    : state === 'error'  ? <span style={{ color: 'var(--siomac-red)' }}><i class="fas fa-triangle-exclamation" /> Save failed — keep typing to retry</span>
    : <span style={{ color: 'var(--text-muted)' }}>Changes save automatically</span>;

  return (
    <Modal
      open={open}
      title={`Edit ${entityRef}`}
      sub="Autosaves as you type."
      icon="fa-pen"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
          <span style={{ fontSize: '0.78rem' }}>{statusLine}</span>
          <button class="hse-btn primary" onClick={onClose}>Done</button>
        </div>
      }
    >
      {state === 'conflict' && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid var(--siomac-red)', borderRadius: '8px', fontSize: '0.8rem' }}>
          <strong style={{ color: 'var(--siomac-red)' }}>This record changed elsewhere.</strong> Your latest edit wasn’t saved.
          <button class="inc-action-btn" style={{ marginLeft: '10px' }} onClick={reload}><i class="fas fa-rotate" /> Reload</button>
        </div>
      )}

      <Field label="Title *" wide>
        <TextInput value={title} onInput={v => { setTitle(v); queueSave(); }} placeholder="Title" />
      </Field>
      <Field label="Description" wide>
        <TextareaInput value={desc} onInput={v => { setDesc(v); queueSave(); }} rows={3} placeholder="Description" />
      </Field>
      <Field label="Review due date">
        <TextInput value={reviewDue} onInput={v => { setReviewDue(v); queueSave(); }} type="date" />
      </Field>
    </Modal>
  );
}
