/**
 * src/components/sections/HSE/ptw/dialogs/PermitTemplateDialog.tsx
 *
 * Create / edit a permit template.
 * Mirrors PermitLifecycleDialogs.tsx — Modal + Field + TextInput/TextareaInput/Select.
 *
 * Exported:
 *   PermitTemplateDialog
 */

import { useState, useEffect } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, Field, TextInput, TextareaInput, FormGrid } from '@ui';
import {
  useCreatePermitTemplate,
  useUpdatePermitTemplate,
  usePermitTypes,
  type PermitTemplate,
  type PermitRiskLevel,
} from '@api/hse/ptw';

// ── Helpers ───────────────────────────────────────────────────────────────────

function DialogError({ message }: { message: string }): VNode {
  return (
    <div style={{ color: 'var(--siomac-red)', fontSize: '0.78rem', marginTop: '8px', padding: '8px 10px', background: 'rgba(220,38,38,.08)', borderRadius: '6px', border: '1px solid rgba(220,38,38,.18)' }}>
      <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />{message}
    </div>
  );
}

/** Convert a jsonb array of { text: string } objects to a newline-separated string. */
function listToText(arr: unknown[]): string {
  return arr
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) return String((item as Record<string, unknown>).text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// ── Toggle checkbox ───────────────────────────────────────────────────────────

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): VNode {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${checked ? 'rgba(27,45,84,.25)' : 'var(--border)'}`, background: checked ? 'rgba(27,45,84,.05)' : 'transparent', fontSize: '0.82rem', transition: 'all .15s' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange((e.target as HTMLInputElement).checked)}
        style={{ accentColor: 'var(--siomac-navy)', width: '15px', height: '15px', flexShrink: 0 }}
      />
      <span style={{ color: checked ? 'var(--siomac-navy)' : 'var(--text-body)', fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export interface PermitTemplateDialogProps {
  open:       boolean;
  onClose:    () => void;
  /** When provided, dialog is in edit mode; otherwise create mode. */
  template?:  PermitTemplate | null;
}

export function PermitTemplateDialog({ open, onClose, template }: PermitTemplateDialogProps): VNode | null {
  const isEdit = !!template;

  const [name,        setName]        = useState('');
  const [permitType,  setPermitType]  = useState('');
  const [description, setDescription] = useState('');
  const [riskLevel,   setRiskLevel]   = useState<PermitRiskLevel | ''>('');
  const [requiresJsa,       setRequiresJsa]       = useState(false);
  const [requiresIsolation, setRequiresIsolation] = useState(false);
  const [requiresGasTest,   setRequiresGasTest]   = useState(false);
  const [hazards,    setHazards]    = useState('');
  const [controls,   setControls]   = useState('');
  const [error,      setError]      = useState('');

  const { data: typesRes } = usePermitTypes();
  const permitTypes = typesRes?.data ?? [];

  const createMut = useCreatePermitTemplate();
  const updateMut = useUpdatePermitTemplate();
  const isPending = createMut.isPending || updateMut.isPending;

  // Seed form when editing
  useEffect(() => {
    if (template) {
      setName(template.name);
      setPermitType(template.permit_type);
      setDescription(template.description ?? '');
      setRiskLevel((template.risk_level as PermitRiskLevel | null) ?? '');
      setRequiresJsa(template.requires_jsa);
      setRequiresIsolation(template.requires_isolation);
      setRequiresGasTest(template.requires_gas_test);
      setHazards(listToText(template.hazards));
      setControls(listToText(template.controls));
    } else {
      setName('');
      setPermitType('');
      setDescription('');
      setRiskLevel('');
      setRequiresJsa(false);
      setRequiresIsolation(false);
      setRequiresGasTest(false);
      setHazards('');
      setControls('');
    }
    setError('');
  }, [template, open]);

  function handleClose() {
    setError('');
    onClose();
  }

  async function handleSubmit() {
    if (!name.trim())       { setError('Template name is required.'); return; }
    if (!permitType.trim()) { setError('Permit type is required.'); return; }
    setError('');

    const shared = {
      name:               name.trim(),
      permitType,
      description:        description.trim() || undefined,
      riskLevel:          (riskLevel || null) as PermitRiskLevel | null,
      requiresJsa,
      requiresIsolation,
      requiresGasTest,
      hazards,
      controls,
    };

    try {
      if (isEdit && template) {
        await updateMut.mutateAsync({ templateId: template.id, ...shared });
      } else {
        await createMut.mutateAsync(shared);
      }
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${isEdit ? 'update' : 'create'} template.`);
    }
  }

  const title = isEdit ? `Edit Template — ${template?.name ?? ''}` : 'New Permit Template';
  const icon  = isEdit ? 'fa-pen-to-square' : 'fa-copy';
  const submitLabel = isPending
    ? isEdit ? 'Saving…' : 'Creating…'
    : isEdit ? 'Save Changes' : 'Create Template';

  return (
    <Modal open={open} title={title} icon={icon} size="md"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={submitLabel} submitDisabled={isPending}>
      <FormGrid>
        {/* Name */}
        <Field label="Template name *" wide>
          <TextInput
            value={name}
            onInput={setName}
            placeholder="e.g. Standard Hot Work — Welding"
          />
        </Field>

        {/* Permit type */}
        <Field label="Permit type *">
          <select
            class="ui-input"
            value={permitType}
            onChange={e => setPermitType((e.target as HTMLSelectElement).value)}
          >
            <option value="">Select type…</option>
            {permitTypes.length > 0
              ? permitTypes.map(pt => (
                  <option key={pt.permit_type} value={pt.permit_type}>{pt.display_name}</option>
                ))
              : (
                <>
                  <option value="confined_space">Confined Space</option>
                  <option value="hot_work">Hot Work</option>
                  <option value="work_at_height">Work at Height</option>
                  <option value="electrical">Electrical (LOTO)</option>
                  <option value="excavation">Excavation</option>
                  <option value="lifting">Lifting</option>
                  <option value="line_break">Line Break</option>
                  <option value="radiation">Radiation</option>
                  <option value="cold_work">Cold Work</option>
                  <option value="general">General</option>
                </>
              )
            }
          </select>
        </Field>

        {/* Risk level */}
        <Field label="Default risk level">
          <select
            class="ui-input"
            value={riskLevel}
            onChange={e => setRiskLevel((e.target as HTMLSelectElement).value as PermitRiskLevel | '')}
          >
            <option value="">Not specified</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>

        {/* Description */}
        <Field label="Description" wide>
          <TextareaInput
            value={description}
            onInput={setDescription}
            rows={2}
            placeholder="Optional description for this template…"
          />
        </Field>

        {/* Requirement toggles */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Default requirements
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '6px' }}>
            <ToggleField label="Requires JSA"       checked={requiresJsa}       onChange={setRequiresJsa} />
            <ToggleField label="Requires Isolation" checked={requiresIsolation} onChange={setRequiresIsolation} />
            <ToggleField label="Requires Gas Test"  checked={requiresGasTest}   onChange={setRequiresGasTest} />
          </div>
        </div>

        {/* Hazards */}
        <Field label="Default hazards (one per line)" wide>
          <TextareaInput
            value={hazards}
            onInput={setHazards}
            rows={4}
            placeholder={"e.g.\nFlammable vapours\nOxygen deficiency\nConfinement / entrapment"}
          />
        </Field>

        {/* Controls */}
        <Field label="Default controls (one per line)" wide>
          <TextareaInput
            value={controls}
            onInput={setControls}
            rows={4}
            placeholder={"e.g.\nContinuous gas monitoring\nBuddy system — two-person entry\nRescue kit at entry point"}
          />
        </Field>

        {error && <div style={{ gridColumn: '1 / -1' }}><DialogError message={error} /></div>}
      </FormGrid>
    </Modal>
  );
}
