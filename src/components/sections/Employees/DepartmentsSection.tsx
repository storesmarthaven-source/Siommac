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
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'var(--font-weight-bold)', color: '#111827' }}>Departments</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>Manage your organisational structure</p>
        </div>
        <button
          type="button"
          class="btn btn-danger-primary btn-sm"
          onClick={() => setModalDept(null)}
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
      <div class="dept-filters-bar">
        <div class="dept-search-box">
          <i class="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search by name or manager…"
            aria-label="Search departments"
          />
        </div>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div class="dept-loading">
          <Spinner size={36} label="Loading departments…" />
        </div>
      ) : filtered.length === 0 ? (
        <div class="dept-empty">
          <i class="fas fa-sitemap" aria-hidden="true" />
          <div style={{ fontWeight: '600' }}>No departments found</div>
          {search && <p>Try adjusting your search.</p>}
        </div>
      ) : (
        <div class="dept-cards-grid">
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
  const hasManager = !!dept.managerId;
  return (
    <div class="dept-card">
      {/* Header — navy with icon + action overlay */}
      <div class="dept-card-header">
        <div class="dept-card-icon">
          <i class="fas fa-building" aria-hidden="true" />
        </div>
        <div class="dept-card-title-block">
          <div class="dept-card-name">{dept.name}</div>
          <div class="dept-card-id-tag">{dept.id}</div>
        </div>
        <div class="card-overlay-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            class="card-overlay-btn edit"
            aria-label={`Edit ${dept.name}`}
            title={`Edit ${dept.name}`}
            onClick={onEdit}
          >
            <i class="fas fa-pencil-alt" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="card-overlay-btn delete"
            aria-label={`Delete ${dept.name}`}
            title={`Delete ${dept.name}`}
            onClick={onDelete}
          >
            <i class="fas fa-trash" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body — manager + description + stat badges */}
      <div class="dept-card-body">
        <div class="dept-info-row">
          <i class="fas fa-user-tie" aria-hidden="true" />
          <span>{hasManager ? dept.manager : 'No manager assigned'}</span>
        </div>
        {dept.description && (
          <div class="dept-info-row">
            <i class="fas fa-align-left" aria-hidden="true" />
            <span>{dept.description}</span>
          </div>
        )}
        <div class="dept-stats-badges">
          <span class="dept-badge blue">
            <i class="fas fa-users" aria-hidden="true" />
            {dept.employeeCount} {dept.employeeCount === 1 ? 'employee' : 'employees'}
          </span>
          <span class={`dept-badge ${hasManager ? 'green' : 'gold'}`}>
            <i class={`fas ${hasManager ? 'fa-user-check' : 'fa-user-slash'}`} aria-hidden="true" />
            {hasManager ? 'Managed' : 'Unmanaged'}
          </span>
        </div>
      </div>
    </div>
  );
}
