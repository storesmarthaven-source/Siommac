/**
 * NewComplianceCaseDialog.tsx
 *
 * The maker's "New Case" request — a 3-step wizard: case details → select
 * conversations (metadata-only discovery, required relevance note per selection)
 * → review + submit. Validity is capped at 30 days. One idempotency key per
 * opened submission. Submitting creates a PENDING case (an independent superadmin
 * approves it separately).
 */

import { useEffect, useState } from 'preact/hooks';
import { Stepper } from '@ui';
import { Dialog } from '../components/Dialog';
import { toast } from '@ui/toast';
import { useComplianceConversationSearch, useRequestComplianceCase } from '@api/communicationsCompliance';
import type { ComplianceCaseType } from '../../../../../../../types/messagingCompliance';
import { FilePlus2, Search, MessageSquare, X, Check } from '../components/icons';

const WIZARD_STEPS = [
  { key: 'details',       label: 'Case details',         description: 'Title, type, reason & validity' },
  { key: 'conversations', label: 'Select conversations', description: 'Metadata-only discovery' },
  { key: 'review',        label: 'Review & submit',      description: 'Confirm & send for approval' },
] as const;

const CASE_TYPES: { value: ComplianceCaseType; label: string }[] = [
  { value: 'hr_investigation',           label: 'HR Investigation' },
  { value: 'safety_investigation',       label: 'Safety Investigation' },
  { value: 'security_investigation',     label: 'Security Investigation' },
  { value: 'legal_request',              label: 'Legal / Regulatory' },
  { value: 'other_formal_investigation', label: 'Other Investigation' },
];

interface Picked { threadId: string; title: string; relevanceNote: string }

export function NewComplianceCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const request = useRequestComplianceCase();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState('');
  const [caseType, setCaseType] = useState<ComplianceCaseType>('hr_investigation');
  const [formalReason, setFormalReason] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [bounds, setBounds] = useState<{ min: string; max: string }>({ min: '', max: '' });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [idemKey, setIdemKey] = useState('');

  useEffect(() => {
    if (!open) return;
    const day = 24 * 3600_000;
    const now = Date.now();
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    setStep(1); setTitle(''); setCaseType('hr_investigation'); setFormalReason('');
    setValidUntil(iso(now + 7 * day)); setBounds({ min: iso(now + day), max: iso(now + 30 * day) });
    setSearch(''); setPicked([]); setIdemKey(crypto.randomUUID());
  }, [open]);

  const { data: searchData } = useComplianceConversationSearch({ search }, open && step === 2);
  const rows = searchData?.items ?? [];

  const step1Valid = title.trim().length >= 3 && formalReason.trim().length >= 4 && Boolean(validUntil);
  const step2Valid = picked.length > 0 && picked.every(p => p.relevanceNote.trim().length >= 4);

  function toggle(threadId: string, rowTitle: string) {
    setPicked(prev => prev.some(p => p.threadId === threadId)
      ? prev.filter(p => p.threadId !== threadId)
      : [...prev, { threadId, title: rowTitle, relevanceNote: '' }]);
  }
  function setNote(threadId: string, note: string) {
    setPicked(prev => prev.map(p => p.threadId === threadId ? { ...p, relevanceNote: note } : p));
  }

  async function submit() {
    if (!step1Valid || !step2Valid) { toast.error('Please complete every required field.'); return; }
    try {
      await request.mutateAsync({
        title: title.trim(), caseType, reason: formalReason.trim(),
        validUntil: new Date(`${validUntil}T23:59:00Z`).toISOString(),
        threads: picked.map(p => ({ threadId: p.threadId, relevanceNote: p.relevanceNote.trim() })),
        idempotencyKey: idemKey,
      });
      toast.success('Investigation submitted for approval.');
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The case could not be created.'); }
  }

  return (
    <Dialog open={open} title="New Investigation" description="Request approved, time-limited access to selected conversations." icon={<FilePlus2 />} onClose={onClose} size="large">
      <div className="smc-form">
        <Stepper
          steps={WIZARD_STEPS}
          activeIndex={step - 1}
          reachableIndex={step - 1}
          completed={[step1Valid, step2Valid, false]}
          onStep={(i) => setStep((i + 1) as 1 | 2 | 3)}
          ariaLabel="New investigation steps"
        />

        {step === 1 ? (
          <div className="smc-form__grid">
            <label className="smc-field"><span>Title <em>(required)</em></span>
              <input type="text" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Short investigation title" />
            </label>
            <label className="smc-field"><span>Case type</span>
              <select value={caseType} onChange={(e) => setCaseType((e.target as HTMLSelectElement).value as ComplianceCaseType)}>
                {CASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="smc-field smc-field--full"><span>Formal reason <em>(required)</em></span>
              <textarea rows={2} value={formalReason} onInput={(e) => setFormalReason((e.target as HTMLTextAreaElement).value)} placeholder="The legitimate basis for this investigation" />
            </label>
            <label className="smc-field"><span>Valid until <em>(max 30 days)</em></span>
              <input type="date" value={validUntil} min={bounds.min} max={bounds.max} onInput={(e) => setValidUntil((e.target as HTMLInputElement).value)} />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="smc-wiz__pick">
            <label className="smc-search"><Search /><input type="search" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} placeholder="Search conversations (metadata only)" /></label>
            <div className="smc-wiz__results">
              {rows.length === 0 ? <div className="smc-state"><span>No conversations found.</span></div> : rows.map(r => {
                const on = picked.some(p => p.threadId === r.threadId);
                const subject = r.subject ?? 'Untitled conversation';
                return (
                  <button key={r.threadId} type="button" className={`smc-wiz__row${on ? ' is-on' : ''}`} onClick={() => toggle(r.threadId, subject)}>
                    <span className="smc-wiz__rowic"><MessageSquare /></span>
                    <span className="smc-wiz__rowmain"><strong>{subject}</strong><small>{[r.threadType, r.sourceModule].filter(Boolean).join(' · ')}</small></span>
                    <span className="smc-wiz__rowtick">{on ? <Check /> : null}</span>
                  </button>
                );
              })}
            </div>
            {picked.length > 0 ? (
              <div className="smc-wiz__selected">
                <span className="smc-conv__raillabel">Selected <em>{picked.length}</em></span>
                {picked.map(p => (
                  <div key={p.threadId} className="smc-wiz__sel">
                    <div className="smc-wiz__selhead"><strong>{p.title}</strong><button type="button" aria-label="Remove" onClick={() => toggle(p.threadId, p.title)}><X /></button></div>
                    <textarea rows={2} value={p.relevanceNote} onInput={(e) => setNote(p.threadId, (e.target as HTMLTextAreaElement).value)} placeholder="Relevance note (required)" />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="smc-wiz__review">
            <dl className="smc-kv">
              <dt>Title</dt><dd>{title}</dd>
              <dt>Type</dt><dd>{CASE_TYPES.find(t => t.value === caseType)?.label}</dd>
              <dt>Reason</dt><dd>{formalReason}</dd>
              <dt>Valid until</dt><dd>{validUntil}</dd>
              <dt>Conversations</dt><dd>{picked.length}</dd>
            </dl>
            <ul className="smc-wiz__reviewlist">
              {picked.map(p => <li key={p.threadId}><strong>{p.title}</strong><small>{p.relevanceNote}</small></li>)}
            </ul>
            <p className="smc-form__note">Submitting creates a <strong>pending</strong> case. An independent approver must approve it before access is granted.</p>
          </div>
        ) : null}

        <div className="smc-form__actions">
          <button type="button" className="smc-btn" onClick={onClose}>Cancel</button>
          {step > 1 ? <button type="button" className="smc-btn" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}>Back</button> : null}
          {step < 3 ? (
            <button type="button" className="smc-btn smc-btn--primary" disabled={step === 1 ? !step1Valid : !step2Valid} onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}>Next</button>
          ) : (
            <button type="button" className="smc-btn smc-btn--primary" disabled={request.isPending || !step1Valid || !step2Valid} onClick={() => void submit()}>Submit for approval</button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
