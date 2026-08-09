import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Button, Field, FormGrid, Modal, SelectInput, TextareaInput, TextInput } from '@ui';
import { useCreateEmailTemplate, useEmailTemplateCatalog } from '@api/hr/emailTemplates';
import type { CreateEmailTemplateArgs, EmailTemplateDraft, EmailTemplateFamily, EmailTemplateSummary } from '../../../../../types/emailTemplates';

const FAMILY_OPTIONS: { value: EmailTemplateFamily; label: string; icon: string; copy: string }[] = [
  { value: 'onboarding', label: 'Onboarding', icon: 'fa-user-check', copy: 'Welcome, task, document and Day-One messages.' },
  { value: 'user_invitation', label: 'User Invitation', icon: 'fa-user-shield', copy: 'Secure platform and employee portal invitations.' },
  { value: 'worker_invitation', label: 'Worker Invitation', icon: 'fa-helmet-safety', copy: 'Registration, site and contractor invitation messages.' },
];

const STARTING_POINTS = [
  { value: 'blank', label: 'Blank template', copy: 'Begin with an empty email canvas.' },
  { value: 'company_default', label: 'Company default', copy: 'Start with the approved company header and footer.' },
  { value: 'existing', label: 'Existing template', copy: 'Copy an existing editable template.' },
  { value: 'system_template', label: 'System template', copy: 'Use an approved SIOMAC transactional pattern.' },
] as const;

interface Props {
  open: boolean;
  templates: EmailTemplateSummary[];
  onClose: () => void;
  onCreated: (template: EmailTemplateDraft) => void;
  onToast: (message: string) => void;
}

export function EmailTemplateCreateDialog({ open, templates, onClose, onCreated, onToast }: Props): VNode | null {
  const [step, setStep] = useState(1);
  const [family, setFamily] = useState<EmailTemplateFamily>('onboarding');
  const [startingPoint, setStartingPoint] = useState<CreateEmailTemplateArgs['startingPoint']>('blank');
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const [form, setForm] = useState({
    name: '', description: '', key: '', audience: 'Employee', triggerKey: '', language: 'English',
    businessUnitLabel: 'Company default', ownerLabel: 'HR Operations', approvalRequired: true,
  });
  const createMutation = useCreateEmailTemplate();
  const catalogQuery = useEmailTemplateCatalog();
  const catalog = catalogQuery.data;
  const compatibleSources = useMemo(() => templates.filter(item => item.family === family && item.status !== 'archived'), [family, templates]);
  const compatibleTriggers = useMemo(
    () => (catalog?.triggers ?? []).filter(trigger => trigger.families.includes(family)),
    [catalog?.triggers, family],
  );

  function chooseFamily(nextFamily: EmailTemplateFamily): void {
    setFamily(nextFamily);
    setSourceTemplateId('');
    setForm(current => ({ ...current, triggerKey: '', audience: '' }));
  }

  function chooseTrigger(triggerKey: string): void {
    const trigger = compatibleTriggers.find(item => item.key === triggerKey);
    setForm(current => ({
      ...current,
      triggerKey,
      audience: trigger?.audiences[0] ?? '',
    }));
  }

  function resetAndClose(): void {
    setStep(1);
    setFamily('onboarding');
    setStartingPoint('blank');
    setSourceTemplateId('');
    setForm({ name: '', description: '', key: '', audience: 'Employee', triggerKey: '', language: 'English', businessUnitLabel: 'Company default', ownerLabel: 'HR Operations', approvalRequired: true });
    onClose();
  }

  async function create(): Promise<void> {
    if (!form.name.trim() || !form.key.trim() || !form.triggerKey.trim()) {
      onToast('Template name, key and trigger are required.');
      return;
    }
    if (startingPoint === 'existing' && !sourceTemplateId) {
      onToast('Choose an existing template to copy.');
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        family,
        startingPoint,
        sourceTemplateId: sourceTemplateId || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        key: form.key.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
        audience: form.audience,
        triggerKey: form.triggerKey.trim(),
        language: form.language,
        businessUnitLabel: form.businessUnitLabel,
        ownerLabel: form.ownerLabel,
        approvalRequired: form.approvalRequired,
      });
      resetAndClose();
      onCreated(created);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Template could not be created.');
    }
  }

  const footer = (
    <>
      <Button variant="outline" onClick={step === 1 ? resetAndClose : () => setStep(value => value - 1)}>{step === 1 ? 'Cancel' : 'Back'}</Button>
      <Button variant="blue" onClick={step === 3 ? () => void create() : () => setStep(value => value + 1)} disabled={createMutation.isPending}>
        {step === 3 ? 'Create and Open Builder' : 'Continue'}
      </Button>
    </>
  );

  return (
    <Modal open={open} size="lg" title="New Email Template" sub={`Step ${step} of 3`} icon="fa-envelope-open-text" onClose={resetAndClose} footer={footer}>
      <div class="ets-create-progress" aria-label={`Step ${step} of 3`}>
        {['Family', 'Starting point', 'Template details'].map((label, index) => <span class={step >= index + 1 ? 'active' : ''}><b>{index + 1}</b>{label}</span>)}
      </div>

      {step === 1 && <div class="ets-choice-grid">
        {FAMILY_OPTIONS.map(option => <button type="button" class={`ets-choice ${family === option.value ? 'selected' : ''}`} onClick={() => chooseFamily(option.value)}>
          <i class={`fas ${option.icon}`} /><span><strong>{option.label}</strong><small>{option.copy}</small></span><i class="fas fa-circle-check" />
        </button>)}
      </div>}

      {step === 2 && <div class="ets-start-list">
        {STARTING_POINTS.map(option => <button type="button" class={`ets-start-option ${startingPoint === option.value ? 'selected' : ''}`} onClick={() => setStartingPoint(option.value)}>
          <span class="ets-radio" /><span><strong>{option.label}</strong><small>{option.copy}</small></span>
        </button>)}
        {startingPoint === 'existing' && <Field label="Template to copy">
          <SelectInput value={sourceTemplateId} onInput={setSourceTemplateId} placeholder="Choose a template" options={compatibleSources.map(item => ({ value: item.id, label: `${item.name} · v${item.currentVersion}` }))} />
        </Field>}
      </div>}

      {step === 3 && <FormGrid>
        <Field label="Template name" wide><TextInput value={form.name} onInput={name => setForm(value => ({ ...value, name }))} placeholder="e.g. Employee Welcome" /></Field>
        <Field label="Internal description" wide><TextareaInput rows={2} value={form.description} onInput={description => setForm(value => ({ ...value, description }))} placeholder="What this template is used for" /></Field>
        <Field label="Template key"><TextInput value={form.key} onInput={key => setForm(value => ({ ...value, key }))} placeholder="employee-welcome" /></Field>
        <Field label="Audience"><SelectInput value={form.audience} onInput={audience => setForm(value => ({ ...value, audience }))} options={compatibleTriggers.find(item => item.key === form.triggerKey)?.audiences ?? []} placeholder="Choose a trigger first" /></Field>
        <Field label="Trigger" wide><SelectInput value={form.triggerKey} onInput={chooseTrigger} placeholder={catalogQuery.isLoading ? 'Loading approved triggers…' : 'Choose an approved trigger'} options={compatibleTriggers.map(trigger => ({ value: trigger.key, label: trigger.label }))} /></Field>
        <Field label="Language"><SelectInput value={form.language} onInput={language => setForm(value => ({ ...value, language }))} options={catalog?.languages ?? []} /></Field>
        <Field label="Business unit"><SelectInput value={form.businessUnitLabel} onInput={businessUnitLabel => setForm(value => ({ ...value, businessUnitLabel }))} options={catalog?.businessUnits ?? []} /></Field>
        <Field label="Owner"><SelectInput value={form.ownerLabel} onInput={ownerLabel => setForm(value => ({ ...value, ownerLabel }))} options={catalog?.owners ?? []} /></Field>
        <Field label="Approval"><SelectInput value={form.approvalRequired ? 'Required' : 'Not required'} onInput={value => setForm(current => ({ ...current, approvalRequired: value === 'Required' }))} options={['Required', 'Not required']} /></Field>
      </FormGrid>}
    </Modal>
  );
}
