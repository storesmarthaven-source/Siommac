/**
 * EmployeeCard.tsx
 *
 * Single employee card for the card-grid view.
 * Mirrors the legacy _empCardRowHtml() DOM builder but as a proper component
 * with typed props and real event handlers instead of event delegation.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }    from 'preact';
import { Avatar }        from '@shared/Avatar';
import { Badge }         from '@shared/Badge';
import type { EmployeeListItem, UserRole } from './types';
import { TODAY_STATUS_COLOR, TODAY_STATUS_LABEL } from './utils';

interface EmployeeCardProps {
  emp:       EmployeeListItem;
  isAdmin:   boolean;
  onClick:   (emp: EmployeeListItem) => void;
  onEdit:    (emp: EmployeeListItem) => void;
  onDelete:  (emp: EmployeeListItem) => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  admin:    'Admin',
  manager:  'Manager',
  employee: 'Employee',
};

export function EmployeeCard({ emp, isAdmin, onClick, onEdit, onDelete }: EmployeeCardProps): VNode {
  const isActive     = emp.status === 'Active';
  const todayColor   = TODAY_STATUS_COLOR[emp.todayStatus];
  const todayLabel   = TODAY_STATUS_LABEL[emp.todayStatus];
  const headerBg     = isActive ? '#16a34a' : '#9ca3af';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View profile for ${emp.fullName}`}
      onClick={() => onClick(emp)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(emp); }}
      style={{
        background:   '#fff',
        borderRadius: '12px',
        overflow:     'hidden',
        boxShadow:    '0 1px 3px rgba(0,0,0,.08)',
        cursor:       'pointer',
        transition:   'transform 0.15s, box-shadow 0.15s',
        position:     'relative',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform   = 'translateY(-2px)';
        (e.currentTarget as HTMLElement).style.boxShadow  = '0 4px 12px rgba(0,0,0,.15)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform   = '';
        (e.currentTarget as HTMLElement).style.boxShadow  = '0 1px 3px rgba(0,0,0,.08)';
      }}
    >
      {/* Coloured header strip */}
      <div style={{ background: headerBg, height: '8px' }} />

      {/* Admin action overlay */}
      {isAdmin && (
        <div
          class="card-overlay-actions"
          style={{
            position: 'absolute', top: '12px', right: '10px',
            display: 'flex', gap: '6px', zIndex: 2,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`Edit ${emp.fullName}`}
            onClick={() => onEdit(emp)}
            style={overlayBtnStyle('#2563eb')}
            title="Edit employee"
          >
            <i class="fas fa-pencil-alt" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${emp.fullName}`}
            onClick={() => onDelete(emp)}
            style={overlayBtnStyle('#dc2626')}
            title="Delete employee"
          >
            <i class="fas fa-trash" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Card body */}
      <div style={{ padding: '20px 16px 16px', textAlign: 'center' }}>
        <div style={{ margin: '0 auto 12px', display: 'flex', justifyContent: 'center' }}>
          <Avatar
            src={emp.profileImage}
            name={emp.fullName}
            size={64}
          />
        </div>

        <div style={{ fontSize: '15px', fontWeight: '600', color: '#111827', marginBottom: '2px' }}>
          {emp.fullName}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
          {emp.position || '—'}
        </div>

        {/* Employee number pill */}
        {emp.employeeNumber && (
          <div style={{
            display:      'inline-block',
            background:   '#f3f4f6',
            borderRadius: '999px',
            padding:      '2px 10px',
            fontSize:     '11px',
            color:        '#374151',
            marginBottom: '10px',
          }}>
            {emp.employeeNumber}
          </div>
        )}

        {/* Department */}
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
          <i class="fas fa-building" aria-hidden="true" style={{ marginRight: '4px' }} />
          {emp.department || '—'}
        </div>

        {/* Badges row */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Badge status={emp.status === 'Active' ? 'active' : 'inactive'} />

          {/* Today status dot + label */}
          <span style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          '4px',
            fontSize:     '11px',
            fontWeight:   '500',
            color:        todayColor,
            background:   `${todayColor}18`,
            borderRadius: '999px',
            padding:      '3px 8px',
          }}>
            <span style={{
              width: '6px', height: '6px',
              borderRadius: '50%',
              background: todayColor,
              display: 'inline-block',
            }} />
            {todayLabel}
          </span>

          <span style={{
            fontSize:     '11px',
            fontWeight:   '500',
            color:        '#6366f1',
            background:   '#eef2ff',
            borderRadius: '999px',
            padding:      '3px 8px',
          }}>
            {ROLE_LABEL[emp.role]}
          </span>
        </div>
      </div>
    </div>
  );
}

function overlayBtnStyle(color: string): Record<string, string> {
  return {
    width:          '28px',
    height:         '28px',
    borderRadius:   '6px',
    background:     '#fff',
    border:         `1px solid ${color}40`,
    color:          color,
    cursor:         'pointer',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    fontSize:       '12px',
    transition:     'background 0.12s',
  };
}
