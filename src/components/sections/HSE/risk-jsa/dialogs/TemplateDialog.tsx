/**
 * src/components/sections/HSE/risk-jsa/dialogs/TemplateDialog.tsx
 *
 * Workflow-template manager for the Risk & JSA module. Lists the HSE review
 * templates (hazard / assessment / JSA) with their approval steps, and lets an
 * authorised user duplicate one as an inactive draft to customise.
 */

import { type VNode } from 'preact';
import { Modal } from '@ui';
import { useWorkflowTemplates, useDuplicateTemplate, type WorkflowTemplate } from '@api/hse/riskJsa';

export interface TemplateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateDialog({ open, onClose }: TemplateDialogProps): VNode | null {
  const { data, isLoading } = useWorkflowTemplates(open);
  const duplicate = useDuplicateTemplate();
  const templates = data?.data ?? [];

  return (
    <Modal open={open} title="Workflow Templates" icon="fa-diagram-project" size="lg"
      onClose={onClose} cancelLabel="Done">
      {isLoading && <p style={{ color: 'var(--text-muted)', padding: '16px 0' }}>Loading templates…</p>}
      {!isLoading && templates.length === 0 && (
        <p style={{ color: 'var(--text-muted)', padding: '16px 0' }}>No HSE workflow templates found.</p>
      )}
      <div style={{ display: 'grid', gap: '12px' }}>
        {templates.map(t => (
          <TemplateCard key={t.id} t={t}
            onDuplicate={() => void duplicate.mutateAsync({ templateId: t.id })}
            duplicating={duplicate.isPending} />
        ))}
      </div>
    </Modal>
  );
}

function TemplateCard({ t, onDuplicate, duplicating }: {
  t: WorkflowTemplate; onDuplicate: () => void; duplicating: boolean;
}): VNode {
  const steps = t.definition?.steps ?? [];
  return (
    <div style={{ padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <strong style={{ fontSize: '0.9rem', color: 'var(--siomac-navy)' }}>{t.name}</strong>
            <span class={`vt-pill ${t.is_active ? 'is-on' : 'is-amber'}`}>{t.is_active ? 'Active' : 'Draft'}</span>
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '3px' }}>{t.description}</div>
          <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t.key}</code>
        </div>
        <button class="hse-btn" onClick={onDuplicate} disabled={duplicating}>
          <i class="fas fa-copy" /> Duplicate
        </button>
      </div>
      {steps.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
          {steps.map((s, i) => (
            <span key={s.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem',
              padding: '3px 9px', borderRadius: '999px', background: 'var(--surface-alt, #F1F5F9)', color: 'var(--text-primary)',
            }}>
              <b style={{ color: 'var(--siomac-red)' }}>{i + 1}</b> {s.label}
              {s.role && <em style={{ color: 'var(--text-muted)', fontStyle: 'normal' }}>· {s.role.replace(/_/g, ' ')}</em>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
