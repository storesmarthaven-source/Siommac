/**
 * EmployeeProfileDialogs.tsx — the ten dialogs of the LOCKED full-page reference
 * `docs/mockups/employee-profile-full-page.html`.
 *
 * Each one emits the mockup's own class names (scoped under `.epf-root` by the
 * generated stylesheet) and is wired to the authorised endpoint that already owns
 * the operation. Nothing here re-implements a command: Account Assistance calls
 * the Ticket Center's capability-routed account-support route, the employment
 * edit calls the transactional assignment command, and the exports call the
 * server-rendered export routes.
 *
 * TWO RULES GOVERN EVERY FORM BELOW.
 *
 * 1. Every field present is a field the backend contract HONOURS. Where the
 *    mockup shows an input no authorised command accepts, the input is absent
 *    rather than accepted and dropped — the deviations are listed in the header
 *    comment of the dialog concerned, so a reader can see what is missing and
 *    why rather than discovering it from a silently ignored value.
 * 2. Every form maps to exactly ONE endpoint. The Edit Employee Record dialog
 *    covers six areas backed by four commands, so its areas are grouped by
 *    command: a single Save can never leave half a change committed.
 *
 * The mockup drives these with native <dialog>.showModal(). Production renders
 * them inline inside the themed root instead, so the dark palette and the app's
 * own stacking context apply; `EmployeeProfilePage.chrome.css` supplies the
 * centring layer the static reference had no need for.
 */

import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toast } from '@store';
import { isCompleteTrinidadPhone, normalizeTrinidadPhone } from '../../../../../types/trinidadPhone';
import { TrinidadPhoneInput } from '../TrinidadPhoneInput';
import {
  useUpdateHrContact, useUpdateHrStatutory, useUpdateHrEmployeeRecord, useApplyHrAssignment,
  useCreateHrChangeRequest, useUploadHrDocument, useHrEmployees, useHrOrgUnits, useHrSites,
  type HrAuditEntry, type HrEmployeeDetail, type HrStatutoryRow,
} from '@api/hr/employees';
import { usePositions } from '@api/hr/organization';
import { useDocumentRequirements } from '@api/hr/documents';
import { hrOffboardingApi, useOffboardingMutation } from '@api/hr/offboarding';
import {
  useReadinessWorkItem, useReadinessFollowUp, useReadinessReview, ReadinessRequestError,
  type ReadinessControlMatrixEntry, type ReadinessActionKey,
} from '@api/hr/employeeReadiness';
import {
  useEmployeeAccountSupportRequests, useCreateAccountSupportRequest,
  type AccountSupportReceipt,
} from '@api/hr/employeeAccountSupport';
import {
  exportAuditHistory, exportDocumentIndex,
  type DocumentIndexScope, type EmployeeExportFormat,
} from '@api/hr/employeeExports';
import type { EmployeeProfileShell } from '@api/hr/employeeProfile';
import type { OffboardingReason } from '../../../../../types/hrOffboarding';
import { DASH, formatDate, formatDateTime, titleCase } from '../employeeProfileModel';
import {
  ACCOUNT_ASSISTANCE_TYPES, ASSISTANCE_IMPACTS, assistanceBody, assistanceLabel,
  assistancePriority, matchesSupportFilter, supportStatusBadge,
  activityTitle, type AccountServiceDomain, type AssistanceImpact, type SupportHistoryFilter,
} from './employeeProfilePageModel';
import { PageIcon, type ProfilePageIconId } from './ProfilePageIconSprite';
import type { EmployeeMasterAccess } from '../employeeMasterAccess';

// ── Shared dialog chrome (the reference's own markup) ────────────────────────

interface ShellProps {
  /** Extra class on the dialog element, matching the reference's variants. */
  variant?: string;
  labelledBy: string;
  icon: ProfilePageIconId;
  title: string;
  subtitle: string;
  onClose: () => void;
  /** Rendered in place of the heading icon when the view has a Back step. */
  onBack?: (() => void) | undefined;
  foot?: ComponentChildren;
  /**
   * The Edit Employee Record dialog nests head + body inside the reference's
   * `.employee-edit-shell > .employee-edit-main`, which supplies that dialog's
   * larger padding and section sizing. Passing those class names here keeps the
   * nesting identical rather than approximating it with a variant class.
   */
  wrap?: { shell: string; main: string };
  children: ComponentChildren;
}

/**
 * The reference's `<dialog class="edit-dialog">` shell.
 *
 * Rendered as a div with `role="dialog"`, not a native `<dialog>`: `showModal()`
 * promotes the element to the top layer, which sits OUTSIDE `.epf-root` and would
 * therefore lose both the ported stylesheet's scope and the dark palette.
 */
function DialogShell({
  variant, labelledBy, icon, title, subtitle, onClose, onBack, foot, wrap, children,
}: ShellProps): VNode {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel on open so the keyboard lands inside the dialog, and close on
  // Escape — both behaviours the native element would have provided.
  useEffect(() => {
    panelRef.current?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inner = (
    <>
      <div class="dialog-head">
        <div class="dialog-title-row">
          {onBack
            ? <button class="button dialog-back" type="button" aria-label="Back" onClick={onBack}><PageIcon id="chevron" /></button>
            : <span class="dialog-heading-icon"><PageIcon id={icon} /></span>}
          <div><h2 id={labelledBy}>{title}</h2><p>{subtitle}</p></div>
        </div>
        <button class="button dialog-close" type="button" aria-label="Close" onClick={onClose}>
          <PageIcon id="close" />
        </button>
      </div>
      {children}
      {foot && <div class="dialog-foot">{foot}</div>}
    </>
  );

  return (
    <div
      class="epf-dialog-backdrop" role="presentation"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        class={`edit-dialog${variant ? ` ${variant}` : ''}`}
      >
        {wrap
          ? <div class={wrap.shell}><div class={wrap.main}>{inner}</div></div>
          : inner}
      </div>
    </div>
  );
}

/** The reference's `.approval-note`, in either tone. */
function Note({ icon, tone, children }: { icon: ProfilePageIconId; tone?: 'info'; children: ComponentChildren }): VNode {
  return (
    <div class={`approval-note${tone === 'info' ? ' info-note' : ''}`}>
      <PageIcon id={icon} /><span>{children}</span>
    </div>
  );
}

/** One `.form-field`, with its inline validation message under the control. */
function Field({ id, label, full, error, children }: {
  id: string; label: string; full?: boolean; error?: string | undefined; children: ComponentChildren;
}): VNode {
  return (
    <div class={`form-field${full ? ' full' : ''}${error ? ' is-invalid' : ''}`}>
      <label for={id}>{label}</label>
      {children}
      {error && <small class="epf-field-error" id={`${id}-error`} role="alert">{error}</small>}
    </div>
  );
}

/** Identity strip shown at the top of the request-style dialogs. */
function RequestContext({ shell, routeLabel, routeValue }: {
  shell: EmployeeProfileShell; routeLabel: string; routeValue: string;
}): VNode {
  const name = shell.identity.displayName;
  const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
  return (
    <div class="request-context">
      <div class="request-person">
        <span class="request-avatar">{initials}</span>
        <div>
          <strong>{name}</strong>
          <span>{[shell.identity.employeeNo, shell.identity.position, shell.identity.departmentName].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div class="request-route"><span>{routeLabel}</span><strong>{routeValue}</strong></div>
    </div>
  );
}

/** The reference's three-step `.request-flow` strip. */
function RequestFlow({ label, steps }: { label: string; steps: [string, string][] }): VNode {
  return (
    <div class="request-flow" aria-label={label}>
      {steps.map(([title, detail], index) => (
        <div key={title}><b>{index + 1}</b><span><strong>{title}</strong><span>{detail}</span></span></div>
      ))}
    </div>
  );
}

/** Trim a control's value to the record's own empty state. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Report a caught mutation failure without swallowing its message. */
function fail(error: unknown, fallback: string): void {
  toast.error(error instanceof Error ? error.message : fallback);
}

// ── 1. Edit Employee Record ─────────────────────────────────────────────────

export type EditArea = 'home' | 'contact' | 'emergency' | 'employment' | 'organisation' | 'statutory' | 'service';

interface AreaDefinition {
  area: Exclude<EditArea, 'home'>;
  icon: ProfilePageIconId;
  title: string;
  /** Names the fields the panel really saves — never a wider promise. */
  detail: string;
  permitted: (access: EmployeeMasterAccess) => boolean;
}

/**
 * The six areas of the locked dialog.
 *
 * The reference gave "Organisation & Location" no panel at all and described it
 * as covering department and site. Department and site are EFFECTIVE-DATED on the
 * assignment, so they belong to the assignment command and live under Employment
 * & Assignment; this area therefore states the record-level placement it does
 * save. A button that named fields it could not write would be a dead control
 * with a convincing label.
 */
const EDIT_AREAS: AreaDefinition[] = [
  {
    area: 'contact', icon: 'user', title: 'Personal & Contact',
    detail: 'Work email, work telephone, and mobile number.',
    permitted: a => a.editContact,
  },
  {
    area: 'employment', icon: 'briefcase', title: 'Employment & Assignment',
    detail: 'Position, department, reporting line, work location, and contracted working time.',
    permitted: a => a.editEmployee,
  },
  {
    area: 'statutory', icon: 'shield', title: 'Statutory & Payroll',
    detail: 'NIS, tax profile, and the payroll readiness these determine.',
    permitted: a => a.editStatutory,
  },
  {
    area: 'emergency', icon: 'phone', title: 'Emergency Contact',
    detail: 'Contact name, relationship, and contact number.',
    permitted: a => a.editContact,
  },
  {
    area: 'organisation', icon: 'building', title: 'Organisation & Location',
    detail: 'Cost centre, employee grade, and rostered work schedule.',
    permitted: a => a.editEmployee,
  },
  {
    area: 'service', icon: 'calendar', title: 'Service Dates & Conditions',
    detail: 'Start date, contract end, probation end, employment basis, and worker category.',
    permitted: a => a.editEmployee,
  },
];

const AREA_TITLES: Record<Exclude<EditArea, 'home'>, { heading: string; sub: string }> = {
  contact:      { heading: 'Edit Contact Information', sub: 'Update the authorised employee contact details.' },
  emergency:    { heading: 'Edit Emergency Contact', sub: 'Update who to contact on this employee’s behalf.' },
  employment:   { heading: 'Edit Employment & Assignment', sub: 'Update the current appointment while preserving employment history.' },
  organisation: { heading: 'Edit Organisation & Location', sub: 'Update the record-level administrative placement.' },
  statutory:    { heading: 'Edit Statutory & Payroll', sub: 'Maintain the authorised Trinidad and Tobago statutory and payroll profile.' },
  service:      { heading: 'Edit Service Dates & Conditions', sub: 'Maintain employment dates and conditions without rewriting historical service.' },
};

const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'];
const NIS_STATUSES = ['registered', 'pending', 'exempt', 'not_applicable'];
const WORK_SCHEDULES = ['Standard', 'Shift', 'Rotational', 'Compressed', 'Flexible'];
const RELATIONSHIPS = ['Spouse', 'Parent', 'Sibling', 'Child', 'Guardian', 'Friend', 'Other'];

export interface EditEmployeeDialogProps {
  employeeId: string;
  shell: EmployeeProfileShell;
  detail: HrEmployeeDetail | undefined;
  statutory: HrStatutoryRow | null | undefined;
  access: EmployeeMasterAccess;
  onClose: () => void;
}

export function EditEmployeeDialog(props: EditEmployeeDialogProps): VNode {
  const [area, setArea] = useState<EditArea>('home');
  const areas = EDIT_AREAS.filter(definition => definition.permitted(props.access));

  if (area !== 'home') {
    const titles = AREA_TITLES[area];
    return (
      <DialogShell
        variant="employee-edit-dialog employee-edit-form-view" labelledBy="employee-edit-title"
        icon="edit" title={titles.heading} subtitle={titles.sub}
        wrap={{ shell: 'employee-edit-shell', main: 'employee-edit-main' }}
        onBack={() => setArea('home')} onClose={props.onClose}
      >
        <EditAreaForm {...props} area={area} onBack={() => setArea('home')} />
      </DialogShell>
    );
  }

  return (
    <DialogShell
      variant="employee-edit-dialog" labelledBy="employee-edit-title"
      icon="edit" title="Edit Employee Record"
      subtitle="Select a focused area to update. Historical and sensitive information remains protected."
      wrap={{ shell: 'employee-edit-shell', main: 'employee-edit-main' }}
      onClose={props.onClose}
    >
      <div class="dialog-body">
        <div class="edit-context compact">
          <span><PageIcon id="shield" /></span>
          <div>
            <strong>Controlled Record Update</strong>
            <p>Employment changes preserve effective-dated history. Work-email and statutory changes may require verification before taking effect.</p>
          </div>
        </div>
        <p class="edit-section-label">Employee Record Areas</p>
        <div class="edit-section-list">
          {areas.map(definition => (
            <button
              key={definition.area} class="edit-section" type="button"
              onClick={() => setArea(definition.area)}
            >
              <span><PageIcon id={definition.icon} /></span>
              <span><strong>{definition.title}</strong><small>{definition.detail}</small></span>
              <PageIcon id="chevron" />
            </button>
          ))}
          {areas.length === 0 && (
            <div class="epf-empty">Your capabilities do not permit editing any area of this record.</div>
          )}
        </div>
        <div class="edit-dialog-note">
          <PageIcon id="check" />Available options reflect your assigned HR capabilities. Restricted areas are not displayed.
        </div>
      </div>
    </DialogShell>
  );
}

/** One area's form. Each maps to exactly one command, so Save is atomic. */
function EditAreaForm({
  employeeId, shell, detail, statutory, access, area, onBack, onClose,
}: EditEmployeeDialogProps & { area: Exclude<EditArea, 'home'>; onBack: () => void }): VNode {
  switch (area) {
    case 'contact':
    case 'emergency':
      return <ContactAreaForm employeeId={employeeId} shell={shell} access={access} scope={area} onBack={onBack} onClose={onClose} />;
    case 'employment':
      return <EmploymentAreaForm employeeId={employeeId} shell={shell} detail={detail} onBack={onBack} onClose={onClose} />;
    case 'organisation':
      return <OrganisationAreaForm employeeId={employeeId} shell={shell} onBack={onBack} onClose={onClose} />;
    case 'statutory':
      return <StatutoryAreaForm employeeId={employeeId} statutory={statutory} onBack={onBack} onClose={onClose} />;
    case 'service':
      return <ServiceAreaForm employeeId={employeeId} shell={shell} detail={detail} onBack={onBack} onClose={onClose} />;
  }
}

/**
 * Personal & Contact / Emergency Contact → `hr/employees/contact/update`.
 *
 * The SAME form raises a tracked change request when the actor may not edit
 * directly; the backend decides, and the button says which one it will do.
 */
function ContactAreaForm({ employeeId, shell, access, scope, onBack, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; access: EmployeeMasterAccess;
  scope: 'contact' | 'emergency'; onBack: () => void; onClose: () => void;
}): VNode {
  const contact = shell.contact;
  const [workEmail, setWorkEmail] = useState(contact?.workEmail ?? '');
  const [workPhone, setWorkPhone] = useState(contact?.workPhone ?? '');
  const [mobile, setMobile] = useState(contact?.mobilePhone ?? '');
  const [name, setName] = useState(contact?.emergencyContactName ?? '');
  const [relationship, setRelationship] = useState(contact?.emergencyContactRelationship ?? '');
  const [phone, setPhone] = useState(contact?.emergencyContactPhone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useUpdateHrContact();
  const direct = access.editContact;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (scope === 'contact') {
      if (!workEmail.trim()) next.workEmail = 'A work email is required.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(workEmail.trim())) next.workEmail = 'Enter a valid email address.';
      if (!isCompleteTrinidadPhone(workPhone)) next.workPhone = 'Enter a complete seven-digit number.';
      if (!isCompleteTrinidadPhone(mobile)) next.mobile = 'Enter a complete seven-digit number.';
    } else {
      if (name.trim() && name.trim().length < 2) next.name = 'Enter the contact’s full name.';
      if (!isCompleteTrinidadPhone(phone)) next.phone = 'Enter a complete seven-digit number.';
      if (name.trim() && !phone.trim()) next.phone = 'An emergency contact needs a number.';
      if (phone.trim() && !name.trim()) next.name = 'Record who this number belongs to.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    try {
      // Only the edited half is sent: omitting the other block leaves it exactly
      // as recorded rather than rewriting it with the values this form happens
      // to be holding.
      const result = await mutation.mutateAsync({
        employeeId,
        mode: direct ? 'direct' : 'request',
        ...(scope === 'contact'
          ? { work: {
              email: workEmail.trim(),
              phone: normalizeTrinidadPhone(workPhone),
              mobilePhone: normalizeTrinidadPhone(mobile),
            } }
          : { emergency: {
              name: orNull(name),
              phone: normalizeTrinidadPhone(phone),
              relationship: orNull(relationship),
            } }),
      });
      toast.success(result.data.mode === 'request'
        ? `Change request ${result.data.changeNo ?? ''} submitted for approval.`.trim()
        : scope === 'contact' ? 'Contact information updated.' : 'Emergency contact updated.');
      onClose();
    } catch (error) { fail(error, 'The contact update could not be saved.'); }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <div class="dialog-body">
        {scope === 'contact'
          ? (
            <Note icon="info" tone="info">
              <strong>Work Email Verification</strong><br />
              A changed work email is sent to Account Support for verification before it updates the employee&rsquo;s sign-in identity.
            </Note>
          )
          : (
            <Note icon="info" tone="info">
              <strong>Emergency Use Only</strong><br />
              These details are released only when the employee cannot be reached during an incident.
            </Note>
          )}
        {!direct && (
          <Note icon="shield">
            You may propose these details but not apply them. Saving raises a tracked change request for an authorised reviewer.
          </Note>
        )}
        <div class="form-grid">
          {scope === 'contact' ? (
            <>
              <Field id="contact-email" label="Work Email" full error={errors.workEmail}>
                <input
                  id="contact-email" type="email" required maxLength={160} autocomplete="email"
                  value={workEmail} onInput={event => setWorkEmail(event.currentTarget.value)}
                />
              </Field>
              <Field id="contact-phone" label="Work Phone" error={errors.workPhone}>
                <TrinidadPhoneInput id="contact-phone" value={workPhone} onValueChange={setWorkPhone} />
              </Field>
              <Field id="contact-mobile" label="Mobile" error={errors.mobile}>
                <TrinidadPhoneInput id="contact-mobile" value={mobile} onValueChange={setMobile} />
              </Field>
            </>
          ) : (
            <>
              <Field id="emergency-name" label="Emergency Contact" full error={errors.name}>
                <input id="emergency-name" maxLength={120} value={name} onInput={event => setName(event.currentTarget.value)} />
              </Field>
              <Field id="emergency-relationship" label="Relationship" error={errors.relationship}>
                <select id="emergency-relationship" value={relationship} onChange={event => setRelationship(event.currentTarget.value)}>
                  <option value="">Not Recorded</option>
                  {RELATIONSHIPS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
              <Field id="emergency-phone" label="Emergency Phone" error={errors.phone}>
                <TrinidadPhoneInput id="emergency-phone" value={phone} onValueChange={setPhone} />
              </Field>
            </>
          )}
        </div>
      </div>
      <div class="dialog-foot">
        <button class="button" type="button" onClick={onBack}>Cancel</button>
        <button class="button primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : direct ? 'Save Contact Details' : 'Submit For Approval'}
        </button>
      </div>
    </form>
  );
}

/**
 * Employment & Assignment → `hr/employees/assignment/apply`.
 *
 * ONE transactional command: closing the outgoing period and opening the
 * incoming one commit together, and the first period is CREATED when the
 * employee has none. Conditions left blank are omitted from the payload, which
 * the command reads as "carry forward" — a posting change does not renegotiate
 * contracted working time.
 */
function EmploymentAreaForm({ employeeId, shell, detail, onBack, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; detail: HrEmployeeDetail | undefined;
  onBack: () => void; onClose: () => void;
}): VNode {
  const facts = shell.employment;
  const current = detail?.currentAssignment;
  const positions = usePositions();
  const departments = useHrOrgUnits();
  const sites = useHrSites();
  const supervisors = useHrEmployees({ limit: 500 });

  const [positionId, setPositionId] = useState(current?.position_id ?? '');
  const [departmentId, setDepartmentId] = useState(current?.department_id ?? '');
  const [siteId, setSiteId] = useState(current?.site_id ?? '');
  const [supervisorId, setSupervisorId] = useState(current?.supervisor_id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [weeklyHours, setWeeklyHours] = useState(facts.weeklyHours === null ? '' : String(facts.weeklyHours));
  const [fte, setFte] = useState(facts.fte === null ? '' : String(facts.fte));
  const [noticeDays, setNoticeDays] = useState(facts.noticePeriodDays === null ? '' : String(facts.noticePeriodDays));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useApplyHrAssignment();

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (supervisorId && supervisorId === employeeId) next.supervisorId = 'An employee cannot report to themselves.';
    if (weeklyHours.trim()) {
      const value = Number(weeklyHours);
      if (!Number.isFinite(value) || value <= 0 || value > 168) next.weeklyHours = 'Enter between 0.1 and 168 hours.';
    }
    if (fte.trim()) {
      const value = Number(fte);
      if (!Number.isFinite(value) || value <= 0 || value > 1.5) next.fte = 'Enter an FTE between 0.1 and 1.5.';
    }
    if (noticeDays.trim()) {
      const value = Number(noticeDays);
      if (!Number.isInteger(value) || value < 0 || value > 730) next.noticeDays = 'Enter a whole number of days between 0 and 730.';
    }
    if (effectiveFrom && facts.assignmentEffectiveFrom && effectiveFrom < facts.assignmentEffectiveFrom.slice(0, 10)) {
      next.effectiveFrom = `Cannot precede the current period, which began ${formatDate(facts.assignmentEffectiveFrom)}.`;
    }
    if (reason.trim().length > 500) next.reason = 'Keep the reason under 500 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    // Only conditions the operator actually filled in are sent; an omitted key
    // carries the current period's value forward, which is not the same as null.
    const conditions: Record<string, number> = {};
    if (weeklyHours.trim()) conditions.weeklyHours = Number(weeklyHours);
    if (fte.trim()) conditions.fte = Number(fte);
    if (noticeDays.trim()) conditions.noticePeriodDays = Number(noticeDays);
    try {
      const result = await mutation.mutateAsync({
        employeeId,
        positionId: orNull(positionId),
        departmentId: orNull(departmentId),
        siteId: orNull(siteId),
        supervisorId: orNull(supervisorId),
        effectiveFrom: orNull(effectiveFrom),
        ...(Object.keys(conditions).length ? { conditions } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(result.data.isFirstAssignment
        ? `First assignment period created, effective ${formatDate(result.data.effectiveFrom)}.`
        : `Assignment updated, effective ${formatDate(result.data.effectiveFrom)}.`);
      onClose();
    } catch (error) { fail(error, 'The assignment change could not be applied.'); }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <div class="dialog-body">
        <Note icon="shield">
          Changes to assignment and employment conditions are effective-dated and retained in the employee audit trail.
        </Note>
        {!facts.assignmentEffectiveFrom && (
          <Note icon="info" tone="info">
            <strong>No Assignment Period Yet</strong><br />
            This employee has no effective-dated assignment. Saving creates the first period rather than superseding one.
          </Note>
        )}
        <div class="form-grid">
          <Field id="employment-position" label="Position">
            <select id="employment-position" value={positionId} onChange={event => setPositionId(event.currentTarget.value)}>
              <option value="">Not Assigned</option>
              {(positions.data ?? []).map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
            </select>
          </Field>
          <Field id="employment-department" label="Department">
            <select id="employment-department" value={departmentId} onChange={event => setDepartmentId(event.currentTarget.value)}>
              <option value="">Not Assigned</option>
              {(departments.data ?? []).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </Field>
          <Field id="employment-manager" label="Reports To" error={errors.supervisorId}>
            <select id="employment-manager" value={supervisorId} onChange={event => setSupervisorId(event.currentTarget.value)}>
              <option value="">Not Assigned</option>
              {(supervisors.data ?? [])
                .filter(option => option.id !== employeeId)
                .map(option => <option key={option.id} value={option.id}>{option.full_name ?? option.username}</option>)}
            </select>
          </Field>
          <Field id="employment-location" label="Work Location">
            <select id="employment-location" value={siteId} onChange={event => setSiteId(event.currentTarget.value)}>
              <option value="">Not Assigned</option>
              {(sites.data ?? []).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </Field>
          <Field id="employment-hours" label="Weekly Hours" error={errors.weeklyHours}>
            <input
              id="employment-hours" type="number" min="0.1" max="168" step="0.5"
              placeholder="Carried forward" value={weeklyHours}
              onInput={event => setWeeklyHours(event.currentTarget.value)}
            />
          </Field>
          <Field id="employment-fte" label="FTE" error={errors.fte}>
            <input
              id="employment-fte" type="number" min="0.1" max="1.5" step="0.05"
              placeholder="Carried forward" value={fte}
              onInput={event => setFte(event.currentTarget.value)}
            />
          </Field>
          <Field id="employment-notice" label="Notice Period (Days)" error={errors.noticeDays}>
            <input
              id="employment-notice" type="number" min="0" max="730" step="1"
              placeholder="Carried forward" value={noticeDays}
              onInput={event => setNoticeDays(event.currentTarget.value)}
            />
          </Field>
          <Field id="employment-effective" label="Effective From" error={errors.effectiveFrom}>
            <input
              id="employment-effective" type="date" value={effectiveFrom}
              onInput={event => setEffectiveFrom(event.currentTarget.value)}
            />
          </Field>
          <Field id="employment-reason" label="Change Reason" full error={errors.reason}>
            <textarea
              id="employment-reason" maxLength={500} placeholder="Explain why the assignment is changing."
              value={reason} onInput={event => setReason(event.currentTarget.value)}
            />
          </Field>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="button" type="button" onClick={onBack}>Cancel</button>
        <button class="button primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Employment'}
        </button>
      </div>
    </form>
  );
}

/** Organisation & Location → `hr/employees/update` (record-level placement). */
function OrganisationAreaForm({ employeeId, shell, onBack, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; onBack: () => void; onClose: () => void;
}): VNode {
  const facts = shell.employment;
  const [costCentre, setCostCentre] = useState(facts.costCentre ?? '');
  const [grade, setGrade] = useState(facts.employeeGrade ?? '');
  const [schedule, setSchedule] = useState(facts.workSchedule ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useUpdateHrEmployeeRecord();

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (costCentre.trim() && costCentre.trim().length < 2) next.costCentre = 'Enter at least 2 characters.';
    if (costCentre.trim().length > 60) next.costCentre = 'Keep the cost centre under 60 characters.';
    if (grade.trim().length > 60) next.grade = 'Keep the grade under 60 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    try {
      await mutation.mutateAsync({
        employeeId,
        costCenter: orNull(costCentre),
        employeeGrade: orNull(grade),
        workSchedule: orNull(schedule),
      });
      toast.success('Organisation placement updated.');
      onClose();
    } catch (error) { fail(error, 'The organisation placement could not be saved.'); }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <div class="dialog-body">
        <Note icon="info" tone="info">
          <strong>Department And Work Location Are Effective-Dated</strong><br />
          They are changed under Employment &amp; Assignment so the change keeps its own period in employment history.
        </Note>
        <div class="form-grid">
          <Field id="organisation-cost-centre" label="Cost Centre" error={errors.costCentre}>
            <input
              id="organisation-cost-centre" maxLength={60} placeholder="e.g. ADM-001"
              value={costCentre} onInput={event => setCostCentre(event.currentTarget.value)}
            />
          </Field>
          <Field id="organisation-grade" label="Employee Grade" error={errors.grade}>
            <input id="organisation-grade" maxLength={60} value={grade} onInput={event => setGrade(event.currentTarget.value)} />
          </Field>
          <Field id="organisation-schedule" label="Work Schedule" full>
            <select id="organisation-schedule" value={schedule} onChange={event => setSchedule(event.currentTarget.value)}>
              <option value="">Not Recorded</option>
              {WORK_SCHEDULES.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="button" type="button" onClick={onBack}>Cancel</button>
        <button class="button primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Organisation Details'}
        </button>
      </div>
    </form>
  );
}

/**
 * Statutory & Payroll → `hr/employees/statutory/update`.
 *
 * The reference shows masked NIS/BIR values in editable inputs. Masked values are
 * not editable here: submitting the mask would overwrite the stored identifier
 * with dots. A blank field means "leave as recorded"; only a value the operator
 * actually types is sent.
 */
function StatutoryAreaForm({ employeeId, statutory, onBack, onClose }: {
  employeeId: string; statutory: HrStatutoryRow | null | undefined; onBack: () => void; onClose: () => void;
}): VNode {
  const [nisNumber, setNisNumber] = useState('');
  const [nisStatus, setNisStatus] = useState(statutory?.nis_status ?? 'pending');
  const [birNumber, setBirNumber] = useState('');
  const [payeApplicable, setPayeApplicable] = useState(statutory?.paye_applicable ?? true);
  const [td1Received, setTd1Received] = useState(statutory?.td1_received ?? false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useUpdateHrStatutory();

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (nisNumber.trim() && !/^[A-Za-z0-9-]{6,20}$/.test(nisNumber.trim())) {
      next.nisNumber = 'Use 6 to 20 letters, digits or hyphens.';
    }
    if (birNumber.trim() && !/^[A-Za-z0-9-]{6,20}$/.test(birNumber.trim())) {
      next.birNumber = 'Use 6 to 20 letters, digits or hyphens.';
    }
    // A statutory identifier change is the case the audit trail most needs a
    // reason for, so it is required exactly when one is being changed.
    if ((nisNumber.trim() || birNumber.trim()) && reason.trim().length < 8) {
      next.reason = 'Give a reason of at least 8 characters when changing a statutory identifier.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    try {
      const result = await mutation.mutateAsync({
        employeeId,
        ...(nisNumber.trim() ? { nisNumber: nisNumber.trim() } : {}),
        nisStatus,
        ...(birNumber.trim() ? { birFileNumber: birNumber.trim() } : {}),
        payeApplicable,
        td1Received,
      });
      toast.success(`Statutory profile saved · payroll readiness ${titleCase(result.data.payroll_readiness)}.`);
      onClose();
    } catch (error) { fail(error, 'The statutory profile could not be saved.'); }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <div class="dialog-body">
        <Note icon="shield">
          This area contains restricted statutory and payroll information. Access requires the appropriate payroll or
          statutory-profile capability, and every change is audited.
        </Note>
        <Note icon="lock" tone="info">
          <strong>Stored Identifiers Are Masked</strong><br />
          NIS and BIR numbers are never returned in full. Leave a field blank to keep the recorded value; type a new one
          only to replace it.
        </Note>
        <div class="form-grid">
          <Field id="statutory-nis" label="NIS Number" error={errors.nisNumber}>
            <input
              id="statutory-nis" maxLength={20}
              placeholder={statutory?.nis_number ? 'Recorded — leave blank to keep' : 'Not recorded'}
              value={nisNumber} onInput={event => setNisNumber(event.currentTarget.value)}
            />
          </Field>
          <Field id="statutory-bir" label="BIR Number" error={errors.birNumber}>
            <input
              id="statutory-bir" maxLength={20}
              placeholder={statutory?.bir_file_number ? 'Recorded — leave blank to keep' : 'Not recorded'}
              value={birNumber} onInput={event => setBirNumber(event.currentTarget.value)}
            />
          </Field>
          <Field id="statutory-nis-status" label="NIS Registration Status">
            <select id="statutory-nis-status" value={nisStatus} onChange={event => setNisStatus(event.currentTarget.value)}>
              {NIS_STATUSES.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
          </Field>
          <Field id="statutory-paye" label="PAYE">
            <select
              id="statutory-paye" value={payeApplicable ? 'yes' : 'no'}
              onChange={event => setPayeApplicable(event.currentTarget.value === 'yes')}
            >
              <option value="yes">Applicable</option>
              <option value="no">Not Applicable</option>
            </select>
          </Field>
          <Field id="statutory-td1" label="TD1 Received" full>
            <select
              id="statutory-td1" value={td1Received ? 'yes' : 'no'}
              onChange={event => setTd1Received(event.currentTarget.value === 'yes')}
            >
              <option value="no">Not Received</option>
              <option value="yes">Received</option>
            </select>
          </Field>
          <Field id="statutory-note" label="Change Reason" full error={errors.reason}>
            <textarea
              id="statutory-note" maxLength={500}
              placeholder="Required when changing statutory identifiers or payroll setup."
              value={reason} onInput={event => setReason(event.currentTarget.value)}
            />
          </Field>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="button" type="button" onClick={onBack}>Cancel</button>
        <button class="button primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Statutory Profile'}
        </button>
      </div>
    </form>
  );
}

/**
 * Service Dates & Conditions → `hr/employees/update`.
 *
 * Work-permit requirement and expiry appear in the reference but no authorised
 * command stores them, so they are absent rather than accepted and discarded.
 */
function ServiceAreaForm({ employeeId, shell, detail, onBack, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; detail: HrEmployeeDetail | undefined;
  onBack: () => void; onClose: () => void;
}): VNode {
  const employee = detail?.employee;
  const [startDate, setStartDate] = useState(shell.employment.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(employee?.end_date?.slice(0, 10) ?? '');
  const [probationEnd, setProbationEnd] = useState(shell.employment.probationEndDate?.slice(0, 10) ?? '');
  const [employmentType, setEmploymentType] = useState(employee?.employment_type ?? 'employee');
  const [contractor, setContractor] = useState(employee?.contractor_flag ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useUpdateHrEmployeeRecord();

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!startDate) next.startDate = 'A start date is required.';
    if (startDate && endDate && endDate < startDate) next.endDate = 'The contract end cannot precede the start date.';
    if (startDate && probationEnd && probationEnd < startDate) next.probationEnd = 'Probation cannot end before employment starts.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate()) return;
    try {
      await mutation.mutateAsync({
        employeeId,
        startDate: orNull(startDate),
        endDate: orNull(endDate),
        probationEndDate: orNull(probationEnd),
        employmentType,
        contractorFlag: contractor,
      });
      toast.success('Service dates and conditions updated.');
      onClose();
    } catch (error) { fail(error, 'The service conditions could not be saved.'); }
  }

  return (
    <form onSubmit={event => void submit(event)}>
      <div class="dialog-body">
        <Note icon="calendar">
          Start date changes affect calculated tenure. Contract and probation reminders are generated from these dates.
        </Note>
        <div class="form-grid">
          <Field id="service-start" label="Original Start Date" error={errors.startDate}>
            <input id="service-start" type="date" required value={startDate} onInput={event => setStartDate(event.currentTarget.value)} />
          </Field>
          <Field id="service-contract-end" label="Contract End Date" error={errors.endDate}>
            <input id="service-contract-end" type="date" value={endDate} onInput={event => setEndDate(event.currentTarget.value)} />
          </Field>
          <Field id="service-probation-end" label="Probation End Date" error={errors.probationEnd}>
            <input id="service-probation-end" type="date" value={probationEnd} onInput={event => setProbationEnd(event.currentTarget.value)} />
          </Field>
          <Field id="service-basis" label="Employment Basis">
            <select id="service-basis" value={employmentType} onChange={event => setEmploymentType(event.currentTarget.value)}>
              {EMPLOYMENT_TYPES.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
          </Field>
          <Field id="service-worker-category" label="Worker Category" full>
            <select
              id="service-worker-category" value={contractor ? 'contractor' : 'employee'}
              onChange={event => setContractor(event.currentTarget.value === 'contractor')}
            >
              <option value="employee">Employee</option>
              <option value="contractor">Contractor</option>
            </select>
          </Field>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="button" type="button" onClick={onBack}>Cancel</button>
        <button class="button primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save Service Conditions'}
        </button>
      </div>
    </form>
  );
}

// ── 2. Readiness review ─────────────────────────────────────────────────────

/**
 * Which offered actions are SPECIALIST REVIEW rather than HR coordination.
 *
 * The split mirrors the backend exactly: `review` and `follow-up` are different
 * routes with different permissions, so the dialog picks the route from the
 * action the server offered rather than collapsing both into one call.
 */
const REVIEW_ACTIONS = new Set<ReadinessActionKey>([
  'approve', 'return', 'approve_exception', 'mark_not_applicable',
]);

/**
 * The readiness work-item dialog.
 *
 * The reference hard-codes a payroll panel and a training panel. Production
 * renders whichever control was opened, using the work item's OWN available
 * actions: the server returns the two or three outcomes valid for THIS control
 * and THIS actor, so the dialog can never offer a transition the route will
 * refuse. `owner_required` is surfaced as its own state rather than as a generic
 * error, because it is fixed in Settings by an administrator, not by retrying.
 */
export function ReadinessReviewDialog({ employeeId, entry, onClose }: {
  employeeId: string; entry: ReadinessControlMatrixEntry; onClose: () => void;
}): VNode {
  const workItemId = entry.workItem?.id ?? null;
  const detail = useReadinessWorkItem(workItemId);
  const followUp = useReadinessFollowUp();
  const review = useReadinessReview();
  const [action, setAction] = useState<ReadinessActionKey | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  // Memoised so the default-selection effect below depends on the actual list,
  // not on a fresh `[]` produced by every render while the detail is loading.
  const actions = useMemo(() => detail.data?.availableActions ?? [], [detail.data]);
  const selected = actions.find(option => option.action === action) ?? actions[0] ?? null;

  useEffect(() => { if (!action && actions[0]) setAction(actions[0].action); }, [actions, action]);

  const ownerBlocked = entry.owner.status !== 'resolved';
  const pending = followUp.isPending || review.isPending;

  async function submit(): Promise<void> {
    if (!selected) return;
    if (selected.requiresReason && reason.trim().length < 8) {
      setReasonError('This outcome must be explained in at least 8 characters.');
      return;
    }
    setReasonError(null);
    try {
      const result = REVIEW_ACTIONS.has(selected.action)
        ? await review.mutateAsync({
          employeeId, controlKey: entry.control.controlKey, workItemId,
          action: selected.action as 'approve' | 'return' | 'approve_exception' | 'mark_not_applicable',
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        })
        : await followUp.mutateAsync({
          employeeId, controlKey: entry.control.controlKey, workItemId,
          action: selected.action === 'request_information' ? 'request_information' : 'send_reminder',
          ...(reason.trim() ? { note: reason.trim() } : {}),
        });
      toast.success(
        `${selected.label} recorded · ${result.notified} notified · readiness now ${result.coverage.percent}%.`,
      );
      onClose();
    } catch (error) {
      if (error instanceof ReadinessRequestError && error.isOwnerRequired) {
        toast.error(`Owner Required — ${error.message}`);
        return;
      }
      fail(error, 'The readiness decision could not be recorded.');
    }
  }

  return (
    <DialogShell
      variant="readiness-review-dialog" labelledBy="readiness-review-title" icon="shield"
      title={entry.control.label}
      subtitle={detail.data
        ? `Readiness work item · ${titleCase(entry.control.domain)} control`
        : `${titleCase(entry.control.domain)} control`}
      onClose={onClose}
      foot={
        <>
          <button class="button" type="button" onClick={onClose}>Close</button>
          {selected && !ownerBlocked && (
            <button class="button primary" type="button" disabled={pending} onClick={() => void submit()}>
              <PageIcon id="message" /><span>{pending ? 'Recording…' : selected.label}</span>
            </button>
          )}
        </>
      }
    >
      <div class="rr-body">
        <article class="rr-panel">
          <div class="rr-work-context">
            <div>
              <span class="request-avatar">{entry.control.label.slice(0, 2).toUpperCase()}</span>
              <div><span>Control</span><strong>{entry.control.label}</strong></div>
            </div>
            <div>
              <span>Department Owner</span>
              <strong>{entry.owner.status === 'resolved' ? entry.owner.ownerLabel : 'Owner Required'}</strong>
            </div>
            <div>
              <span>Action Needed Now</span>
              <strong>{entry.workItem?.nextResponsibleParty ?? titleCase(entry.control.resolutionType)}</strong>
            </div>
          </div>

          {ownerBlocked ? (
            <div class="rr-alert danger">
              <span><PageIcon id="alert" /></span>
              <div>
                <strong>No Owner Is Configured For This Readiness Area</strong>
                <p>{entry.owner.reason ?? 'An administrator must configure the owner under Settings before this control can be actioned.'}</p>
              </div>
              <span class="badge danger">Owner Required</span>
            </div>
          ) : (
            <div class={`rr-alert ${entry.control.isBlocking ? 'danger' : 'warning'}`}>
              <span><PageIcon id={entry.control.isBlocking ? 'alert' : 'calendar'} /></span>
              <div>
                <strong>{entry.control.label} Is {entry.percent >= 100 ? 'Ready' : entry.control.isBlocking ? 'Blocked' : 'Awaiting Review'}</strong>
                <p>{entry.control.description ?? `This control is resolved by ${titleCase(entry.control.resolutionType)}.`}</p>
              </div>
              <span class={`badge ${entry.control.isBlocking ? 'danger' : 'warning'}`}>{entry.percent}%</span>
            </div>
          )}

          <div class="rr-facts">
            <div><span>Current Stage</span><strong>{titleCase(detail.data?.status ?? entry.state)}</strong></div>
            <div><span>Department Owner</span><strong>{entry.owner.ownerLabel ?? 'Owner Required'}</strong></div>
            <div><span>Due</span><strong>{formatDate(entry.workItem?.dueDate)}</strong></div>
          </div>

          {detail.isPending && workItemId && <div class="epf-loading" role="status">Loading the work item…</div>}

          {detail.data && (
            <section class="rr-submission">
              <div class="rr-section-head">
                <div>
                  <strong>Work Item History</strong>
                  <span>Opened {formatDateTime(detail.data.createdAt)} · {detail.data.ageDays} days old</span>
                </div>
                <span class="badge neutral">{detail.data.history.length} Recorded</span>
              </div>
              {detail.data.history.length === 0 && <div class="epf-empty">No transitions recorded yet.</div>}
              {detail.data.history.slice(0, 5).map(step => (
                <div class="rr-file" key={step.id}>
                  <span><PageIcon id="clock" /></span>
                  <div>
                    <strong>{titleCase(step.toStatus)}</strong>
                    <small>
                      {formatDateTime(step.occurredAt)}
                      {step.actorName ? ` · ${step.actorName}` : ''}
                      {step.note ? ` · ${step.note}` : ''}
                    </small>
                  </div>
                </div>
              ))}
            </section>
          )}

          {!ownerBlocked && actions.length > 0 && (
            <section class="rr-decision">
              <div class="rr-section-head">
                <div>
                  <strong>What Should Happen Next?</strong>
                  <span>Only the outcomes valid for this control and your capabilities are offered.</span>
                </div>
              </div>
              <div class="decision-options">
                {actions.map(option => (
                  <label class="decision-option" key={option.action}>
                    <input
                      type="radio" name="readiness-action" value={option.action}
                      checked={selected?.action === option.action}
                      onChange={() => { setAction(option.action); setReasonError(null); }}
                    />
                    <span><PageIcon id={option.action === 'approve' ? 'check' : 'message'} /></span>
                    <span><strong>{option.label}</strong><small>{option.effect}</small></span>
                  </label>
                ))}
              </div>
              <div class="form-grid">
                <Field
                  id="readiness-reason"
                  label={selected?.requiresReason ? 'Reason (Required)' : 'Note (Optional)'}
                  full error={reasonError ?? undefined}
                >
                  <textarea
                    id="readiness-reason" maxLength={500} value={reason}
                    placeholder={selected?.requiresReason
                      ? 'Explain the decision for the audit trail.'
                      : 'Add context for the owner receiving this.'}
                    onInput={event => setReason(event.currentTarget.value)}
                  />
                </Field>
              </div>
              <div class="rr-next-step">
                <PageIcon id="info" />
                <span><strong>After you submit:</strong> the transition is audited, the owner and the HR coordinator are
                  notified, and readiness is recalculated.</span>
              </div>
            </section>
          )}

          {!ownerBlocked && actions.length === 0 && !detail.isPending && (
            <div class="rr-next-step">
              <PageIcon id="lock" />
              <span>You may view this control but not act on it. Resolution stays with {entry.owner.ownerLabel ?? 'the configured owner'}.</span>
            </div>
          )}
        </article>
      </div>
    </DialogShell>
  );
}

// ── 3. Account assistance ───────────────────────────────────────────────────

/**
 * Request Account Assistance → `createAccountSupportRequest`.
 *
 * No account change happens here: the route creates a capability-routed ticket,
 * a handoff to the resolved receiver, and the notifications. The receipt view is
 * shown only after the route returns the real request number.
 */
export function AccountAssistanceDialog({ employeeId, shell, onClose, onOpenHistory }: {
  employeeId: string; shell: EmployeeProfileShell; onClose: () => void; onOpenHistory: () => void;
}): VNode {
  const [domain, setDomain] = useState<AccountServiceDomain>('password_reset');
  const [impact, setImpact] = useState<AssistanceImpact>('standard');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AccountSupportReceipt | null>(null);
  const mutation = useCreateAccountSupportRequest();

  async function submit(): Promise<void> {
    if (details.trim().length < 10) {
      setError('Describe the issue in at least 10 characters so the support owner can act on it.');
      return;
    }
    setError(null);
    const label = assistanceLabel(domain);
    try {
      const created = await mutation.mutateAsync({
        subjectId: employeeId,
        serviceDomain: domain,
        requestedAction: label,
        subject: `${label} · ${shell.identity.displayName}`,
        body: assistanceBody(details, impact),
        priority: assistancePriority(impact),
      });
      setReceipt(created);
      toast.success(`Account support request ${created.ticketNumber} created.`);
    } catch (caught) { fail(caught, 'The account support request could not be created.'); }
  }

  if (receipt) {
    return (
      <DialogShell
        variant="account-assistance-dialog" labelledBy="account-assistance-title" icon="headset"
        title="Request Account Assistance" subtitle="Route an employee account issue to the authorised support owner."
        onClose={onClose}
      >
        <div class="assistance-receipt">
          <span class="receipt-mark"><PageIcon id="check" /></span>
          <h3>Account Support Request Created</h3>
          <p>The request was recorded and routed to Account Support. This receipt confirms the request&mdash;not completion
            of the account action.</p>
          <div class="receipt-details">
            <div><span>Request</span><strong>{receipt.ticketNumber}</strong></div>
            <div><span>Status</span><strong>Submitted</strong></div>
            <div><span>Owner</span><strong>Account Support</strong></div>
            <div><span>Type</span><strong>{assistanceLabel(domain)}</strong></div>
          </div>
          <div class="receipt-actions">
            <button class="button" type="button" onClick={onClose}>Close</button>
            <button class="button primary" type="button" onClick={onOpenHistory}>View Request</button>
          </div>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      variant="account-assistance-dialog" labelledBy="account-assistance-title" icon="headset"
      title="Request Account Assistance" subtitle="Route an employee account issue to the authorised support owner."
      onClose={onClose}
      foot={
        <>
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button primary" type="button" disabled={mutation.isPending} onClick={() => void submit()}>
            <PageIcon id="headset" />{mutation.isPending ? 'Creating…' : 'Create Support Request'}
          </button>
        </>
      }
    >
      <div class="assistance-layout">
        <div class="assistance-main">
          <RequestContext shell={shell} routeLabel="Support Owner" routeValue="Account Support" />
          <Note icon="info" tone="info">
            <strong>No Account Change Happens Here</strong><br />
            This form creates a controlled request. Password, MFA, session, device, suspension, and access changes remain
            restricted to authorised support personnel.
          </Note>
          <h3 class="assistance-section-title">What Does The Employee Need Help With?</h3>
          <div class="form-grid">
            <Field id="account-issue-type" label="Assistance Type" full>
              <select
                id="account-issue-type" value={domain}
                onChange={event => setDomain(event.currentTarget.value as AccountServiceDomain)}
              >
                {ACCOUNT_ASSISTANCE_TYPES.map(option => (
                  <option key={option.domain} value={option.domain}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <h3 class="assistance-section-title" style="margin-top:14px">Business Impact</h3>
          <div class="impact-options">
            {ASSISTANCE_IMPACTS.map(option => (
              <label class="impact-option" key={option.value}>
                <input
                  type="radio" name="account-impact" checked={impact === option.value}
                  onChange={() => setImpact(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div class="form-grid">
            <Field id="account-assistance-summary" label="Issue Details" full error={error ?? undefined}>
              <textarea
                id="account-assistance-summary" maxLength={4000} value={details}
                placeholder="Describe what the employee is experiencing and any safe troubleshooting already completed."
                onInput={event => setDetails(event.currentTarget.value)}
              />
            </Field>
          </div>
          <div class="account-route">
            <div><span>Request Route</span><strong>Account Support · Ticket Center</strong></div>
            <span class="badge neutral">Selected By Policy</span>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

// ── 4. Account request history ──────────────────────────────────────────────

export function AccountRequestHistoryDialog({ employeeId, employeeName, onClose }: {
  employeeId: string; employeeName: string; onClose: () => void;
}): VNode {
  const [filter, setFilter] = useState<SupportHistoryFilter>('all');
  const [search, setSearch] = useState('');
  const query = useEmployeeAccountSupportRequests(employeeId);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter(row => {
      if (!matchesSupportFilter(row.status, filter)) return false;
      if (!needle) return true;
      return row.ticketNumber.toLowerCase().includes(needle)
        || row.subject.toLowerCase().includes(needle)
        || (row.requestedAction ?? '').toLowerCase().includes(needle);
    });
  }, [query.data, filter, search]);

  return (
    <DialogShell
      variant="history-dialog" labelledBy="account-request-history-title" icon="clock"
      title="Account Request History" subtitle={`Tracked account-support requests for ${employeeName}.`}
      onClose={onClose}
      foot={<button class="button primary" type="button" onClick={onClose}>Done</button>}
    >
      <div class="dialog-body">
        <div class="history-toolbar">
          {(['all', 'open', 'resolved'] as SupportHistoryFilter[]).map(value => (
            <button
              key={value} type="button" class={`filter${filter === value ? ' active' : ''}`}
              aria-pressed={filter === value} onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All Requests' : titleCase(value)}
            </button>
          ))}
          <label class="search-mini">
            <PageIcon id="search" />
            <input
              type="search" value={search} placeholder="Search request history"
              aria-label="Search request history"
              onInput={event => setSearch(event.currentTarget.value)}
            />
          </label>
        </div>
        {query.isPending && <div class="epf-loading" role="status">Loading request history…</div>}
        {query.isError && (
          <div class="epf-error" role="alert">
            {query.error instanceof Error ? query.error.message : 'Request history could not be loaded.'}
          </div>
        )}
        {query.data && rows.length === 0 && (
          <div class="epf-empty">
            {query.data.length === 0
              ? 'No account support requests have been raised for this employee.'
              : 'No requests match the selected filters.'}
          </div>
        )}
        {rows.length > 0 && (
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>Request</th><th>Type</th><th>Submitted</th><th>Raised By</th><th>Priority</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const badge = supportStatusBadge(row.status);
                  return (
                    <tr key={row.id}>
                      <td><strong>{row.ticketNumber}</strong><small>{row.subject}</small></td>
                      <td>{row.serviceDomain ? assistanceLabel(row.serviceDomain) : titleCase(row.requestedAction)}</td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{row.fromName ?? row.fromUsername}</td>
                      <td>{titleCase(row.priority ?? 'medium')}</td>
                      <td><span class={`badge ${badge.tone}`.trim()}>{badge.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div class="access-help-note">
          <PageIcon id="info" />
          <span>HR sees only requests associated with this employee and permitted by the current user&rsquo;s access.
            Technical security evidence remains restricted.</span>
        </div>
      </div>
    </DialogShell>
  );
}

// ── 5. Add document ─────────────────────────────────────────────────────────

const CONFIDENTIALITY_OPTIONS = [
  { value: 'internal',  label: 'Protected HR Record' },
  { value: 'restricted', label: 'Payroll Restricted' },
  { value: 'public',    label: 'Employee Visible' },
];

/**
 * Add Employee Document → presigned upload, then `documents/commit`.
 *
 * The reference also offers a linked requirement, an issue date, a verification
 * owner, a version action and free-text notes. The commit contract stores none of
 * those, so they are absent: a document type IS the requirement link the engine
 * matches on, and it is a picker over the real requirement catalogue.
 */
export function AddDocumentDialog({ employeeId, shell, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; onClose: () => void;
}): VNode {
  const requirements = useDocumentRequirements(true);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [expiry, setExpiry] = useState('');
  const [confidentiality, setConfidentiality] = useState('internal');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useUploadHrDocument();

  const requirement = (requirements.data ?? []).find(row => row.documentType === documentType);
  const MAX_BYTES = 15 * 1024 * 1024;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!file) next.file = 'Choose the document file to upload.';
    else if (file.size > MAX_BYTES) next.file = 'The file must be 15 MB or smaller.';
    if (!title.trim()) next.title = 'Give the document a name.';
    else if (title.trim().length < 3) next.title = 'Use at least 3 characters.';
    if (!documentType) next.documentType = 'Select the document type this satisfies.';
    if (requirement?.requiresExpiry && !expiry) next.expiry = 'This document type requires an expiry date.';
    if (expiry && expiry < new Date().toISOString().slice(0, 10)) next.expiry = 'The expiry date is already in the past.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!validate() || !file) return;
    try {
      await mutation.mutateAsync({
        employeeId, file, documentType, title: title.trim(), confidentiality,
        ...(expiry ? { expiryDate: expiry } : {}),
      });
      toast.success(`${title.trim()} uploaded and queued for verification.`);
      onClose();
    } catch (error) { fail(error, 'The document could not be uploaded.'); }
  }

  return (
    <DialogShell
      variant="request-change-dialog" labelledBy="add-document-title" icon="file"
      title="Add Employee Document" subtitle="Upload, classify, and route employee evidence for verification."
      onClose={onClose}
    >
      <form onSubmit={event => void submit(event)}>
        <div class="dialog-body">
          <RequestContext shell={shell} routeLabel="Document Owner" routeValue="Employee Record" />
          <label class={`upload-dropzone${errors.file ? ' is-invalid' : ''}`}>
            <input
              type="file" hidden accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={event => {
                const chosen = event.currentTarget.files?.[0] ?? null;
                setFile(chosen);
                if (chosen && !title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, ''));
              }}
            />
            <span class="upload-dropzone-icon"><PageIcon id="plus" /></span>
            <span class="upload-dropzone-copy">
              <strong>{file ? file.name : 'Choose A File Or Drag It Here'}</strong>
              <small>{file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Malware scanned before storage`
                : 'PDF, JPG, or PNG · Maximum 15 MB · Malware scanned before storage'}</small>
            </span>
          </label>
          {errors.file && <small class="epf-field-error" role="alert">{errors.file}</small>}
          <div class="form-grid" style="margin-top:14px">
            <Field id="document-name" label="Document Name" error={errors.title}>
              <input
                id="document-name" maxLength={200} required placeholder="e.g. Safety Awareness Certificate"
                value={title} onInput={event => setTitle(event.currentTarget.value)}
              />
            </Field>
            <Field id="document-type" label="Document Type" error={errors.documentType}>
              <select id="document-type" value={documentType} onChange={event => setDocumentType(event.currentTarget.value)}>
                <option value="">Select Document Type</option>
                {(requirements.data ?? []).map(option => (
                  <option key={option.id} value={option.documentType}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field id="document-expiry" label={requirement?.requiresExpiry ? 'Expiry Date (Required)' : 'Expiry Date'} error={errors.expiry}>
              <input id="document-expiry" type="date" value={expiry} onInput={event => setExpiry(event.currentTarget.value)} />
            </Field>
            <Field id="document-access" label="Access Classification">
              <select id="document-access" value={confidentiality} onChange={event => setConfidentiality(event.currentTarget.value)}>
                {CONFIDENTIALITY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Note icon="shield">
            The document is stored against this employee and enters the verification queue. It does not satisfy its
            requirement until an authorised verifier accepts it.
          </Note>
        </div>
        <div class="dialog-foot">
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button primary" type="submit" disabled={mutation.isPending}>
            <PageIcon id="plus" />{mutation.isPending ? 'Uploading…' : 'Add Document'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── 6. Export document index ────────────────────────────────────────────────

const DOCUMENT_SCOPES: { value: DocumentIndexScope; label: string }[] = [
  { value: 'all_authorised',   label: 'All Authorised Documents' },
  { value: 'current_filters',  label: 'Currently Filtered Results' },
  { value: 'expiring_missing', label: 'Expiring And Missing Only' },
];

/**
 * Export Document Index.
 *
 * Formats are CSV and PDF only: the Excel writer was removed from this repository
 * for a flagged transitive dependency, and offering a format the backend refuses
 * would be a control that lies. The reference's "Date Display" choice is absent
 * for the same reason — the renderer has one date format.
 */
export function ExportIndexDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }): VNode {
  const [scope, setScope] = useState<DocumentIndexScope>('all_authorised');
  const [format, setFormat] = useState<EmployeeExportFormat>('csv');
  const [running, setRunning] = useState(false);

  async function run(): Promise<void> {
    setRunning(true);
    try {
      const outcome = await exportDocumentIndex(employeeId, format, scope);
      toast.success(`${outcome.fileName} exported · ${outcome.rowCount} rows.`);
      onClose();
    } catch (error) { fail(error, 'The document index export failed.'); }
    finally { setRunning(false); }
  }

  return (
    <DialogShell
      labelledBy="export-index-title" icon="download"
      title="Export Document Index" subtitle="Create a controlled inventory of this employee’s document records."
      onClose={onClose}
      foot={
        <>
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button primary" type="button" disabled={running} onClick={() => void run()}>
            <PageIcon id="download" />{running ? 'Generating…' : 'Generate Export'}
          </button>
        </>
      }
    >
      <div class="dialog-body">
        <Note icon="info" tone="info">
          <strong>Index Only</strong><br />
          The export lists document metadata and status. Protected document files are not included.
        </Note>
        <div class="form-grid">
          <Field id="export-scope" label="Document Scope" full>
            <select id="export-scope" value={scope} onChange={event => setScope(event.currentTarget.value as DocumentIndexScope)}>
              {DOCUMENT_SCOPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field id="export-format" label="File Format" full>
            <select id="export-format" value={format} onChange={event => setFormat(event.currentTarget.value as EmployeeExportFormat)}>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}

// ── 7. Request employee change ──────────────────────────────────────────────

const CHANGE_TYPES = [
  { value: 'department_transfer',    label: 'Department Transfer' },
  { value: 'site_transfer',          label: 'Work Location Transfer' },
  { value: 'supervisor_change',      label: 'Reporting Line Change' },
  { value: 'employment_type_change', label: 'Employment Basis Change' },
  { value: 'status_change',          label: 'Employment Status Change' },
];

const HR_STATUSES = ['draft', 'pending_onboarding', 'active', 'probation', 'on_leave', 'suspended', 'inactive', 'terminated', 'archived'];

/**
 * Request Employee Change → `hr/employees/change-request` (the maker side of
 * maker-checker).
 *
 * The reference offers free-text "record areas"; production offers the change
 * TYPES the approval engine can actually apply, each with a picker for its value,
 * so an approved request has an unambiguous value to apply.
 */
export function RequestChangeDialog({ employeeId, shell, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; onClose: () => void;
}): VNode {
  const [changeType, setChangeType] = useState('department_transfer');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const departments = useHrOrgUnits();
  const sites = useHrSites();
  const supervisors = useHrEmployees({ limit: 500 });
  const mutation = useCreateHrChangeRequest();

  const options: { id: string; name: string }[] =
    changeType === 'department_transfer' ? (departments.data ?? []).map(row => ({ id: row.id, name: row.name }))
      : changeType === 'site_transfer' ? (sites.data ?? []).map(row => ({ id: row.id, name: row.name }))
        : changeType === 'supervisor_change' ? (supervisors.data ?? [])
          .filter(row => row.id !== employeeId)
          .map(row => ({ id: row.id, name: row.full_name ?? row.username }))
          : changeType === 'employment_type_change' ? EMPLOYMENT_TYPES.map(row => ({ id: row, name: titleCase(row) }))
            : HR_STATUSES.map(row => ({ id: row, name: titleCase(row) }));

  function requestedValue(): Record<string, unknown> {
    switch (changeType) {
      case 'department_transfer':    return { departmentId: value };
      case 'site_transfer':          return { siteId: value };
      case 'supervisor_change':      return { supervisorId: value };
      case 'employment_type_change': return { employmentType: value };
      default:                       return { status: value };
    }
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!value) next.value = 'Select the value you are requesting.';
    if (reason.trim().length < 10) next.reason = 'Explain the business reason in at least 10 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const result = await mutation.mutateAsync({
        employeeId, changeType, requestedValue: requestedValue(), reason: reason.trim(),
      });
      toast.success(`Change request ${result.data.change_no} submitted for approval.`);
      onClose();
    } catch (error) { fail(error, 'The change request could not be submitted.'); }
  }

  return (
    <DialogShell
      variant="request-change-dialog" labelledBy="request-change-title" icon="message"
      title="Request Employee Change" subtitle="Submit a proposed record update for authorised review and approval."
      onClose={onClose}
    >
      <form onSubmit={event => void submit(event)}>
        <div class="dialog-body">
          <RequestContext shell={shell} routeLabel="Workflow Route" routeValue="Employee Record Change Review" />
          <Note icon="info" tone="info">
            <strong>Approval Required</strong><br />
            Your proposed value will not change the employee record until an authorised reviewer approves the request.
            The submission, decision, and final update are retained in the audit trail.
          </Note>
          <div class="form-grid">
            <Field id="change-area" label="Requested Change">
              <select
                id="change-area" value={changeType}
                onChange={event => { setChangeType(event.currentTarget.value); setValue(''); }}
              >
                {CHANGE_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field id="change-value" label="Requested Value" error={errors.value}>
              <select id="change-value" value={value} onChange={event => setValue(event.currentTarget.value)}>
                <option value="">Select A Value</option>
                {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </Field>
            <Field id="change-reason" label="Business Reason" full error={errors.reason}>
              <textarea
                id="change-reason" maxLength={500} value={reason}
                placeholder="Explain why this change is required."
                onInput={event => setReason(event.currentTarget.value)}
              />
            </Field>
          </div>
          <RequestFlow label="Request approval flow" steps={[
            ['Submit', 'Request and reason recorded'],
            ['Review', 'Authorised owner verifies evidence'],
            ['Apply', 'Approved change updates the record'],
          ]} />
        </div>
        <div class="dialog-foot">
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button primary" type="submit" disabled={mutation.isPending}>
            <PageIcon id="message" />{mutation.isPending ? 'Submitting…' : 'Submit For Approval'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── 8. Record change (audit detail) ─────────────────────────────────────────

/** Render one audit snapshot as a compact, readable value. */
function snapshotText(snapshot: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!snapshot) return DASH;
  const parts = keys
    .filter(key => snapshot[key] !== undefined && snapshot[key] !== null)
    .map(key => `${titleCase(key)}: ${String(snapshot[key])}`);
  return parts.length ? parts.join(' · ') : DASH;
}

/**
 * Record Change — the read-only detail behind **View Change**.
 *
 * Before/After come from the audit row's OWN `previous_state` / `new_state`
 * snapshots. When a row carries no snapshot the panel says so; it does not
 * reconstruct a diff the audit trail never recorded.
 */
export function ActivityChangeDialog({ entry, onClose }: { entry: HrAuditEntry; onClose: () => void }): VNode {
  const changedKeys = useMemo(() => {
    const before = entry.previous_state ?? {};
    const after = entry.new_state ?? {};
    return [...new Set([...Object.keys(after), ...Object.keys(before)])]
      .filter(key => key !== 'updated_at' && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  }, [entry]);

  const hasSnapshot = !!entry.previous_state || !!entry.new_state;

  return (
    <DialogShell
      variant="audit-detail-dialog" labelledBy="activity-change-title" icon="clock"
      title="Record Change" subtitle="Authorised employee-record activity with protected values masked where required."
      onClose={onClose}
      foot={<button class="button" type="button" onClick={onClose}>Close</button>}
    >
      <div class="dialog-body">
        <div class="audit-detail-hero">
          <span class="dialog-heading-icon"><PageIcon id="edit" /></span>
          <div><h3>{activityTitle(entry.action)}</h3><p>{titleCase(entry.submodule_key ?? 'employee record')}</p></div>
          <span class="badge">Recorded</span>
        </div>
        <div class="audit-change-layout">
          <section class="audit-change-card">
            <div class="audit-change-card-title">Recorded Change</div>
            {hasSnapshot && changedKeys.length > 0 ? (
              <div class="change-comparison" aria-label="Previous and new values">
                <div class="change-value"><span>Before</span><strong>{snapshotText(entry.previous_state, changedKeys)}</strong></div>
                <div class="change-value"><span>After</span><strong>{snapshotText(entry.new_state, changedKeys)}</strong></div>
              </div>
            ) : (
              <div class="epf-empty">
                This entry was recorded without a value snapshot, so no before-and-after comparison exists for it.
              </div>
            )}
            <div class="audit-reason"><span>Reason</span><strong>{entry.reason ?? 'No reason was recorded.'}</strong></div>
          </section>
          <div class="audit-meta-grid">
            <div><span>Changed By</span><strong>{entry.actorName ?? 'System'}</strong></div>
            <div><span>Area</span><strong>{titleCase(entry.submodule_key ?? 'employee record')}</strong></div>
            <div><span>Recorded</span><strong>{formatDateTime(entry.created_at)}</strong></div>
            <div><span>Action</span><strong>{entry.action}</strong></div>
            <div><span>Related Record</span><strong>{entry.record_id ?? DASH}</strong></div>
            <div><span>Audit Reference</span><strong>{entry.id.slice(0, 8)}</strong></div>
          </div>
        </div>
        <div class="approval-note info-note" style="margin-top:14px">
          <PageIcon id="lock" />
          <span><strong>Protected Audit Information</strong><br />
            Sensitive values remain masked unless the reviewer has the separate permission required to inspect them.</span>
        </div>
      </div>
    </DialogShell>
  );
}

// ── 9. Export audit history ─────────────────────────────────────────────────

const AUDIT_AREAS = [
  { value: '', label: 'All Authorised Activity' },
  { value: 'employees', label: 'Employment Only' },
  { value: 'documents', label: 'Documents' },
  { value: 'readiness', label: 'Readiness' },
  { value: 'access_assignments', label: 'Account And Access' },
];

/**
 * Export Audit History.
 *
 * The business reason is mandatory because the backend refuses without one, and
 * generating the export is itself audited. There is deliberately no one-click
 * path to extracting an employee's audit trail.
 */
export function ExportAuditDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }): VNode {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [area, setArea] = useState('');
  const [format, setFormat] = useState<EmployeeExportFormat>('csv');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  async function run(): Promise<void> {
    const next: Record<string, string> = {};
    if (reason.trim().length < 8) next.reason = 'State why this audit history is required (at least 8 characters).';
    if (dateFrom && dateTo && dateTo < dateFrom) next.dateTo = 'The end date cannot precede the start date.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setRunning(true);
    try {
      const outcome = await exportAuditHistory(employeeId, format, {
        dateFrom: orNull(dateFrom), dateTo: orNull(dateTo), area: orNull(area), reason: reason.trim(),
      });
      toast.success(`${outcome.fileName} exported · ${outcome.rowCount} rows.`);
      onClose();
    } catch (error) { fail(error, 'The audit export failed.'); }
    finally { setRunning(false); }
  }

  return (
    <DialogShell
      variant="export-audit-dialog" labelledBy="export-audit-title" icon="download"
      title="Export Audit History" subtitle="Create a controlled export of authorised employee-record activity."
      onClose={onClose}
      foot={
        <>
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button primary" type="button" disabled={running} onClick={() => void run()}>
            <PageIcon id="download" />{running ? 'Generating…' : 'Generate Audit Export'}
          </button>
        </>
      }
    >
      <div class="dialog-body">
        <Note icon="shield" tone="info">
          <strong>Protected Audit Export</strong><br />
          The export respects your current capabilities. Sensitive values remain masked unless separately authorised,
          and generating the export is itself recorded.
        </Note>
        <div class="form-grid">
          <Field id="audit-export-from" label="From">
            <input id="audit-export-from" type="date" value={dateFrom} onInput={event => setDateFrom(event.currentTarget.value)} />
          </Field>
          <Field id="audit-export-to" label="To" error={errors.dateTo}>
            <input id="audit-export-to" type="date" value={dateTo} onInput={event => setDateTo(event.currentTarget.value)} />
          </Field>
          <Field id="audit-export-format" label="File Format">
            <select id="audit-export-format" value={format} onChange={event => setFormat(event.currentTarget.value as EmployeeExportFormat)}>
              <option value="csv">CSV Data Export</option>
              <option value="pdf">PDF Audit Report</option>
            </select>
          </Field>
          <Field id="audit-export-area" label="Activity Areas">
            <select id="audit-export-area" value={area} onChange={event => setArea(event.currentTarget.value)}>
              {AUDIT_AREAS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field id="audit-export-reason" label="Business Reason" full error={errors.reason}>
            <textarea
              id="audit-export-reason" maxLength={500} value={reason}
              placeholder="Explain why this employee audit history is required."
              onInput={event => setReason(event.currentTarget.value)}
            />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}

// ── 10. Start offboarding ───────────────────────────────────────────────────

const OFFBOARDING_REASONS: OffboardingReason[] = [
  'resignation', 'retirement', 'end_of_contract', 'redundancy', 'termination',
];

/**
 * Start Employee Offboarding → `hr/offboarding/start`.
 *
 * Creating the case does NOT end employment: the route opens the governed case,
 * schedules its tasks and raises the access-removal handoff. Status changes only
 * through the case's own workflow.
 */
export function StartOffboardingDialog({ employeeId, shell, onClose }: {
  employeeId: string; shell: EmployeeProfileShell; onClose: () => void;
}): VNode {
  const [reason, setReason] = useState<OffboardingReason | ''>('');
  const [lastDay, setLastDay] = useState('');
  const [noticeDays, setNoticeDays] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const owners = useHrEmployees({ limit: 500 });
  const mutation = useOffboardingMutation(hrOffboardingApi.start);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!reason) next.reason = 'Select the offboarding reason.';
    if (!lastDay) next.lastDay = 'Record the last working day.';
    else if (shell.employment.startDate && lastDay < shell.employment.startDate.slice(0, 10)) {
      next.lastDay = 'The last working day cannot precede the start of employment.';
    }
    if (noticeDays.trim()) {
      const value = Number(noticeDays);
      if (!Number.isInteger(value) || value < 0 || value > 365) next.noticeDays = 'Enter a whole number of days between 0 and 365.';
    }
    setErrors(next);
    if (Object.keys(next).length || !reason) return;
    try {
      const result = await mutation.mutateAsync({
        employeeId, reason,
        lastWorkingDay: lastDay,
        noticePeriodDays: noticeDays.trim() ? Number(noticeDays) : null,
        ownerId: orNull(ownerId),
      });
      toast.success(`Offboarding case ${result.caseNo} created · ${result.taskCount} tasks · ${result.handoffCount} handoffs.`);
      onClose();
    } catch (error) { fail(error, 'The offboarding case could not be created.'); }
  }

  return (
    <DialogShell
      variant="offboarding-dialog" labelledBy="start-offboarding-title" icon="exit"
      title="Start Employee Offboarding"
      subtitle="Create a governed case and coordinate the employee’s final working arrangements."
      onClose={onClose}
    >
      <form onSubmit={event => void submit(event)}>
        <div class="dialog-body">
          <Note icon="info" tone="info">
            <strong>This Does Not Immediately End Employment</strong><br />
            Submitting creates an offboarding case, assigns accountable work, and records the request. Employment status
            changes only through the authorised workflow.
          </Note>
          <div class="offboarding-impact">
            <div><span>Employee</span><strong>{shell.identity.displayName}</strong></div>
            <div><span>Current Status</span><strong>{titleCase(shell.identity.employmentStatus)}</strong></div>
            <div><span>Case Owner</span><strong>{ownerId ? 'Selected Below' : 'Defaults To You'}</strong></div>
          </div>
          <div class="form-grid">
            <Field id="offboarding-reason" label="Offboarding Reason" error={errors.reason}>
              <select
                id="offboarding-reason" value={reason} required
                onChange={event => setReason(event.currentTarget.value as OffboardingReason)}
              >
                <option value="">Select Reason</option>
                {OFFBOARDING_REASONS.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
              </select>
            </Field>
            <Field id="offboarding-last-day" label="Last Working Day" error={errors.lastDay}>
              <input id="offboarding-last-day" type="date" required value={lastDay} onInput={event => setLastDay(event.currentTarget.value)} />
            </Field>
            <Field id="offboarding-notice" label="Notice Period (Days)" error={errors.noticeDays}>
              <input
                id="offboarding-notice" type="number" min="0" max="365" step="1"
                value={noticeDays} onInput={event => setNoticeDays(event.currentTarget.value)}
              />
            </Field>
            <Field id="offboarding-owner" label="Case Owner">
              <select id="offboarding-owner" value={ownerId} onChange={event => setOwnerId(event.currentTarget.value)}>
                <option value="">Defaults To You</option>
                {(owners.data ?? [])
                  .filter(option => option.id !== employeeId)
                  .map(option => <option key={option.id} value={option.id}>{option.full_name ?? option.username}</option>)}
              </select>
            </Field>
          </div>
          <RequestFlow label="Offboarding case flow" steps={[
            ['Create Case', 'Reason, dates and owner recorded'],
            ['Assign Work', 'HR, payroll and department tasks created'],
            ['Secure Access', 'Account action routed to support owner'],
          ]} />
        </div>
        <div class="dialog-foot">
          <button class="button" type="button" onClick={onClose}>Cancel</button>
          <button class="button danger" type="submit" disabled={mutation.isPending}>
            <PageIcon id="exit" />{mutation.isPending ? 'Creating…' : 'Create Offboarding Case'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
