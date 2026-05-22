/**
 * SuperadminModulesSection.tsx
 *
 * Superadmin-only panel for enabling/disabling feature modules.
 *
 * Two tabs:
 *   • Admin Modules  — global role-level toggles for the admin role
 *   • Manager Modules — per-manager module assignment (like site-employee picker)
 *     Left panel: list of managers. Click one → right panel shows their modules.
 *
 * Changes take effect on the manager's next login (sidebar rebuilt from the
 * updated module map). Superadmin always sees all modules regardless.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode, h }                             from 'preact';
import { useState, useEffect, useCallback }           from 'preact/hooks';
import { toast }                                      from '@store';
import {
  getModulesApi,
  setModuleApi,
  resetModulesApi,
  getManagersApi,
  setManagerModuleApi,
  resetManagerModulesApi,
}                                                     from '@lib/superadminApi';
import type { ModuleKey, ModuleMatrix, ManagerEntry } from '@lib/superadminApi';
import { setModuleMatrix }                            from '@components/nav/navCore';

// ── Module metadata ───────────────────────────────────────────────────────────

interface ModuleDef {
  key:      ModuleKey;
  label:    string;
  icon:     string;
  desc:     string;
  lockable: boolean;  // false = dashboard, cannot be disabled
}

const MODULES: ModuleDef[] = [
  { key: 'dashboard',  label: 'Dashboard',             icon: 'fa-tachometer-alt',      desc: 'Overview stats, charts, and KPIs. Always required.',          lockable: false },
  { key: 'employees',  label: 'Employees & Departments',icon: 'fa-users',               desc: 'Employee list, add/edit/delete, department management.',      lockable: true  },
  { key: 'attendance', label: 'Attendance & Leaves',    icon: 'fa-calendar-check',      desc: 'Full attendance log, check-in data, leave approvals.',        lockable: true  },
  { key: 'payroll',    label: 'Payroll & Hourly Rates', icon: 'fa-file-invoice-dollar', desc: 'Payroll runs, pay slips, hourly rate configuration.',         lockable: true  },
  { key: 'live_map',   label: 'Live Map & Project Sites',icon: 'fa-map-marked-alt',     desc: 'Real-time location tracking and site management.',            lockable: true  },
];

// ── Shared toggle button ──────────────────────────────────────────────────────

interface ToggleProps {
  enabled:  boolean;
  busy:     boolean;
  locked:   boolean;
  label:    string;
  onToggle: () => void;
}

function Toggle({ enabled, busy, locked, label, onToggle }: ToggleProps): VNode {
  return (
    <button
      type="button"
      disabled={locked || busy}
      onClick={onToggle}
      title={label}
      style={{
        position: 'relative', width: '48px', height: '26px',
        borderRadius: '13px', border: 'none',
        background: locked ? '#d1d5db' : enabled ? '#16a34a' : '#d1d5db',
        cursor:  locked || busy ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
        opacity: busy ? 0.7 : 1,
        flexShrink: 0,
      }}
      aria-label={label}
      aria-checked={enabled}
      role="switch"
    >
      {busy ? (
        <i class="fas fa-spinner fa-spin" style={{ color: '#fff', fontSize: '11px', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      ) : (
        <span style={{
          position: 'absolute', top: '3px',
          left: enabled ? '25px' : '3px',
          width: '20px', height: '20px', borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      )}
    </button>
  );
}

// ── Module row (shared by both tabs) ──────────────────────────────────────────

interface ModuleRowProps {
  mod:      ModuleDef;
  enabled:  boolean;
  busy:     boolean;
  idx:      number;
  total:    number;
  onToggle: () => void;
}

function ModuleRow({ mod, enabled, busy, idx, total, onToggle }: ModuleRowProps): VNode {
  const locked = !mod.lockable;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px',
      borderBottom: idx < total - 1 ? '1px solid #f3f4f6' : 'none',
      background: idx % 2 === 0 ? '#fff' : '#fafafa',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '8px',
          background: '#1B2D5512', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <i class={`fas ${mod.icon}`} style={{ fontSize: '14px', color: '#1B2D55' }} />
        </div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
            {mod.label}
            {!mod.lockable && (
              <span style={{ marginLeft: '8px', fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px', fontWeight: '500' }}>
                Always on
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{mod.desc}</div>
        </div>
      </div>
      <Toggle
        enabled={enabled}
        busy={busy}
        locked={locked}
        label={locked ? 'This module cannot be disabled' : enabled ? `Disable ${mod.label}` : `Enable ${mod.label}`}
        onToggle={onToggle}
      />
    </div>
  );
}

// ── Loading / error states ────────────────────────────────────────────────────

function LoadingBox(): VNode {
  return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>
      <i class="fas fa-spinner fa-spin" style={{ fontSize: '28px', marginBottom: '12px', display: 'block' }} />
      Loading…
    </div>
  );
}

function ErrorBox({ onRetry }: { onRetry: () => void }): VNode {
  return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>
      <i class="fas fa-exclamation-triangle" style={{ fontSize: '28px', marginBottom: '12px', display: 'block' }} />
      Failed to load.{' '}
      <button type="button" onClick={onRetry} style={{ color: '#1B2D55', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
        Retry
      </button>
    </div>
  );
}

// ── Tab: Admin Modules ────────────────────────────────────────────────────────

interface AdminTabProps {
  matrix:    ModuleMatrix;
  toggling:  string | null;
  resetting: boolean;
  onToggle:  (module: ModuleKey, enabled: boolean) => void;
  onReset:   () => void;
}

function AdminTab({ matrix, toggling, resetting, onToggle, onReset }: AdminTabProps): VNode {
  return (
    <div>
      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
          Controls which modules all admins can access. Applies globally to the admin role.
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '7px 14px', fontSize: '13px', fontWeight: '500',
            background: '#f3f4f6', color: '#374151',
            border: '1px solid #d1d5db', borderRadius: '8px',
            cursor: resetting ? 'not-allowed' : 'pointer',
            opacity: resetting ? 0.6 : 1,
          }}
        >
          <i class={resetting ? 'fas fa-spinner fa-spin' : 'fas fa-undo'} />
          Reset defaults
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {/* Column header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '10px 20px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Module</div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>
            <i class="fas fa-user-shield" style={{ marginRight: '4px' }} />Admin
          </div>
        </div>
        {MODULES.map((mod, idx) => (
          <ModuleRow
            key={mod.key}
            mod={mod}
            enabled={(matrix[mod.key] as Record<string, boolean>)?.admin ?? true}
            busy={toggling === `admin.${mod.key}`}
            idx={idx}
            total={MODULES.length}
            onToggle={() => {
              const cur = (matrix[mod.key] as Record<string, boolean>)?.admin ?? true;
              onToggle(mod.key, !cur);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tab: Manager Modules ──────────────────────────────────────────────────────

interface ManagerTabProps {
  managers:  ManagerEntry[];
  loading:   boolean;
  error:     boolean;
  toggling:  string | null;   // 'userId.module'
  resetting: string | null;   // userId being reset
  onToggle:  (userId: string, module: ModuleKey, enabled: boolean) => void;
  onReset:   (userId: string) => void;
  onRetry:   () => void;
}

function ManagerTab({
  managers, loading, error, toggling, resetting, onToggle, onReset, onRetry,
}: ManagerTabProps): VNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select first manager when list loads
  useEffect(() => {
    if (managers.length > 0 && !selectedId) setSelectedId(managers[0]?.id ?? null);
  }, [managers, selectedId]);

  const selected = managers.find(m => m.id === selectedId) ?? null;

  if (loading) return <LoadingBox />;
  if (error)   return <ErrorBox onRetry={onRetry} />;
  if (managers.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>
        <i class="fas fa-user-tie" style={{ fontSize: '32px', marginBottom: '12px', display: 'block', opacity: 0.4 }} />
        No managers found. Add a manager to configure their module access.
      </div>
    );
  }

  function initials(name: string): string {
    return (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  const isResetting = selected ? resetting === selected.id : false;

  return (
    <div style={{ display: 'flex', gap: '16px', minHeight: '400px' }}>

      {/* Left: manager list */}
      <div style={{
        width: '220px', flexShrink: 0,
        background: '#fff', borderRadius: '12px',
        border: '1px solid #e5e7eb', overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Managers ({managers.length})
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {managers.map(m => {
            const isSel = m.id === selectedId;
            // Count how many modules are enabled for this manager
            const enabledCount = MODULES.filter(mod => m.modules[mod.key]).length;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px',
                  background: isSel ? '#EEF2FF' : 'transparent',
                  borderBottom: '1px solid #f3f4f6', border: 'none',
                  borderLeft: isSel ? '3px solid #1B2D55' : '3px solid transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  transition: 'background 0.15s',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                  background: isSel ? '#1B2D55' : '#e5e7eb',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '700',
                  color: isSel ? '#fff' : '#6b7280',
                }}>
                  {initials(m.fullName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: isSel ? '700' : '500', color: isSel ? '#1B2D55' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.fullName}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>
                    {enabledCount}/{MODULES.length} modules
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: module toggles for selected manager */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '14px' }}>
            Select a manager to configure their modules
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {/* Manager header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>
                  <i class="fas fa-user-tie" style={{ marginRight: '7px', color: '#1B2D55' }} />
                  {selected.fullName}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>@{selected.username}</div>
              </div>
              <button
                type="button"
                onClick={() => onReset(selected.id)}
                disabled={isResetting}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', fontSize: '12px', fontWeight: '500',
                  background: '#f3f4f6', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: '8px',
                  cursor: isResetting ? 'not-allowed' : 'pointer',
                  opacity: isResetting ? 0.6 : 1,
                }}
              >
                <i class={isResetting ? 'fas fa-spinner fa-spin' : 'fas fa-undo'} />
                Reset to defaults
              </button>
            </div>

            {/* Module rows */}
            {MODULES.map((mod, idx) => (
              <ModuleRow
                key={mod.key}
                mod={mod}
                enabled={selected.modules[mod.key] ?? true}
                busy={toggling === `${selected.id}.${mod.key}`}
                idx={idx}
                total={MODULES.length}
                onToggle={() => onToggle(selected.id, mod.key, !(selected.modules[mod.key] ?? true))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SuperadminModulesSection(): VNode {
  const [tab, setTab]         = useState<'admin' | 'managers'>('admin');

  // ── Admin tab state ────────────────────────────────────────────────────────
  const [matrix,     setMatrix]     = useState<ModuleMatrix | null>(null);
  const [adminLoad,  setAdminLoad]  = useState(true);
  const [toggling,   setToggling]   = useState<string | null>(null);
  const [resetting,  setResetting]  = useState(false);

  // ── Managers tab state ─────────────────────────────────────────────────────
  const [managers,   setManagers]   = useState<ManagerEntry[]>([]);
  const [mgrLoad,    setMgrLoad]    = useState(false);
  const [mgrError,   setMgrError]   = useState(false);
  const [mgrToggle,  setMgrToggle]  = useState<string | null>(null);
  const [mgrReset,   setMgrReset]   = useState<string | null>(null);

  // ── Load role matrix (admin tab) ───────────────────────────────────────────
  const loadMatrix = useCallback(async (silent = false) => {
    setAdminLoad(true);
    try {
      const res = await getModulesApi();
      if (res.success && res.modules) {
        setMatrix(res.modules);
      } else if (!silent) {
        toast.error('Failed to load module permissions.');
      }
    } catch {
      if (!silent) toast.error('Network error loading modules.');
    } finally {
      setAdminLoad(false);
    }
  }, []);

  useEffect(() => { void loadMatrix(true); }, [loadMatrix]);

  // ── Load managers (managers tab) ───────────────────────────────────────────
  const loadManagers = useCallback(async (silent = false) => {
    setMgrLoad(true);
    setMgrError(false);
    try {
      const res = await getManagersApi();
      if (res.success && res.managers) {
        setManagers(res.managers);
      } else {
        setMgrError(true);
        if (!silent) toast.error(res.message ?? 'Failed to load managers.');
      }
    } catch {
      setMgrError(true);
      if (!silent) toast.error('Network error loading managers.');
    } finally {
      setMgrLoad(false);
    }
  }, []);

  // Load managers when that tab is first opened
  const [mgrLoaded, setMgrLoaded] = useState(false);
  useEffect(() => {
    if (tab === 'managers' && !mgrLoaded) {
      setMgrLoaded(true);
      void loadManagers(true);
    }
  }, [tab, mgrLoaded, loadManagers]);

  // ── Admin toggle handler ───────────────────────────────────────────────────
  const handleAdminToggle = useCallback(async (module: ModuleKey, enabled: boolean) => {
    const key = `admin.${module}`;
    setToggling(key);
    try {
      const res = await setModuleApi(module, 'admin', enabled);
      if (res.success) {
        setMatrix(prev => {
          if (!prev) return prev;
          const next = { ...prev, [module]: { ...prev[module], admin: enabled } };
          setModuleMatrix(next);
          return next;
        });
        toast.success(`${module.replace('_', ' ')} ${enabled ? 'enabled' : 'disabled'} for admin.`);
      } else {
        toast.error(res.message ?? 'Failed to update module.');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setToggling(null);
    }
  }, []);

  // ── Admin reset handler ────────────────────────────────────────────────────
  const handleAdminReset = useCallback(async () => {
    if (!window.confirm('Reset all admin module permissions to system defaults?')) return;
    setResetting(true);
    try {
      const res = await resetModulesApi();
      if (res.success) {
        toast.success('Admin module permissions reset to defaults.');
        await loadMatrix();
      } else {
        toast.error(res.message ?? 'Failed to reset modules.');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setResetting(false);
    }
  }, [loadMatrix]);

  // ── Manager toggle handler ─────────────────────────────────────────────────
  const handleManagerToggle = useCallback(async (userId: string, module: ModuleKey, enabled: boolean) => {
    const key = `${userId}.${module}`;
    setMgrToggle(key);
    try {
      const res = await setManagerModuleApi(userId, module, enabled);
      if (res.success) {
        setManagers(prev => prev.map(m =>
          m.id === userId ? { ...m, modules: { ...m.modules, [module]: enabled } } : m,
        ));
        const mgr = managers.find(m => m.id === userId);
        toast.success(`${module.replace('_', ' ')} ${enabled ? 'enabled' : 'disabled'} for ${mgr?.fullName ?? 'manager'}.`);
      } else {
        toast.error(res.message ?? 'Failed to update manager module.');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setMgrToggle(null);
    }
  }, [managers]);

  // ── Manager reset handler ──────────────────────────────────────────────────
  const handleManagerReset = useCallback(async (userId: string) => {
    const mgr = managers.find(m => m.id === userId);
    if (!window.confirm(`Reset ${mgr?.fullName ?? 'this manager'}'s modules to role defaults?`)) return;
    setMgrReset(userId);
    try {
      const res = await resetManagerModulesApi(userId);
      if (res.success) {
        toast.success(`${mgr?.fullName ?? 'Manager'} reset to role defaults.`);
        // Reload managers to get fresh effective values
        await loadManagers();
      } else {
        toast.error(res.message ?? 'Failed to reset manager modules.');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setMgrReset(null);
    }
  }, [managers, loadManagers]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#111827', margin: '0 0 4px' }}>
          <i class="fas fa-th-large" style={{ marginRight: '10px', color: '#1B2D55' }} />
          Module Permissions
        </h2>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
          Control which feature modules are visible to each role and individual manager.
          Changes take effect at next login. Superadmin always sees all modules.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #e5e7eb', marginBottom: '20px' }}>
        {([
          { key: 'admin',    label: 'Admin Modules',   icon: 'fa-user-shield' },
          { key: 'managers', label: 'Manager Modules', icon: 'fa-user-tie'    },
        ] as const).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '600',
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.key ? '#1B2D55' : '#6b7280',
              borderBottom: tab === t.key ? '2px solid #1B2D55' : '2px solid transparent',
              marginBottom: '-2px', transition: 'color 0.15s',
              display: 'inline-flex', alignItems: 'center', gap: '7px',
            }}
          >
            <i class={`fas ${t.icon}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'admin' && (
        adminLoad ? <LoadingBox /> :
        !matrix   ? <ErrorBox onRetry={() => void loadMatrix(false)} /> :
        <AdminTab
          matrix={matrix}
          toggling={toggling}
          resetting={resetting}
          onToggle={(module, enabled) => void handleAdminToggle(module, enabled)}
          onReset={() => void handleAdminReset()}
        />
      )}

      {tab === 'managers' && (
        <ManagerTab
          managers={managers}
          loading={mgrLoad}
          error={mgrError}
          toggling={mgrToggle}
          resetting={mgrReset}
          onToggle={(userId, module, enabled) => void handleManagerToggle(userId, module, enabled)}
          onReset={(userId) => void handleManagerReset(userId)}
          onRetry={() => void loadManagers(false)}
        />
      )}

      {/* Info footer */}
      <div style={{ marginTop: '20px', padding: '12px 16px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd', fontSize: '13px', color: '#0369a1', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <i class="fas fa-info-circle" style={{ marginTop: '1px', flexShrink: 0 }} />
        <span>
          Module changes apply to the sidebar at next login.
          Manager overrides take priority over role defaults.
          Superadmin always has access to all modules regardless of these settings.
        </span>
      </div>
    </div>
  );
}
