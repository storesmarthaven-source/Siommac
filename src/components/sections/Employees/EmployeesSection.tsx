/**
 * EmployeesSection.tsx
 *
 * Admin-only employee management section.
 * Replaces the legacy loadEmployeeList / _renderEmployees / _renderEmpCards
 * / _renderEmpTable / openEmpDrawer / editEmployee / deleteEmployee functions.
 *
 * Features:
 *   ✓ Card / table view toggle
 *   ✓ Text search + role filter + status filter (all client-side)
 *   ✓ Animated stat cards (Total, Active, Checked In, Departments)
 *   ✓ Profile drawer for quick view
 *   ✓ Add / Edit modal (full payroll fields)
 *   ✓ Delete confirmation via ConfirmDialog
 *   ✓ TanStack Query: background refresh, optimistic invalidation
 *   ✓ Loading skeleton and error state
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                               from 'preact';
import { useState, useMemo, useCallback }            from 'preact/hooks';
import { Spinner }                                   from '@shared/Spinner';
import { DataTable }                                 from '@shared/DataTable';
import { confirm }                                   from '@shared/ConfirmDialog';
import { useCan }                                     from '@lib/permissions';
import type { EmployeeListItem, UserRole }            from './types';
import { useEmployeeList, useDeleteEmployee, useEmployee } from './hooks';
import { StatCard }                                  from './StatCard';
import { EmployeeCard }                              from './EmployeeCard';
import { EmployeeDrawer }                            from './EmployeeDrawer';
import { EmployeeModal }                             from './EmployeeModal';
import { TODAY_STATUS_LABEL, TODAY_STATUS_COLOR }    from './utils';

// ── Column definitions for DataTable ─────────────────────────────────────────

type EmpRow = EmployeeListItem;

const COLUMNS = [
  {
    title: '#',
    data:  'idx' as keyof EmpRow,
    width: '50px',
    orderable: true,
  },
  {
    title: 'Employee',
    data:  null,
    render: (_v: unknown, _t: string, row: EmpRow) =>
      `<div style="display:flex;align-items:center;gap:10px">
         <img src="${row.profileImage || ''}" alt="${row.fullName}"
              onerror="this.style.display='none'"
              style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0"
              ${row.profileImage ? '' : 'style="display:none"'} />
         <div>
           <div style="font-weight:600;font-size:13px;color:#111827">${row.fullName}</div>
           <div style="font-size:11px;color:#6b7280">@${row.username}</div>
           ${row.email ? `<div style="font-size:11px;color:#9ca3af">${row.email}</div>` : ''}
         </div>
       </div>`,
  },
  { title: 'Dept',     data: 'department'     as keyof EmpRow },
  { title: 'Position', data: 'position'       as keyof EmpRow },
  {
    title: 'Role',
    data:  'role' as keyof EmpRow,
    render: (v: unknown) => {
      const role = String(v);
      const color = role === 'admin' ? '#7c3aed' : role === 'manager' ? '#2563eb' : '#374151';
      return `<span style="font-size:11px;font-weight:600;color:${color};background:${color}18;padding:2px 8px;border-radius:999px">${role.charAt(0).toUpperCase() + role.slice(1)}</span>`;
    },
  },
  {
    title: 'Status',
    data:  'status' as keyof EmpRow,
    render: (v: unknown) => {
      const s = String(v);
      const c = s === 'Active' ? '#16a34a' : '#9ca3af';
      return `<span style="font-size:11px;font-weight:600;color:${c};background:${c}18;padding:2px 8px;border-radius:999px">${s}</span>`;
    },
  },
  {
    title: 'Today',
    data:  'todayStatus' as keyof EmpRow,
    render: (v: unknown) => {
      const s = v as EmployeeListItem['todayStatus'];
      const c = TODAY_STATUS_COLOR[s];
      const l = TODAY_STATUS_LABEL[s];
      return `<span style="font-size:11px;font-weight:600;color:${c};background:${c}18;padding:2px 8px;border-radius:999px">${l}</span>`;
    },
  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

interface EmployeesSectionProps {
  currentRole:     UserRole;
  currentUsername: string;
}

export function EmployeesSection({ currentRole: _currentRole, currentUsername: _currentUsername }: EmployeesSectionProps): VNode {
  // Capability-based gating (includes superadmin via ROLE_PERMISSIONS, and any
  // per-user grant/override) instead of a raw role === 'admin' check.
  const canAdd    = useCan('employees.add');
  const canEdit   = useCan('employees.edit');
  const canDelete = useCan('employees.delete');
  // Card/drawer show their edit+delete overlay when the user can do either.
  const canManage = canEdit || canDelete;

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: employees = [], isLoading, error, refetch } = useEmployeeList();
  const deleteMutation = useDeleteEmployee();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [cardView,        setCardView]       = useState(true);
  const [search,          setSearch]         = useState('');
  const [roleFilter,      setRoleFilter]     = useState<'' | UserRole>('');
  const [statusFilter,    setStatusFilter]   = useState<'' | 'Active' | 'Inactive'>('');
  const [drawerEmp,       setDrawerEmp]      = useState<EmployeeListItem | null>(null);
  const [addOpen,         setAddOpen]        = useState(false);
  const [editUsername,    setEditUsername]   = useState<string | null>(null);
  const [editListItem,    setEditListItem]   = useState<EmployeeListItem | null>(null);

  // Fetch detail for edit modal
  const { data: editDetail } = useEmployee(editUsername);

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return employees.filter(emp => {
      if (roleFilter   && emp.role   !== roleFilter)   return false;
      if (statusFilter && emp.status !== statusFilter) return false;
      if (q && ![emp.fullName, emp.username, emp.position, emp.department, emp.employeeNumber, emp.email]
        .some(v => v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [employees, search, roleFilter, statusFilter]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:      employees.length,
    active:     employees.filter(e => e.status === 'Active').length,
    checkedIn:  employees.filter(e => e.todayStatus === 'checkedin').length,
    departments: [...new Set(employees.map(e => e.departmentId).filter(Boolean))].length,
  }), [employees]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleEdit = useCallback((emp: EmployeeListItem) => {
    setEditListItem(emp);
    setEditUsername(emp.username);
  }, []);

  const handleDelete = useCallback(async (emp: EmployeeListItem) => {
    const ok = await confirm({
      title:        `Delete ${emp.fullName}?`,
      message:      `This will permanently remove ${emp.fullName} and all their attendance and leave records. This cannot be undone.`,
      variant:      'danger',
      confirmLabel: 'Delete Employee',
    });
    if (!ok) return;
    deleteMutation.mutate(emp.username);
  }, [deleteMutation]);

  const handleCloseEdit = useCallback(() => {
    setEditUsername(null);
    setEditListItem(null);
  }, []);

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
        <i class="fas fa-exclamation-triangle" style={{ fontSize: '32px', marginBottom: '12px', display: 'block' }} />
        <div style={{ fontWeight: '600', marginBottom: '8px' }}>Failed to load employees</div>
        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'var(--font-weight-bold)', color: '#111827' }}>
            Employees
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>
            Manage your workforce
          </p>
        </div>
        {canAdd && (
          <button
            type="button"
            class="btn btn-danger-primary btn-sm"
            onClick={() => setAddOpen(true)}
          >
            <i class="fas fa-plus" aria-hidden="true" /> Add Employee
          </button>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <StatCard icon="fa-users"        label="Total Employees" value={stats.total}      color="#2563eb" loading={isLoading} />
        <StatCard icon="fa-user-check"   label="Active"          value={stats.active}     color="#16a34a" loading={isLoading} />
        <StatCard icon="fa-sign-in-alt"  label="Checked In"      value={stats.checkedIn}  color="#d97706" loading={isLoading} />
        <StatCard icon="fa-building"     label="Departments"      value={stats.departments} color="#7c3aed" loading={isLoading} />
      </div>

      {/* ── Toolbar ── */}
      <div class="emp-filters-bar">
        {/* Search */}
        <div class="emp-search-box">
          <i class="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search by name, position…"
            aria-label="Search employees"
          />
        </div>

        {/* Filters */}
        <div class="emp-filter-group">
          <select
            class="emp-filter-select"
            value={roleFilter}
            onChange={e => setRoleFilter((e.target as HTMLSelectElement).value as '' | UserRole)}
            aria-label="Filter by role"
          >
            <option value="">All Roles</option>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>

          <select
            class="emp-filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter((e.target as HTMLSelectElement).value as '' | 'Active' | 'Inactive')}
            aria-label="Filter by status"
          >
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        {/* View toggle */}
        <div class="emp-filter-actions">
          <div class="emp-view-toggle">
            <ViewToggleBtn
              icon="fa-th-large"
              label="Card view"
              active={cardView}
              onClick={() => setCardView(true)}
            />
            <ViewToggleBtn
              icon="fa-list"
              label="Table view"
              active={!cardView}
              onClick={() => setCardView(false)}
            />
          </div>
        </div>
      </div>

      {/* ── Employee list ── */}
      {isLoading ? (
        <div class="emp-loading">
          <Spinner size={40} label="Loading employees…" />
        </div>
      ) : filtered.length === 0 ? (
        <div class="emp-empty">
          <i class="fas fa-users-slash" aria-hidden="true" />
          <div style={{ fontWeight: '600' }}>No employees found</div>
          <p>
            {search || roleFilter || statusFilter ? 'Try adjusting your filters.' : 'Add your first employee to get started.'}
          </p>
        </div>
      ) : cardView ? (
        <div class="emp-cards-grid">
          {filtered.map(emp => (
            <EmployeeCard
              key={emp.id}
              emp={emp}
              isAdmin={canManage}
              onClick={setDrawerEmp}
              onEdit={handleEdit}
              onDelete={emp => void handleDelete(emp)}
            />
          ))}
        </div>
      ) : (
        <DataTable
          id="employees-datatable"
          columns={COLUMNS as unknown as import('@shared/DataTable').DataTableColumn<EmpRow>[]}
          data={filtered}
          emptyMessage="No employees match the current filters."
        />
      )}

      {/* ── Profile drawer ── */}
      <EmployeeDrawer
        emp={drawerEmp}
        isAdmin={canManage}
        onClose={() => setDrawerEmp(null)}
        onEdit={emp => { setDrawerEmp(null); handleEdit(emp); }}
        onDelete={emp => { setDrawerEmp(null); void handleDelete(emp); }}
      />

      {/* ── Add modal ── */}
      <EmployeeModal
        mode="add"
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      {/* ── Edit modal ── */}
      <EmployeeModal
        mode="edit"
        open={!!editUsername}
        employee={editDetail ?? null}
        listItem={editListItem}
        onClose={handleCloseEdit}
      />

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ViewToggleBtn({
  icon, label, active, onClick,
}: {
  icon: string; label: string; active: boolean; onClick: () => void;
}): VNode {
  return (
    <button
      type="button"
      class={`emp-view-btn${active ? ' active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <i class={`fas ${icon}`} aria-hidden="true" />
    </button>
  );
}
