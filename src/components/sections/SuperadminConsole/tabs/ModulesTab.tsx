/**
 * tabs/ModulesTab.tsx
 *
 * Feature-module visibility management. Two sub-views:
 *   • Admin Modules  — global role-level toggles for the admin role
 *   • Manager Modules — per-manager module assignment
 *
 * Data via TanStack Query hooks (hooks.ts). Changes take effect at next login.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { confirm } from '@shared/ConfirmDialog';
import type { ModuleKey, ModuleMatrix, ManagerEntry } from '@lib/superadminApi';
import {
  useModuleMatrix, useSetAdminModule, useResetAdminModules,
  useManagers, useSetManagerModule, useResetManagerModules,
} from '../hooks';

// ── Module metadata ───────────────────────────────────────────────────────────

interface ModuleDef { key: ModuleKey; label: string; icon: string; desc: string; lockable: boolean; }

const MODULES: ModuleDef[] = [
  { key: 'dashboard',  label: 'Dashboard',              icon: 'fa-tachometer-alt',      desc: 'Overview stats, charts, and KPIs. Always required.',     lockable: false },
  { key: 'employees',  label: 'Employees & Departments',icon: 'fa-users',               desc: 'Employee list, add/edit/delete, department management.', lockable: true  },
  { key: 'attendance', label: 'Attendance & Leaves',    icon: 'fa-calendar-check',      desc: 'Full attendance log, check-in data, leave approvals.',   lockable: true  },
  { key: 'payroll',    label: 'Payroll & Hourly Rates', icon: 'fa-file-invoice-dollar', desc: 'Payroll runs, pay slips, hourly rate configuration.',    lockable: true  },
  { key: 'live_map',   label: 'Live Map & Project Sites',icon: 'fa-map-marked-alt',     desc: 'Real-time location tracking and site management.',       lockable: true  },
];

// ── Shared toggle + row ───────────────────────────────────────────────────────

function Toggle({ enabled, busy, locked, label, onToggle }: {
  enabled: boolean; busy: boolean; locked: boolean; label: string; onToggle: () => void;
}): VNode {
  return (
    <label class="stg-toggle" title={label} style={{ opacity: busy ? 0.7 : 1 }}>
      <input type="checkbox" checked={enabled} disabled={locked || busy} onChange={onToggle} aria-label={label} />
      <span class="stg-slider" />
      {busy && <i class="fas fa-spinner fa-spin" style={{ color: '#fff', fontSize: '11px', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />}
    </label>
  );
}

function ModuleRow({ mod, enabled, busy, idx, total, onToggle }: {
  mod: ModuleDef; enabled: boolean; busy: boolean; idx: number; total: number; onToggle: () => void;
}): VNode {
  const locked = !mod.lockable;
  return (
    <div class="stg-switch-group" style={{ padding: '14px 20px', borderBottom: idx < total - 1 ? '1px solid var(--border)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', background: 'rgba(27,45,84,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <i class={`fas ${mod.icon}`} style={{ fontSize: '14px', color: 'var(--siomac-navy)' }} />
        </div>
        <div>
          <div class="stg-switch-label">
            {mod.label}
            {!mod.lockable && <span style={{ marginLeft: '8px', fontSize: '11px', background: 'rgba(255,183,18,0.18)', color: 'var(--siomac-gold)', padding: '2px 6px', borderRadius: '4px', fontWeight: '500' }}>Always on</span>}
          </div>
          <div class="stg-switch-desc">{mod.desc}</div>
        </div>
      </div>
      <Toggle enabled={enabled} busy={busy} locked={locked}
        label={locked ? 'This module cannot be disabled' : enabled ? `Disable ${mod.label}` : `Enable ${mod.label}`}
        onToggle={onToggle} />
    </div>
  );
}

function LoadingBox(): VNode {
  return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
}
function ErrorBox({ onRetry }: { onRetry: () => void }): VNode {
  return (
    <div class="emp-loading emp-err">
      <i class="fas fa-exclamation-triangle" /> Failed to load.{' '}
      <button type="button" onClick={onRetry} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );
}

// ── Admin sub-view ────────────────────────────────────────────────────────────

function AdminModules({ matrix }: { matrix: ModuleMatrix }): VNode {
  const setMod = useSetAdminModule();
  const reset  = useResetAdminModules();
  const togglingKey = setMod.isPending ? `admin.${setMod.variables?.module}` : null;

  return (
    <div>
      <div class="section-header" style={{ marginBottom: '16px' }}>
        <p class="stg-switch-desc" style={{ margin: 0 }}>Controls which modules all admins can access. Applies globally to the admin role.</p>
        <button type="button" class="btn btn-sm btn-outline-secondary has-label" onClick={async () => {
          if (await confirm({ title: 'Reset admin modules?', message: 'Reset all admin module permissions to system defaults?', confirmLabel: 'Reset' })) reset.mutate();
        }} disabled={reset.isPending}>
          <i class={reset.isPending ? 'fas fa-spinner fa-spin' : 'fas fa-undo'} /> Reset defaults
        </button>
      </div>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', padding: '10px 20px' }}>
          <div class="stg-switch-desc" style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 0 }}>Module</div>
          <div class="stg-switch-desc" style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center', marginTop: 0 }}><i class="fas fa-user-shield" style={{ marginRight: '4px' }} />Admin</div>
        </div>
        {MODULES.map((mod, idx) => {
          const cur = (matrix[mod.key] as Record<string, boolean>)?.admin ?? true;
          return <ModuleRow key={mod.key} mod={mod} enabled={cur} busy={togglingKey === `admin.${mod.key}`} idx={idx} total={MODULES.length}
            onToggle={() => setMod.mutate({ module: mod.key, enabled: !cur })} />;
        })}
      </div>
    </div>
  );
}

// ── Manager sub-view ──────────────────────────────────────────────────────────

function ManagerModules({ managers }: { managers: ManagerEntry[] }): VNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const setMod = useSetManagerModule();
  const reset  = useResetManagerModules();

  useEffect(() => { if (managers.length > 0 && !selectedId) setSelectedId(managers[0]?.id ?? null); }, [managers, selectedId]);
  const selected = managers.find(m => m.id === selectedId) ?? null;

  if (managers.length === 0) {
    return <div class="emp-empty"><i class="fas fa-user-tie" /><p>No managers found. Add a manager to configure their module access.</p></div>;
  }

  const initials = (name: string) => (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const togglingKey = setMod.isPending && setMod.variables ? `${setMod.variables.userId}.${setMod.variables.module}` : null;
  const isResetting = selected ? reset.isPending && reset.variables === selected.id : false;

  return (
    <div style={{ display: 'flex', gap: '16px', minHeight: '400px' }}>
      <div style={{ width: '220px', flexShrink: 0, background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
          <div class="stg-switch-desc" style={{ fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 0 }}>Managers ({managers.length})</div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {managers.map(m => {
            const isSel = m.id === selectedId;
            const enabledCount = MODULES.filter(mod => m.modules[mod.key]).length;
            return (
              <button key={m.id} type="button" onClick={() => setSelectedId(m.id)} style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: isSel ? 'rgba(27,45,84,0.06)' : 'transparent', borderBottom: '1px solid var(--border)', border: 'none', borderLeft: isSel ? '3px solid var(--siomac-navy)' : '3px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.15s' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, background: isSel ? 'var(--siomac-navy)' : 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: isSel ? '#fff' : 'var(--text-muted)' }}>{initials(m.fullName)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: isSel ? '700' : '500', color: isSel ? 'var(--siomac-navy)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fullName}</div>
                  <div class="stg-switch-desc" style={{ marginTop: '1px' }}>{enabledCount}/{MODULES.length} modules</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '14px' }}>Select a manager to configure their modules</div>
        ) : (
          <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div class="stg-switch-group" style={{ padding: '12px 20px', background: 'var(--bg-subtle)' }}>
              <div>
                <div class="stg-switch-label"><i class="fas fa-user-tie" style={{ marginRight: '7px', color: 'var(--siomac-navy)' }} />{selected.fullName}</div>
                <div class="stg-switch-desc">@{selected.username}</div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-secondary has-label" disabled={isResetting} onClick={async () => {
                if (await confirm({ title: 'Reset manager modules?', message: `Reset ${selected.fullName}'s modules to role defaults?`, confirmLabel: 'Reset' })) reset.mutate(selected.id);
              }}>
                <i class={isResetting ? 'fas fa-spinner fa-spin' : 'fas fa-undo'} /> Reset to defaults
              </button>
            </div>
            {MODULES.map((mod, idx) => {
              const cur = selected.modules[mod.key] ?? true;
              return <ModuleRow key={mod.key} mod={mod} enabled={cur} busy={togglingKey === `${selected.id}.${mod.key}`} idx={idx} total={MODULES.length}
                onToggle={() => setMod.mutate({ userId: selected.id, module: mod.key, enabled: !cur })} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export function ModulesTab(): VNode {
  const [view, setView] = useState<'admin' | 'managers'>('admin');
  const matrixQ   = useModuleMatrix();
  const managersQ = useManagers(view === 'managers');

  const stats = useMemo(() => {
    const m = matrixQ.data;
    const adminEnabled = m
      ? MODULES.filter(mod => (m[mod.key] as Record<string, boolean> | undefined)?.admin ?? true).length
      : MODULES.length;
    return {
      total:    MODULES.length,
      lockable: MODULES.filter(mod => mod.lockable).length,
      enabled:  adminEnabled,
    };
  }, [matrixQ.data]);

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard icon="fa-th-large"   label="Total Modules"     value={stats.total}    color="#2563eb" loading={matrixQ.isLoading} />
        <StatCard icon="fa-toggle-on"  label="Enabled (Admin)"   value={stats.enabled}  color="#16a34a" loading={matrixQ.isLoading} />
        <StatCard icon="fa-lock-open"  label="Lockable"          value={stats.lockable} color="#d97706" loading={matrixQ.isLoading} />
      </div>

      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '20px' }}>
        {([
          { key: 'admin',    label: 'Admin Modules',   icon: 'fa-user-shield' },
          { key: 'managers', label: 'Manager Modules', icon: 'fa-user-tie'    },
        ] as const).map(t => (
          <button key={t.key} type="button" class={`emp-tab-btn ${view === t.key ? 'active' : ''}`} onClick={() => setView(t.key)} style={{ marginBottom: '-1px' }}>
            <i class={`fas ${t.icon}`} /> {t.label}
          </button>
        ))}
      </div>

      {view === 'admin' && (
        matrixQ.isLoading ? <LoadingBox /> :
        matrixQ.isError || !matrixQ.data ? <ErrorBox onRetry={() => void matrixQ.refetch()} /> :
        <AdminModules matrix={matrixQ.data} />
      )}

      {view === 'managers' && (
        managersQ.isLoading ? <LoadingBox /> :
        managersQ.isError ? <ErrorBox onRetry={() => void managersQ.refetch()} /> :
        <ManagerModules managers={managersQ.data ?? []} />
      )}

      <div style={{ marginTop: '20px', padding: '12px 16px', background: 'rgba(27,45,84,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <i class="fas fa-info-circle" style={{ marginTop: '1px', flexShrink: 0, color: 'var(--siomac-navy)' }} />
        <span>Module changes apply to the sidebar at next login. Manager overrides take priority over role defaults. Superadmin always has access to all modules.</span>
      </div>
    </div>
  );
}
