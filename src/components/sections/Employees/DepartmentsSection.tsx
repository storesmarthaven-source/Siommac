/**
 * DepartmentsSection.tsx
 *
 * Admin-only department management section.
 * Replaces loadDepartments / displayDepartments / showAddDepartmentModal
 * / addDepartment / deleteDepartment from employees.js.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                               from 'preact';
import { useState, useMemo, useCallback }            from 'preact/hooks';
import { Spinner }                                   from '@shared/Spinner';
import { confirm }                                   from '@shared/ConfirmDialog';
import type { Department }                           from './types';
import { useDepartmentList, useDeleteDepartment }    from './hooks';
import { StatCard }                                  from './StatCard';
import { DepartmentModal }                           from './DepartmentModal';

export function DepartmentsSection(): VNode {
  const { data: departments = [], isLoading, error, refetch } = useDepartmentList();
  const deleteMutation = useDeleteDepartment();

  const [search,         setSearch]        = useState('');
  const [modalDept,      setModalDept]     = useState<Department | null | undefined>(undefined);
  // undefined = closed, null = add mode, Department = edit mode
  const modalOpen = modalDept !== undefined;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return departments.filter(d =>
      !q || d.name.toLowerCase().includes(q) || d.manager.toLowerCase().includes(q),
    );
  }, [departments, search]);

  const stats = useMemo(() => ({
    total:     departments.length,
    employees: departments.reduce((s, d) => s + d.employeeCount, 0),
    withHead:  departments.filter(d => d.managerId).length,
  }), [departments]);

  const handleDelete = useCallback(async (dept: Department) => {
    const ok = await confirm({
      title:        `Delete "${dept.name}"?`,
      message:      `This will permanently delete the department. Employees in this department will be unassigned but not deleted.`,
      variant:      'danger',
      confirmLabel: 'Delete Department',
    });
    if (ok) deleteMutation.mutate(dept.id);
  }, [deleteMutation]);

  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
        <i class="fas fa-exclamation-triangle" style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }} />
        <div>Failed to load departments</div>
        <button
          type="button"
          onClick={() => void refetch()}
          style={{ marginTop: '12px', padding: '7px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: '#111827' }}>Departments</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>Manage your organisational structure</p>
        </div>
        <button
          type="button"
          onClick={() => setModalDept(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '9px 18px', background: '#2563eb', color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '14px', fontWeight: '500',
          }}
        >
          <i class="fas fa-plus" aria-hidden="true" /> Add Department
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <StatCard icon="fa-sitemap"     label="Total Departments" value={stats.total}     color="#7c3aed" loading={isLoading} />
        <StatCard icon="fa-users"        label="Total Employees"   value={stats.employees} color="#2563eb" loading={isLoading} />
        <StatCard icon="fa-user-tie"     label="With Manager"      value={stats.withHead}  color="#16a34a" loading={isLoading} />
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: '320px', marginBottom: '20px' }}>
        <i class="fas fa-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: '13px' }} />
        <input
          type="search"
          value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Search departments…"
          aria-label="Search departments"
          style={{ width: '100%', padding: '8px 10px 8px 32px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div style={{ padding: '60px', display: 'flex', justifyContent: 'center' }}>
          <Spinner size={36} label="Loading departments…" />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
          <i class="fas fa-sitemap" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', opacity: 0.4 }} />
          <div style={{ fontWeight: '600' }}>No departments found</div>
          {search && <div style={{ fontSize: '13px', marginTop: '4px' }}>Try adjusting your search.</div>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {filtered.map(dept => (
            <DepartmentCard
              key={dept.id}
              dept={dept}
              onEdit={() => setModalDept(dept)}
              onDelete={() => void handleDelete(dept)}
            />
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      <DepartmentModal
        open={modalOpen}
        department={modalDept ?? undefined}
        onClose={() => setModalDept(undefined)}
      />

    </div>
  );
}

// ── Department card ───────────────────────────────────────────────────────────

function DepartmentCard({
  dept, onEdit, onDelete,
}: {
  dept:     Department;
  onEdit:   () => void;
  onDelete: () => void;
}): VNode {
  return (
    <div style={{
      background:   '#fff',
      borderRadius: '12px',
      padding:      '20px',
      boxShadow:    '0 1px 3px rgba(0,0,0,.08)',
      position:     'relative',
    }}>
      {/* Action overlay */}
      <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '6px' }}>
        <OverlayBtn icon="fa-pencil-alt" color="#2563eb" label={`Edit ${dept.name}`} onClick={onEdit} />
        <OverlayBtn icon="fa-trash"      color="#dc2626" label={`Delete ${dept.name}`} onClick={onDelete} />
      </div>

      {/* Icon */}
      <div style={{
        width: '44px', height: '44px', borderRadius: '10px',
        background: '#7c3aed18', display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '12px',
      }}>
        <i class="fas fa-building" style={{ color: '#7c3aed', fontSize: '18px' }} aria-hidden="true" />
      </div>

      <div style={{ fontSize: '16px', fontWeight: '700', color: '#111827', marginBottom: '4px', paddingRight: '64px' }}>
        {dept.name}
      </div>

      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        <i class="fas fa-user-tie" aria-hidden="true" style={{ marginRight: '5px' }} />
        {dept.manager}
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <Pill icon="fa-users" label={`${dept.employeeCount} employees`} />
      </div>
    </div>
  );
}

function OverlayBtn({ icon, color, label, onClick }: { icon: string; color: string; label: string; onClick: () => void }): VNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: '28px', height: '28px', borderRadius: '6px',
        background: '#fff', border: `1px solid ${color}40`,
        color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px',
      }}
    >
      <i class={`fas ${icon}`} aria-hidden="true" />
    </button>
  );
}

function Pill({ icon, label }: { icon: string; label: string }): VNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
      <i class={`fas ${icon}`} aria-hidden="true" />
      {label}
    </span>
  );
}
