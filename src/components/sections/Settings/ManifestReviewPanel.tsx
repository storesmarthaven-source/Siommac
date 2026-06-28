/**
 * src/components/sections/Settings/ManifestReviewPanel.tsx
 *
 * Manifest review & governance (Spec §17/§26). Superadmin/admin surface over the
 * /api/settings/manifests endpoints: list every module's settings manifest with
 * its review status, inspect sections + reviewer sign-offs + approval history,
 * and drive the lifecycle (submit → review → approve / return / deprecate).
 * Each action is gated by the matching settings.manifests.* permission; the
 * server enforces the real state-machine + permissions.
 */

import { type VNode }           from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { toast }                from '@store';
import { dialog }               from '@lib/dialog';
import { useCan }               from '@lib/permissions';
import {
  useManifestsList, useManifest, useManifestAction,
  type ManifestRow, type ReviewerRole, type ManifestReviewStatus,
} from '@api/settingsCatalog';

const STATUS_LABEL: Record<ManifestReviewStatus, string> = {
  draft: 'Draft', pending_review: 'Pending review', approved: 'Approved', returned: 'Returned', deprecated: 'Deprecated',
};
const STATUS_CLASS: Record<ManifestReviewStatus, string> = {
  draft: 'draft', pending_review: 'pending', approved: 'approved', returned: 'returned', deprecated: 'deprecated',
};

const REVIEWERS: { role: ReviewerRole; label: string; col: keyof ManifestRow }[] = [
  { role: 'product_owner', label: 'Product',      col: 'reviewed_by_product' },
  { role: 'module_owner',  label: 'Module Owner', col: 'reviewed_by_module_owner' },
  { role: 'engineering',   label: 'Engineering',  col: 'reviewed_by_engineering' },
  { role: 'super_admin',   label: 'Super Admin',  col: 'reviewed_by_super_admin' },
  { role: 'compliance',    label: 'Compliance',   col: 'reviewed_by_compliance' },
  { role: 'hse',           label: 'HSE',          col: 'reviewed_by_hse' },
  { role: 'security',      label: 'Security',     col: 'reviewed_by_security' },
];

function StatusPill({ status }: { status: ManifestReviewStatus }): VNode {
  return <span class={`stg-mf-status ${STATUS_CLASS[status] ?? 'draft'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

// ── Detail pane ─────────────────────────────────────────────────────────────────

function ManifestDetail({ moduleKey }: { moduleKey: string }): VNode {
  const { data, isLoading } = useManifest(moduleKey);
  const act = useManifestAction();

  const canSubmit    = useCan('settings.manifests.submit');
  const canApprove   = useCan('settings.manifests.approve');
  const canReturn    = useCan('settings.manifests.return');
  const canDeprecate = useCan('settings.manifests.deprecate');
  const canReview    = useCan('settings.manifests.review');

  const [reviewerRole, setReviewerRole] = useState<ReviewerRole>('product_owner');

  const run = useCallback(async (args: Parameters<typeof act.mutateAsync>[0], okMsg: string) => {
    try {
      const res = await act.mutateAsync(args);
      if (!res.success) { toast.error(res.message ?? 'Action blocked.'); return; }
      toast.success(okMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed.');
    }
  }, [act]);

  if (isLoading) return <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading manifest…</div>;
  if (!data?.data) return <div class="stg-set-empty">Manifest not found.</div>;

  const { manifest: m, sections, approvals } = data.data;
  const status = m.review_status;
  const busy = act.isPending;

  const submit    = () => void run({ action: 'submit', moduleKey }, 'Submitted for review.');
  const approve   = () => void run({ action: 'approve', moduleKey }, 'Manifest approved.');
  const deprecate = async () => {
    if (!(await dialog.confirm({ title: 'Deprecate manifest?', text: `Mark "${m.module_label}" as deprecated?`, danger: true, confirmText: 'Deprecate' }))) return;
    void run({ action: 'deprecate', moduleKey }, 'Manifest deprecated.');
  };
  const ret = async () => {
    const reason = await dialog.prompt({ title: 'Return manifest', text: 'Reason for returning (required).', placeholder: 'What needs to change?' });
    if (reason === null || reason.trim() === '') return;
    void run({ action: 'return', moduleKey, reason: reason.trim() }, 'Manifest returned.');
  };
  const review = async (decision: 'approved' | 'returned') => {
    const comment = await dialog.prompt({ title: `${decision === 'approved' ? 'Sign off' : 'Request changes'} — ${reviewerRole}`, placeholder: 'Optional comment', text: 'Recorded against this manifest.' });
    if (comment === null) return; // cancelled
    void run({ action: 'review', moduleKey, reviewerRole, decision, comment: comment.trim() || undefined }, 'Review recorded.');
  };

  return (
    <div class="stg-mf-detail">
      <div class="stg-mf-detail-head">
        <div>
          <div class="stg-mf-detail-title">{m.module_label}</div>
          <div class="stg-mf-detail-sub">{m.module_key}{m.manifest_version ? ` · v${m.manifest_version}` : ''}</div>
        </div>
        <StatusPill status={status} />
      </div>

      <div class="stg-mf-stats">
        <div><b>{m.settings_count ?? 0}</b><span>settings</span></div>
        <div><b>{m.critical_settings_count ?? 0}</b><span>critical</span></div>
        <div><b>{m.user_preferences_count ?? 0}</b><span>prefs</span></div>
      </div>

      {(m.requires_security_review || m.requires_compliance_review || m.requires_hse_review) && (
        <div class="stg-mf-reqs">
          {m.requires_security_review   && <span><i class="fas fa-shield-halved" /> Security review</span>}
          {m.requires_compliance_review && <span><i class="fas fa-scale-balanced" /> Compliance review</span>}
          {m.requires_hse_review        && <span><i class="fas fa-helmet-safety" /> HSE review</span>}
        </div>
      )}

      {status === 'returned' && m.returned_reason && (
        <div class="stg-mf-returned"><i class="fas fa-rotate-left" /> Returned: {m.returned_reason}</div>
      )}
      {status === 'approved' && m.approved_at && (
        <div class="stg-mf-approved"><i class="fas fa-circle-check" /> Approved {new Date(m.approved_at).toLocaleDateString()}{m.approved_by ? ` by ${m.approved_by}` : ''}</div>
      )}

      {/* Reviewer sign-offs */}
      <div class="stg-set-section-title" style={{ marginTop: '14px' }}>Reviewer sign-offs</div>
      <div class="stg-mf-signoffs">
        {REVIEWERS.map(r => (
          <div key={r.role} class={`stg-mf-signoff ${m[r.col] ? 'done' : ''}`}>
            <i class={`fas ${m[r.col] ? 'fa-circle-check' : 'fa-circle'}`} /> {r.label}
          </div>
        ))}
      </div>

      {/* Sections */}
      {sections.length > 0 && (
        <>
          <div class="stg-set-section-title" style={{ marginTop: '14px' }}>Sections</div>
          <div class="stg-mf-sections">
            {sections.map(sec => (
              <span key={sec.id} class={`stg-mf-section ${sec.applies ? 'on' : 'off'}`}>{sec.section_key}</span>
            ))}
          </div>
        </>
      )}

      {/* Record a review */}
      {canReview && (
        <>
          <div class="stg-set-section-title" style={{ marginTop: '14px' }}>Record a review</div>
          <div class="stg-mf-reviewform">
            <select class="stg-set-input" value={reviewerRole} disabled={busy} onChange={e => setReviewerRole((e.target as HTMLSelectElement).value as ReviewerRole)}>
              {REVIEWERS.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}
            </select>
            <button type="button" class="stg-btn-save" disabled={busy} onClick={() => void review('approved')}><i class="fas fa-check" /> Sign off</button>
            <button type="button" class="stg-btn-outline" disabled={busy} onClick={() => void review('returned')}><i class="fas fa-rotate-left" /> Request changes</button>
          </div>
        </>
      )}

      {/* Approval history */}
      {approvals.length > 0 && (
        <>
          <div class="stg-set-section-title" style={{ marginTop: '14px' }}>Review history</div>
          <div class="stg-set-audit">
            {approvals.map(a => (
              <div key={a.id} class="stg-set-audit-row">
                <div class="stg-set-audit-key">{a.reviewer_role} · <b>{a.decision}</b></div>
                {a.comment && <div class="stg-set-audit-change">{a.comment}</div>}
                <div class="stg-set-audit-meta">{new Date(a.reviewed_at).toLocaleString()}{a.reviewer_id ? ` · ${a.reviewer_id}` : ''}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Lifecycle actions */}
      <div class="stg-mf-actions">
        {canSubmit && (status === 'draft' || status === 'returned') && (
          <button type="button" class="stg-btn-save" disabled={busy} onClick={submit}><i class="fas fa-paper-plane" /> Submit for review</button>
        )}
        {canApprove && status === 'pending_review' && (
          <button type="button" class="stg-btn-save" disabled={busy} onClick={approve}><i class="fas fa-circle-check" /> Approve</button>
        )}
        {canReturn && (status === 'pending_review' || status === 'approved') && (
          <button type="button" class="stg-btn-outline" disabled={busy} onClick={() => void ret()}><i class="fas fa-rotate-left" /> Return</button>
        )}
        {canDeprecate && status !== 'deprecated' && (
          <button type="button" class="stg-btn-outline stg-danger-label" disabled={busy} onClick={() => void deprecate()}><i class="fas fa-ban" /> Deprecate</button>
        )}
      </div>
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────────

export function ManifestReviewPanel(): VNode {
  const { data, isLoading, error } = useManifestsList();
  const manifests = data?.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);

  // Default-select the first pending (or first) manifest once loaded.
  const effectiveSelected = selected ?? (manifests.find(m => m.review_status === 'pending_review')?.module_key ?? manifests[0]?.module_key ?? null);

  if (isLoading) return <div class="stg-card"><div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading manifests…</div></div>;
  if (error) return <div class="stg-card"><div class="stg-set-empty"><i class="fas fa-lock" /> You don't have access to manifest review.</div></div>;
  if (manifests.length === 0) return <div class="stg-card"><div class="stg-set-empty">No manifests found. Run a catalog sync first.</div></div>;

  return (
    <div class="stg-mf-layout">
      <div class="stg-mf-list">
        {manifests.map(m => (
          <button
            key={m.module_key} type="button"
            class={`stg-mf-item ${effectiveSelected === m.module_key ? 'active' : ''}`}
            onClick={() => setSelected(m.module_key)}
          >
            <div class="stg-mf-item-main">
              <div class="stg-mf-item-label">{m.module_label}</div>
              <div class="stg-mf-item-sub">{m.settings_count ?? 0} settings{m.critical_settings_count ? ` · ${m.critical_settings_count} critical` : ''}</div>
            </div>
            <StatusPill status={m.review_status} />
          </button>
        ))}
      </div>
      <div class="stg-mf-pane stg-card">
        {effectiveSelected ? <ManifestDetail moduleKey={effectiveSelected} /> : <div class="stg-set-empty">Select a manifest.</div>}
      </div>
    </div>
  );
}
