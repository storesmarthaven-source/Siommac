/**
 * DepartmentModal.tsx
 *
 * Add / Edit department modal.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                       from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { Modal }                             from '@shared/Modal';
import { Spinner }                           from '@shared/Spinner';
import type { Department }                   from './types';
import { useManagerList, useAddDepartment, useUpdateDepartment } from './hooks';

interface DepartmentModalProps {
  open:        boolean;
  department?: Department | null;   // null = add mode, non-null = edit mode
  onClose:     () => void;
}

interface FormState {
  name:      string;
  managerId: string;
}

export function DepartmentModal({ open, department, onClose }: DepartmentModalProps): VNode {
  const mode = department ? 'edit' : 'add';
  const [form,   setForm]   = useState<FormState>({ name: '', managerId: '' });
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const { data: managers = [], isLoading: mgrsLoading } = useManagerList();
  const addMutation    = useAddDepartment();
  const updateMutation = useUpdateDepartment();
  const isSubmitting   = addMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (department) {
      setForm({ name: department.name, managerId: department.managerId });
    } else {
      setForm({ name: '', managerId: '' });
    }
  }, [open, department]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  }, []);

  const handleSubmit = useCallback(async () => {
    const errs: Partial<FormState> = {};
    if (!form.name.trim()) errs.name = 'Department name is required.';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    if (mode === 'add') {
      await addMutation.mutateAsync({ name: form.name.trim(), managerId: form.managerId || undefined });
    } else if (department) {
      await updateMutation.mutateAsync({ id: department.id, name: form.name.trim(), managerId: form.managerId || undefined });
    }
    onClose();
  }, [form, mode, department, addMutation, updateMutation, onClose]);

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={isSubmitting} style={cancelBtnStyle}>
        Cancel
      </button>
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={isSubmitting}
        style={submitBtnStyle(isSubmitting)}
      >
        {isSubmitting
          ? <Spinner size={14} color="#fff" label="Saving…" />
          : (mode === 'add' ? 'Add Department' : 'Save Changes')
        }
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'add' ? 'Add Department' : 'Edit Department'}
      size="sm"
      footer={footer}
      closeOnBackdrop={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={labelStyle(!!errors.name)}>
            Department Name <span style={{ color: '#dc2626' }} aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onInput={e => set('name', (e.target as HTMLInputElement).value)}
            disabled={isSubmitting}
            placeholder="e.g. Engineering"
            style={inputStyle(!!errors.name)}
            aria-required="true"
          />
          {errors.name && <div role="alert" style={errorStyle}>{errors.name}</div>}
        </div>

        <div>
          <label style={labelStyle(false)}>Department Manager</label>
          {mgrsLoading ? (
            <div style={{ ...inputStyle(false), display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af' }}>
              <Spinner size={14} /> Loading managers…
            </div>
          ) : (
            <select
              value={form.managerId}
              onChange={e => set('managerId', (e.target as HTMLSelectElement).value)}
              disabled={isSubmitting}
              style={inputStyle(false)}
            >
              <option value="">— No Manager —</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
}

const labelStyle = (hasError: boolean): Record<string, string> => ({
  display:      'block',
  fontSize:     '12px',
  fontWeight:   '500',
  color:        hasError ? '#dc2626' : '#374151',
  marginBottom: '4px',
});

const inputStyle = (hasError: boolean): Record<string, string> => ({
  width:        '100%',
  padding:      '8px 12px',
  fontSize:     '13px',
  border:       `1px solid ${hasError ? '#dc2626' : '#d1d5db'}`,
  borderRadius: '6px',
  color:        '#111827',
  background:   '#fff',
  boxSizing:    'border-box',
});

const errorStyle: Record<string, string> = {
  fontSize:  '11px',
  color:     '#dc2626',
  marginTop: '3px',
};

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

const submitBtnStyle = (loading: boolean): Record<string, string> => ({
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            '6px',
  padding:        '8px 20px',
  background:     loading ? '#9ca3af' : '#2563eb',
  color:          '#fff',
  border:         'none',
  borderRadius:   '6px',
  cursor:         loading ? 'not-allowed' : 'pointer',
  fontSize:       '14px',
  fontWeight:     '500',
  minWidth:       '130px',
});
