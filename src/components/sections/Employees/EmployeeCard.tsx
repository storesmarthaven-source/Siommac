/**
 * EmployeeCard.tsx
 *
 * Single employee card for the card-grid view.
 * Uses the branded `.emp-card*` design system defined in the section CSS
 * (navy header, avatar, employee-ID pill, detail rows, today badge) rather
 * than ad-hoc inline styles, so the card matches the Siomac design spec.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }    from 'preact';
import { Avatar }        from '@shared/Avatar';
import type { EmployeeListItem, UserRole } from './types';
import { TODAY_STATUS_LABEL } from './utils';

interface EmployeeCardProps {
  emp:       EmployeeListItem;
  isAdmin:   boolean;
  onClick:   (emp: EmployeeListItem) => void;
  onEdit:    (emp: EmployeeListItem) => void;
  onDelete:  (emp: EmployeeListItem) => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin:      'Admin',
  manager:    'Manager',
  employee:   'Employee',
};

/** Maps the today-status enum to the branded badge class. */
const TODAY_BADGE_CLASS: Record<EmployeeListItem['todayStatus'], string> = {
  checkedin:  'emp-today-in',
  checkedout: 'emp-today-out',
  notchecked: 'emp-today-no',
};

export function EmployeeCard({ emp, isAdmin, onClick, onEdit, onDelete }: EmployeeCardProps): VNode {
  const isActive   = emp.status === 'Active';
  const headerMod  = isActive ? 'emp-card-header--active' : 'emp-card-header--inactive';
  const todayLabel = TODAY_STATUS_LABEL[emp.todayStatus];
  const todayClass = TODAY_BADGE_CLASS[emp.todayStatus];

  return (
    <div
      class="emp-card"
      role="button"
      tabIndex={0}
      aria-label={`View profile for ${emp.fullName}`}
      onClick={() => onClick(emp)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(emp); }}
    >
      {/* Header — navy for active, grey gradient for inactive */}
      <div class={`emp-card-header ${headerMod}`}>
        <div class="emp-card-avatar">
          <Avatar src={emp.profileImage} name={emp.fullName} size={46} />
        </div>
        <div class="emp-card-title-block">
          <div class="emp-card-name">{emp.fullName}</div>
          <div class="emp-card-pos">{emp.position || '—'}</div>
        </div>
        {emp.employeeNumber && (
          <span class="emp-card-empid">{emp.employeeNumber}</span>
        )}

        {/* Admin action overlay — edit / delete */}
        {isAdmin && (
          <div
            class="card-overlay-actions"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              class="card-overlay-btn edit"
              aria-label={`Edit ${emp.fullName}`}
              onClick={() => onEdit(emp)}
              title="Edit employee"
            >
              <i class="fas fa-pencil-alt" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="card-overlay-btn delete"
              aria-label={`Delete ${emp.fullName}`}
              onClick={() => onDelete(emp)}
              title="Delete employee"
            >
              <i class="fas fa-trash" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Body — detail rows + today badge */}
      <div class="emp-card-body">
        <div class="emp-detail-row">
          <i class="fas fa-building" aria-hidden="true" />
          <span>{emp.department || '—'}</span>
        </div>
        <div class="emp-detail-row">
          <i class="fas fa-user-tag" aria-hidden="true" />
          <span>{ROLE_LABEL[emp.role]}</span>
        </div>
        <div class="emp-detail-row">
          <i class="fas fa-at" aria-hidden="true" />
          <span class="emp-username">{emp.username}</span>
        </div>

        <div class="emp-today-row">
          <span class={`emp-today-badge ${todayClass}`}>{todayLabel}</span>
        </div>
      </div>
    </div>
  );
}
