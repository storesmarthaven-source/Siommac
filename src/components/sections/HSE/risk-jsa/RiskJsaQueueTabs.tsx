/**
 * src/components/sections/HSE/risk-jsa/RiskJsaQueueTabs.tsx
 *
 * The three cross-cutting Risk/JSA tabs that sit alongside the entity registers:
 *   • Pending Approval — unified queue of hazards / assessments / JSAs awaiting a
 *     decision, with inline approve / request-changes / reject (lifecycle engine).
 *   • Templates        — workflow blueprints (browse + duplicate).
 *   • Archive          — read-only list of archived records.
 */

import { type VNode } from 'preact';
import { Pagination, usePagination } from '@ui';
import {
  useRiskJsaQueue, useRiskJsaLifecycle, useWorkflowTemplates, useDuplicateTemplate,
  type QueueRow, type LifecycleAction,
} from '@api/hse/riskJsa';
import { RiskScorePill } from './shared/RiskScorePill';
import { hsePill } from '../types';

// ── Shared helpers ──────────────────────────────────────────────────────────────

const ENTITY_META: Record<QueueRow['entityType'], { label: string; icon: string }> = {
  hazard:     { label: 'Hazard',     icon: 'fa-radiation' },
  assessment: { label: 'Assessment', icon: 'fa-table-cells-large' },
  jsa:        { label: 'JSA',        icon: 'fa-list-ol' },
};

function fmtStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}
function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
}
function ageDays(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// ── Pending Approval ──────────────────────────────────────────────────────────

export function PendingApprovalTab(): VNode {
  const { data, isLoading } = useRiskJsaQueue('pending');
  const rows = data?.data ?? [];
  const pg = usePagination(rows);
  const lifecycle = useRiskJsaLifecycle();

  const act = (row: QueueRow, action: LifecycleAction, prompt?: string) => {
    let note: string | null = null;
    if (prompt) {
      const reason = window.prompt(prompt);
      if (reason === null) return;            // cancelled
      note = reason.trim() || null;
    }
    lifecycle.mutate({ action, entityType: row.entityType, entityId: row.id, note });
  };

  return (
    <div class="hse-area-main">
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-clipboard-check" /></span>
            <div>
              <div class="vt-section-title">Pending Approval</div>
              <div class="vt-section-sub">Hazards, assessments and JSAs awaiting a review decision.</div>
            </div>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Type / Ref</th>
                <th>Title</th>
                <th style={{ width: '110px' }}>Risk</th>
                <th style={{ width: '130px' }}>Status</th>
                <th style={{ width: '70px' }}>Age</th>
                <th style={{ width: '260px' }}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading queue…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Nothing awaiting approval. 🎉</td></tr>
              )}
              {pg.pageItems.map(r => {
                const m = ENTITY_META[r.entityType];
                return (
                  <tr key={`${r.entityType}-${r.id}`}>
                    <td>
                      <span class="vt-cell-name" style={{ fontSize: '0.74rem' }}><i class={`fas ${m.icon}`} style={{ marginRight: '6px', color: 'var(--text-muted)' }} />{m.label}</span>
                      <div class="vt-cell-subtext vt-cell-mono">{r.ref}</div>
                    </td>
                    <td><span class="inc-summary-text">{r.title}</span></td>
                    <td><RiskScorePill level={r.risk_level} hideScore /></td>
                    <td><span class={hsePill(r.status)}>{fmtStatus(r.status)}</span></td>
                    <td><span class={`days-open${ageDays(r.updated_at) >= 5 ? ' overdue' : ''}`}>{ageDays(r.updated_at)}d</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button class="inc-action-btn primary" disabled={lifecycle.isPending} onClick={() => act(r, 'approve')}>
                          <i class="fas fa-check" /> Approve
                        </button>
                        <button class="inc-action-btn" disabled={lifecycle.isPending} onClick={() => act(r, 'request-changes', 'What changes are required?')}>
                          <i class="fas fa-rotate-left" /> Changes
                        </button>
                        <button class="inc-action-btn" disabled={lifecycle.isPending} onClick={() => act(r, 'reject', 'Reason for rejection?')}>
                          <i class="fas fa-xmark" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="records" />
      </div>
    </div>
  );
}

// ── Archive ───────────────────────────────────────────────────────────────────

export function ArchiveTab(): VNode {
  const { data, isLoading } = useRiskJsaQueue('archived');
  const rows = data?.data ?? [];
  const pg = usePagination(rows);

  return (
    <div class="hse-area-main">
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-box-archive" /></span>
            <div>
              <div class="vt-section-title">Archive</div>
              <div class="vt-section-sub">Archived hazards, assessments and JSAs — read-only record.</div>
            </div>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Type / Ref</th>
                <th>Title</th>
                <th style={{ width: '110px' }}>Risk</th>
                <th style={{ width: '120px' }}>Site</th>
                <th style={{ width: '100px' }}>Archived</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading archive…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No archived records.</td></tr>
              )}
              {pg.pageItems.map(r => {
                const m = ENTITY_META[r.entityType];
                return (
                  <tr key={`${r.entityType}-${r.id}`}>
                    <td>
                      <span class="vt-cell-name" style={{ fontSize: '0.74rem' }}><i class={`fas ${m.icon}`} style={{ marginRight: '6px', color: 'var(--text-muted)' }} />{m.label}</span>
                      <div class="vt-cell-subtext vt-cell-mono">{r.ref}</div>
                    </td>
                    <td><span class="inc-summary-text">{r.title}</span></td>
                    <td><RiskScorePill level={r.risk_level} hideScore /></td>
                    <td><span class="hse-muted">{r.site_id ?? r.location_text ?? '—'}</span></td>
                    <td><span class="hse-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(r.updated_at)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="records" />
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function TemplatesTab(): VNode {
  const { data, isLoading } = useWorkflowTemplates();
  const templates = data?.data ?? [];
  const duplicate = useDuplicateTemplate();

  return (
    <div class="hse-area-main">
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-diagram-project" /></span>
            <div>
              <div class="vt-section-title">Workflow Templates</div>
              <div class="vt-section-sub">Approval blueprints used when a hazard, assessment or JSA is submitted.</div>
            </div>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th>Template</th>
                <th style={{ width: '300px' }}>Steps</th>
                <th style={{ width: '90px' }}>State</th>
                <th style={{ width: '120px' }} />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading templates…</td></tr>
              )}
              {!isLoading && templates.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No templates defined.</td></tr>
              )}
              {templates.map(t => (
                <tr key={t.id}>
                  <td>
                    <span class="vt-cell-name">{t.name}</span>
                    <div class="vt-cell-subtext vt-cell-mono">{t.key}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {(t.definition?.steps ?? []).map((s, i) => (
                        <span key={s.key ?? i} class="vt-pill is-info">{i + 1}. {s.label}</span>
                      ))}
                      {(t.definition?.steps ?? []).length === 0 && <span class="hse-muted">—</span>}
                    </div>
                  </td>
                  <td><span class={`vt-pill ${t.is_active ? 'is-on' : 'is-off'}`}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button class="inc-action-btn" disabled={duplicate.isPending}
                      onClick={() => duplicate.mutate({ templateId: t.id, newName: `${t.name} (copy)` })}>
                      <i class="fas fa-copy" /> Duplicate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
