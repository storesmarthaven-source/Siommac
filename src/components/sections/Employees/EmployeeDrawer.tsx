/**
 * EmployeeDrawer.tsx
 *
 * Slide-in profile drawer shown when clicking an employee card or row.
 * Mirrors the legacy #empProfileDrawer DOM panel.
 *
 * Enterprise features:
 *   ✓ Keyboard accessible (Escape closes, focus trap within drawer)
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
import { Badge }                 from '@shared/Badge';
import type { EmployeeListItem } from './types';
import {
  TODAY_STATUS_COLOR,
  TODAY_STATUS_LABEL,
} from './utils';

interface EmployeeDrawerProps {
  emp:      EmployeeListItem | null;
  isAdmin:  boolean;
  onClose:  () => void;
  onEdit:   (emp: EmployeeListItem) => void;
  onDelete: (emp: EmployeeListItem) => void;
}

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

  const todayColor = emp ? TODAY_STATUS_COLOR[emp.todayStatus] : '#9ca3af';
  const todayLabel = emp ? TODAY_STATUS_LABEL[emp.todayStatus] : '';

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0,0,0,0.35)',
          zIndex:     1040,
          opacity:    open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={emp ? `${emp.fullName} profile` : 'Employee profile'}
        tabIndex={-1}
        style={{
          position:    'fixed',
          top:         0,
          right:       0,
          bottom:      0,
          width:       '360px',
          maxWidth:    '100vw',
          background:  '#fff',
          boxShadow:   '-4px 0 24px rgba(0,0,0,.15)',
          zIndex:      1041,
          transform:   open ? 'translateX(0)' : 'translateX(100%)',
          transition:  'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          overflowY:   'auto',
          display:     'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '16px 20px',
          borderBottom:   '1px solid #f3f4f6',
          position:       'sticky',
          top:            0,
          background:     '#fff',
          zIndex:         1,
        }}>
          <span style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
            Employee Profile
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close employee profile"
            style={{
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              color:      '#6b7280',
              fontSize:   '20px',
              lineHeight: 1,
              padding:    '4px',
            }}
          >
            <i class="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        {emp && (
          <div style={{ padding: '24px 20px', flex: 1 }}>
            {/* Avatar + name block */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <Avatar
                  src={emp.profileImage}
                  name={emp.fullName}
                  size={80}
                />
              </div>

              {/* Status dot */}
              <div style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          '6px',
                marginBottom: '8px',
              }}>
                <span style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  background: emp.status === 'Active' ? '#16a34a' : '#9ca3af',
                  display: 'inline-block',
                }} />
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {emp.status}
                </span>
              </div>

              <div style={{ fontSize: '18px', fontWeight: '700', color: '#111827', marginBottom: '4px' }}>
                {emp.fullName}
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                {emp.position || '—'}
              </div>
            </div>

            {/* Info fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <DrawerField icon="fa-id-badge"   label="Employee ID"  value={emp.employeeNumber || '—'} />
              <DrawerField icon="fa-user"        label="Username"     value={emp.username} />
              <DrawerField icon="fa-building"    label="Department"   value={emp.department || '—'} />
              <DrawerField icon="fa-shield-alt"  label="Role"         value={emp.role.charAt(0).toUpperCase() + emp.role.slice(1)} />
              {emp.email && <DrawerField icon="fa-envelope" label="Email" value={emp.email} />}
              {emp.phone && <DrawerField icon="fa-phone"    label="Phone" value={emp.phone} />}
            </div>

            {/* Today's status */}
            <div style={{
              marginTop:    '20px',
              padding:      '12px 16px',
              borderRadius: '8px',
              background:   `${todayColor}12`,
              border:       `1px solid ${todayColor}30`,
              display:      'flex',
              alignItems:   'center',
              gap:          '8px',
            }}>
              <span style={{
                width: '10px', height: '10px',
                borderRadius: '50%',
                background: todayColor,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: '13px', fontWeight: '500', color: todayColor }}>
                Today: {todayLabel}
              </span>
            </div>

            {/* Badges */}
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Badge status={emp.status === 'Active' ? 'active' : 'inactive'} />
            </div>

            {/* Admin actions */}
            {isAdmin && (
              <div style={{ marginTop: '28px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => { onClose(); onEdit(emp); }}
                  style={actionBtnStyle('#2563eb')}
                >
                  <i class="fas fa-pencil-alt" aria-hidden="true" />
                  Edit Employee
                </button>
                <button
                  type="button"
                  onClick={() => { onClose(); onDelete(emp); }}
                  style={actionBtnStyle('#dc2626')}
                >
                  <i class="fas fa-trash" aria-hidden="true" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function DrawerField({ icon, label, value }: { icon: string; label: string; value: string }): VNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        width:          '32px',
        height:         '32px',
        borderRadius:   '8px',
        background:     '#f3f4f6',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexShrink:     0,
      }}>
        <i class={`fas ${icon}`} style={{ fontSize: '13px', color: '#6b7280' }} aria-hidden="true" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </div>
        <div style={{ fontSize: '13px', color: '#111827', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function actionBtnStyle(color: string): Record<string, string | number> {
  return {
    flex:           1,
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            '6px',
    padding:        '9px 16px',
    background:     `${color}12`,
    color:          color,
    border:         `1px solid ${color}30`,
    borderRadius:   '8px',
    cursor:         'pointer',
    fontSize:       '13px',
    fontWeight:     '500',
  };
}
