/**
 * EmployeeModal.tsx
 *
 * Add / Edit employee modal.
 *
 * Used for both add and edit flows:
 *   - mode="add":  blank form, submits addEmployee mutation
 *   - mode="edit": pre-filled form, submits updateEmployee mutation
 *
 * Enterprise features:
 *   ✓ Full form validation with inline error messages
 *   ✓ Photo picker: upload or remove (base64 conversion before submit)
 *   ✓ Payroll fields section (pay cycle, basis, rates, statutory deductions)
 *   ✓ Password field optional on edit (leave blank = no change)
 *   ✓ All department and role options populated from live API data
 *   ✓ Loading states prevent double-submit
 *   ✓ Accessible labels and ARIA
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState, useCallback, useEffect }   from 'preact/hooks';
import { Modal }                             from '@shared/Modal';
import { Spinner }                           from '@shared/Spinner';
import { Avatar }                            from '@shared/Avatar';
import type {
  EmployeeListItem,
  EmployeeDetail,
  AddEmployeePayload,
  UpdateEmployeePayload,
  UserRole,
  UserStatus,
  PayCycle,
  PayBasis,
  Department,
} from './types';
import { fileToBase64 } from './utils';
import { useAddEmployee, useUpdateEmployee, useDepartmentList, useAssignableRoles } from './hooks';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'add' | 'edit';

interface EmployeeModalProps {
  mode:      Mode;
  /** Provide for edit mode — the detail view of the employee to edit */
  employee?: EmployeeDetail | null;
  /** Pass the list item for edit mode when detail isn't loaded yet */
  listItem?: EmployeeListItem | null;
  open:      boolean;
  onClose:   () => void;
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  username:                    string;
  password:                    string;
  fullName:                    string;
  role:                        UserRole;
  department:                  string;
  position:                    string;
  employeeNumber:              string;
  status:                      UserStatus;
  email:                       string;
  phone:                       string;
  payCycle:                    PayCycle;
  payBasis:                    PayBasis;
  hourlyRate:                  string;
  monthlySalary:               string;
  standardHoursPerDay:         string;
  nisApplicable:               boolean;
  healthSurchargeApplicable:   boolean;
  taxResident:                 boolean;
}

const DEFAULT_FORM: FormState = {
  username:                  '',
  password:                  '',
  fullName:                  '',
  role:                      'employee',
  department:                '',
  position:                  '',
  employeeNumber:            '',
  status:                    'active',
  email:                     '',
  phone:                     '',
  payCycle:                  'monthly',
  payBasis:                  'salary',
  hourlyRate:                '0',
  monthlySalary:             '0',
  standardHoursPerDay:       '8',
  nisApplicable:             true,
  healthSurchargeApplicable: true,
  taxResident:               true,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeeModal({ mode, employee, listItem, open, onClose }: EmployeeModalProps): VNode {
  const [form,          setForm]          = useState<FormState>(DEFAULT_FORM);
  const [errors,        setErrors]        = useState<Partial<Record<keyof FormState, string>>>({});
  const [photoBase64,   setPhotoBase64]   = useState<string | null>(null);
  const [photoPreview,  setPhotoPreview]  = useState<string>('');
  const [removePhoto,   setRemovePhoto]   = useState(false);

  const { data: departments = [], isLoading: deptsLoading } = useDepartmentList();
  const { data: roles = [] } = useAssignableRoles();
  const addMutation    = useAddEmployee();
  const updateMutation = useUpdateEmployee();

  const isSubmitting = addMutation.isPending || updateMutation.isPending;

  // Populate form when opening in edit mode
  useEffect(() => {
    if (!open) return;
    if (mode === 'add') {
      setForm(DEFAULT_FORM);
      setErrors({});
      setPhotoBase64(null);
      setPhotoPreview('');
      setRemovePhoto(false);
      return;
    }
    if (employee) {
      setForm({
        username:                  employee.username,
        password:                  '',
        fullName:                  employee.fullName,
        role:                      employee.role,
        department:                employee.departmentId,
        position:                  employee.position,
        employeeNumber:            employee.employeeNumber,
        status:                    employee.status,
        email:                     employee.email,
        phone:                     employee.phone,
        payCycle:                  employee.payCycle,
        payBasis:                  employee.payBasis,
        hourlyRate:                String(employee.hourlyRate),
        monthlySalary:             String(employee.monthlySalary),
        standardHoursPerDay:       String(employee.standardHoursPerDay),
        nisApplicable:             employee.nisApplicable,
        healthSurchargeApplicable: employee.healthSurchargeApplicable,
        taxResident:               employee.taxResident,
      });
      setPhotoPreview(employee.profileImage || '');
      setPhotoBase64(null);
      setRemovePhoto(false);
      setErrors({});
    }
  }, [open, mode, employee]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  }, []);

  // ── Photo picker ──────────────────────────────────────────────────────────

  const handlePhotoChange = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const b64 = await fileToBase64(file);
      setPhotoBase64(b64);
      setPhotoPreview(URL.createObjectURL(file));
      setRemovePhoto(false);
    } catch {
      // silently ignore — user can try again
    }
  }, []);

  const handleRemovePhoto = useCallback(() => {
    setPhotoBase64(null);
    setPhotoPreview('');
    setRemovePhoto(true);
  }, []);

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};

    if (!form.fullName.trim())                            errs.fullName = 'Full name is required.';
    if (mode === 'add' && !form.username.trim())          errs.username = 'Username is required.';
    if (mode === 'add' && form.username.trim().length < 3) errs.username = 'Username must be at least 3 characters.';
    if (mode === 'add' && !form.password)                  errs.password = 'Password is required.';
    if (mode === 'add' && form.password.length < 6)        errs.password = 'Password must be at least 6 characters.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address.';
    if (isNaN(Number(form.hourlyRate)) || Number(form.hourlyRate) < 0) errs.hourlyRate = 'Must be a non-negative number.';
    if (isNaN(Number(form.monthlySalary)) || Number(form.monthlySalary) < 0) errs.monthlySalary = 'Must be a non-negative number.';
    if (isNaN(Number(form.standardHoursPerDay)) || Number(form.standardHoursPerDay) < 1 || Number(form.standardHoursPerDay) > 24) errs.standardHoursPerDay = 'Must be between 1 and 24.';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;

    if (mode === 'add') {
      const payload: AddEmployeePayload = {
        username:                  form.username.trim(),
        password:                  form.password,
        fullName:                  form.fullName.trim(),
        role:                      form.role,
        department:                form.department || undefined,
        position:                  form.position.trim() || undefined,
        employeeNumber:            form.employeeNumber.trim() || undefined,
        email:                     form.email.trim() || undefined,
        phone:                     form.phone.trim() || undefined,
        payCycle:                  form.payCycle,
        payBasis:                  form.payBasis,
        hourlyRate:                Number(form.hourlyRate),
        monthlySalary:             Number(form.monthlySalary),
        standardHoursPerDay:       Number(form.standardHoursPerDay),
        nisApplicable:             form.nisApplicable,
        healthSurchargeApplicable: form.healthSurchargeApplicable,
        taxResident:               form.taxResident,
      };
      await addMutation.mutateAsync(payload);
      onClose();
      return;
    }

    // Edit mode
    const username = employee?.username ?? listItem?.username ?? '';
    if (!username) return;

    const payload: UpdateEmployeePayload = {
      username,
      fullName:                  form.fullName.trim(),
      role:                      form.role,
      department:                form.department || undefined,
      position:                  form.position.trim() || undefined,
      status:                    form.status,
      employeeNumber:            form.employeeNumber.trim() || undefined,
      email:                     form.email.trim() || undefined,
      phone:                     form.phone.trim() || undefined,
      password:                  form.password || undefined,
      payCycle:                  form.payCycle,
      payBasis:                  form.payBasis,
      hourlyRate:                Number(form.hourlyRate),
      monthlySalary:             Number(form.monthlySalary),
      standardHoursPerDay:       Number(form.standardHoursPerDay),
      nisApplicable:             form.nisApplicable,
      healthSurchargeApplicable: form.healthSurchargeApplicable,
      taxResident:               form.taxResident,
    };

    if (photoBase64)   payload.profileImageBase64  = photoBase64;
    if (removePhoto)   payload.removeProfileImage  = true;

    await updateMutation.mutateAsync(payload);
    onClose();
  }, [form, mode, employee, listItem, photoBase64, removePhoto, addMutation, updateMutation, onClose]);

  // ── Render ────────────────────────────────────────────────────────────────

  const title   = mode === 'add' ? 'Add Employee' : 'Edit Employee';
  const btnLabel = mode === 'add' ? 'Add Employee' : 'Save Changes';

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={isSubmitting}
        style={cancelBtnStyle}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => { void handleSubmit(); }}
        disabled={isSubmitting}
        style={submitBtnStyle(isSubmitting)}
      >
        {isSubmitting
          ? <Spinner size={14} color="#fff" label="Saving…" />
          : <><i class="fas fa-save" aria-hidden="true" style={{ marginRight: '6px' }} />{btnLabel}</>
        }
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={footer}
      closeOnBackdrop={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── Basic info ── */}
        <Section title="Basic Information">
          <Row>
            <Field label="Full Name" required error={errors.fullName}>
              <input
                type="text"
                value={form.fullName}
                onInput={e => set('fullName', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder="Jane Doe"
                style={inputStyle(!!errors.fullName)}
                aria-required="true"
              />
            </Field>
            {mode === 'add' ? (
              <Field label="Username" required error={errors.username}>
                <input
                  type="text"
                  value={form.username}
                  onInput={e => set('username', (e.target as HTMLInputElement).value)}
                  disabled={isSubmitting}
                  placeholder="jane.doe"
                  style={inputStyle(!!errors.username)}
                  aria-required="true"
                  autoComplete="off"
                />
              </Field>
            ) : (
              <Field label="Username">
                <input
                  type="text"
                  value={form.username}
                  disabled
                  style={{ ...inputStyle(false), background: '#f9fafb', color: '#6b7280' }}
                />
              </Field>
            )}
          </Row>

          <Row>
            <Field label="Employee ID" hint="Leave blank to auto-assign">
              <input
                type="text"
                value={form.employeeNumber}
                onInput={e => set('employeeNumber', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder="EMP-0001"
                style={inputStyle(false)}
              />
            </Field>
            <Field label="Position">
              <input
                type="text"
                value={form.position}
                onInput={e => set('position', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder="Software Engineer"
                style={inputStyle(false)}
              />
            </Field>
          </Row>

          <Row>
            <Field label="Role" required>
              <select
                value={form.role}
                onChange={e => set('role', (e.target as HTMLSelectElement).value as UserRole)}
                disabled={isSubmitting}
                style={inputStyle(false)}
              >
                {roles.length === 0
                  ? <option value={form.role}>{form.role}</option>
                  : roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Department">
              {deptsLoading ? (
                <div style={{ ...inputStyle(false), display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af' }}>
                  <Spinner size={14} /> Loading…
                </div>
              ) : (
                <select
                  value={form.department}
                  onChange={e => set('department', (e.target as HTMLSelectElement).value)}
                  disabled={isSubmitting}
                  style={inputStyle(false)}
                >
                  <option value="">— No Department —</option>
                  {(departments as Department[]).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}
            </Field>
          </Row>

          {mode === 'edit' ? (
            <Row>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={e => set('status', (e.target as HTMLSelectElement).value as UserStatus)}
                  disabled={isSubmitting}
                  style={inputStyle(false)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <div style={{ flex: 1 }} />
            </Row>
          ) : null}
        </Section>

        {/* ── Contact ── */}
        <Section title="Contact">
          <Row>
            <Field label="Email" error={errors.email}>
              <input
                type="email"
                value={form.email}
                onInput={e => set('email', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder="jane@example.com"
                style={inputStyle(!!errors.email)}
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={form.phone}
                onInput={e => set('phone', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder="+1 868 555 0100"
                style={inputStyle(false)}
              />
            </Field>
          </Row>
        </Section>

        {/* ── Password ── */}
        <Section title={mode === 'add' ? 'Password' : 'Change Password'}>
          <Row>
            <Field
              label={mode === 'add' ? 'Password' : 'New Password'}
              required={mode === 'add'}
              hint={mode === 'edit' ? 'Leave blank to keep current password' : undefined}
              error={errors.password}
            >
              <input
                type="password"
                value={form.password}
                onInput={e => set('password', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                placeholder={mode === 'edit' ? 'Leave blank to keep unchanged' : 'Min. 6 characters'}
                style={inputStyle(!!errors.password)}
                autoComplete="new-password"
              />
            </Field>
            <div style={{ flex: 1 }} />
          </Row>
        </Section>

        {/* ── Profile photo (edit only) ── */}
        {mode === 'edit' ? (
          <Section title="Profile Photo">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Avatar
                src={removePhoto ? '' : (photoPreview || '')}
                name={form.fullName}
                size={64}
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <label
                  style={{
                    ...outlineBtnStyle('#2563eb'),
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  <i class="fas fa-upload" aria-hidden="true" />
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    disabled={isSubmitting}
                    onChange={e => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      void handlePhotoChange(file);
                    }}
                  />
                </label>
                {(photoPreview || !removePhoto) && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    disabled={isSubmitting}
                    style={outlineBtnStyle('#dc2626')}
                  >
                    <i class="fas fa-trash" aria-hidden="true" />
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </Section>
        ) : null}

        {/* ── Payroll ── */}
        <Section title="Payroll">
          <Row>
            <Field label="Pay Cycle">
              <select
                value={form.payCycle}
                onChange={e => set('payCycle', (e.target as HTMLSelectElement).value as PayCycle)}
                disabled={isSubmitting}
                style={inputStyle(false)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
            <Field label="Pay Basis">
              <select
                value={form.payBasis}
                onChange={e => set('payBasis', (e.target as HTMLSelectElement).value as PayBasis)}
                disabled={isSubmitting}
                style={inputStyle(false)}
              >
                <option value="salary">Salary</option>
                <option value="hourly">Hourly</option>
              </select>
            </Field>
          </Row>

          <Row>
            {form.payBasis === 'hourly' ? (
              <Field label="Hourly Rate (TTD)" error={errors.hourlyRate}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hourlyRate}
                  onInput={e => set('hourlyRate', (e.target as HTMLInputElement).value)}
                  disabled={isSubmitting}
                  style={inputStyle(!!errors.hourlyRate)}
                />
              </Field>
            ) : (
              <Field label="Monthly Salary (TTD)" error={errors.monthlySalary}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlySalary}
                  onInput={e => set('monthlySalary', (e.target as HTMLInputElement).value)}
                  disabled={isSubmitting}
                  style={inputStyle(!!errors.monthlySalary)}
                />
              </Field>
            )}
            <Field label="Standard Hours / Day" error={errors.standardHoursPerDay}>
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={form.standardHoursPerDay}
                onInput={e => set('standardHoursPerDay', (e.target as HTMLInputElement).value)}
                disabled={isSubmitting}
                style={inputStyle(!!errors.standardHoursPerDay)}
              />
            </Field>
          </Row>

          {/* Statutory deductions */}
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '4px' }}>
            <CheckboxField
              label="NIS Applicable"
              checked={form.nisApplicable}
              onChange={v => set('nisApplicable', v)}
              disabled={isSubmitting}
            />
            <CheckboxField
              label="Health Surcharge Applicable"
              checked={form.healthSurchargeApplicable}
              onChange={v => set('healthSurchargeApplicable', v)}
              disabled={isSubmitting}
            />
            <CheckboxField
              label="Tax Resident"
              checked={form.taxResident}
              onChange={v => set('taxResident', v)}
              disabled={isSubmitting}
            />
          </div>
        </Section>

      </div>
    </Modal>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ComponentChildren }): VNode {
  return (
    <div>
      <div style={{
        fontSize:      '11px',
        fontWeight:    '700',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color:         '#6b7280',
        marginBottom:  '10px',
        paddingBottom: '6px',
        borderBottom:  '1px solid #f3f4f6',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: ComponentChildren }): VNode {
  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function Field({
  label, required, hint, error, children,
}: {
  label:     string;
  required?: boolean;
  hint?:     string;
  error?:    string;
  children:  ComponentChildren;
}): VNode {
  return (
    <div style={{ flex: '1 1 200px', minWidth: '0' }}>
      <label style={{
        display:      'block',
        fontSize:     '12px',
        fontWeight:   '500',
        color:        error ? '#dc2626' : '#374151',
        marginBottom: '4px',
      }}>
        {label}
        {required && <span style={{ color: '#dc2626', marginLeft: '2px' }} aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && (
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px' }}>{hint}</div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: '11px', color: '#dc2626', marginTop: '3px' }}>{error}</div>
      )}
    </div>
  );
}

function CheckboxField({
  label, checked, onChange, disabled,
}: {
  label:    string;
  checked:  boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}): VNode {
  return (
    <label style={{
      display:    'flex',
      alignItems: 'center',
      gap:        '6px',
      fontSize:   '13px',
      color:      '#374151',
      cursor:     disabled ? 'not-allowed' : 'pointer',
      userSelect: 'none',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange((e.target as HTMLInputElement).checked)}
        disabled={disabled}
        style={{ width: '15px', height: '15px', accentColor: '#2563eb' }}
      />
      {label}
    </label>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function inputStyle(hasError: boolean): Record<string, string> {
  return {
    width:        '100%',
    padding:      '8px 12px',
    fontSize:     '13px',
    border:       `1px solid ${hasError ? '#dc2626' : '#d1d5db'}`,
    borderRadius: '6px',
    outline:      'none',
    color:        '#111827',
    background:   '#fff',
    boxSizing:    'border-box',
  };
}

const cancelBtnStyle: Record<string, string> = {
  padding:      '8px 20px',
  background:   '#f3f4f6',
  color:        '#374151',
  border:       '1px solid #d1d5db',
  borderRadius: '6px',
  cursor:       'pointer',
  fontSize:     '14px',
  fontWeight:   '500',
};

function submitBtnStyle(loading: boolean): Record<string, string> {
  return {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '6px',
    padding:        '8px 20px',
    background:     loading ? '#9ca3af' : '#2563eb',
    color:          '#fff',
    border:         'none',
    borderRadius:   '6px',
    cursor:         loading ? 'not-allowed' : 'pointer',
    fontSize:       '14px',
    fontWeight:     '500',
    minWidth:       '120px',
    justifyContent: 'center',
  };
}

function outlineBtnStyle(color: string): Record<string, string | number> {
  return {
    display:      'inline-flex',
    alignItems:   'center',
    gap:          '6px',
    padding:      '6px 14px',
    background:   `${color}10`,
    color,
    border:       `1px solid ${color}40`,
    borderRadius: '6px',
    fontSize:     '13px',
    fontWeight:   '500',
    cursor:       'pointer',
  };
}
