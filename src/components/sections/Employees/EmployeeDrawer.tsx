/**
 * EmployeeDrawer.tsx
 *
 * Slide-in profile drawer shown when clicking an employee card or row.
 * Uses the branded `.emp-drawer*` design system (navy header, avatar with
 * status dot, sectioned detail rows, footer actions) defined in the section
 * CSS, rather than ad-hoc inline styles.
 *
 * Enterprise features:
 *   ✓ Keyboard accessible (Escape closes, focus moves into drawer)
 *   ✓ ARIA: role="dialog", aria-modal, aria-label
 *   ✓ Body scroll lock while open
 *   ✓ Displays all employee fields including today's check-in status
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }            from 'preact';
import { useEffect, useRef }     from 'preact/hooks';
import { Avatar }                from '@shared/Avatar';
import type { EmployeeListItem } from './types';
import { TODAY_STATUS_LABEL }    from './utils';

interface EmployeeDrawerProps {
  emp:      EmployeeListItem | null;
  isAdmin:  boolean;
  onClose:  () => void;
  onEdit:   (emp: EmployeeListItem) => void;
  onDelete: (emp: EmployeeListItem) => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

export function EmployeeDrawer({ emp, isAdmin, onClose, onEdit, onDelete }: EmployeeDrawerProps): VNode {
  const drawerRef = useRef<HTMLDivElement>(null);
  const open      = !!emp;

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus on open
  useEffect(() => {
    if (open) setTimeout(() => drawerRef.current?.focus(), 50);
  }, [open]);

  const isActive   = emp?.status === 'Active';
  const todayLabel = emp ? TODAY_STATUS_LABEL[emp.todayStatus] : '';

  return (
    <div
      class={`emp-drawer-overlay${open ? ' active' : ''}`}
      aria-hidden={open ? undefined : 'true'}
      onClick={onClose}
    >
      <div
        ref={drawerRef}
        class="emp-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={emp ? `${emp.fullName} profile` : 'Employee profile'}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        {emp && (
          <>
            {/* Header — navy with avatar, name, role pill */}
            <div class="emp-drawer-header">
              <div class="emp-drawer-avatar-wrap">
                <div class="emp-drawer-avatar">
                  <Avatar src={emp.profileImage} name={emp.fullName} size={72} />
                </div>
                <span class={`emp-drawer-status-dot ${isActive ? 'is-active' : 'is-inactive'}`} />
              </div>
              <div class="emp-drawer-title">
                <div class="emp-drawer-name">{emp.fullName}</div>
                <div class="emp-drawer-pos">{emp.position || '—'}</div>
                {emp.employeeNumber && (
                  <span class="emp-drawer-empid">{emp.employeeNumber}</span>
                )}
              </div>
              <button
                type="button"
                class="emp-drawer-close"
                onClick={onClose}
                aria-label="Close employee profile"
              >
                <i class="fas fa-times" aria-hidden="true" />
              </button>
            </div>

            {/* Body — detail rows */}
            <div class="emp-drawer-body">
              <div class="emp-drawer-section-label">Details</div>

              <div class="emp-drawer-row">
                <i class="fas fa-at" aria-hidden="true" />
                <span>{emp.username}</span>
              </div>
              <div class="emp-drawer-row">
                <i class="fas fa-building" aria-hidden="true" />
                <span>{emp.department || '—'}</span>
              </div>
              <div class="emp-drawer-row">
                <i class="fas fa-user-tag" aria-hidden="true" />
                <span>{ROLE_LABEL[emp.role] ?? emp.role}</span>
              </div>
              <div class={`emp-drawer-row${emp.email ? '' : ' muted'}`}>
                <i class="fas fa-envelope" aria-hidden="true" />
                <span>{emp.email || 'No email on file'}</span>
              </div>
              <div class={`emp-drawer-row${emp.phone ? '' : ' muted'}`}>
                <i class="fas fa-phone" aria-hidden="true" />
                <span>{emp.phone || 'No phone on file'}</span>
              </div>

              <div class="emp-drawer-section-label" style={{ marginTop: '20px' }}>Today</div>
              <div class="emp-drawer-row">
                <i class={`fas ${isActive ? 'fa-circle-check' : 'fa-circle'}`} aria-hidden="true" />
                <span>{todayLabel}</span>
              </div>
              <div class="emp-drawer-row">
                <i class="fas fa-signal" aria-hidden="true" />
                <span>{emp.status}</span>
              </div>
            </div>

            {/* Footer — admin actions */}
            {isAdmin && (
              <div class="emp-drawer-footer">
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  onClick={() => { onClose(); onEdit(emp); }}
                >
                  <i class="fas fa-pencil-alt" aria-hidden="true" /> Edit
                </button>
                <button
                  type="button"
                  class="btn btn-danger btn-sm"
                  onClick={() => { onClose(); onDelete(emp); }}
                >
                  <i class="fas fa-trash" aria-hidden="true" /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
