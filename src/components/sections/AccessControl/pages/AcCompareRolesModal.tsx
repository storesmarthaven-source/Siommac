/**
 * src/components/sections/AccessControl/pages/AcCompareRolesModal.tsx
 *
 * Compare Roles — a side-by-side capability matrix for 2–4 roles. Rows are the
 * platform capabilities (grouped by module); each selected role gets a column with
 * ✓ (granted by that role's default set) / — (not). "Only differences" hides the rows
 * where every selected role agrees, so you can see exactly where roles diverge — the
 * key question when deciding a per-user override.
 *
 * Wired live: roles come from useRoles(); each role's default permission set is fetched
 * via getRolePermissionsApi (shared TanStack cache key with the Roles page, so it's
 * warm). No mutations here — it's a read-only comparison surface.
 */

import { type VNode, Fragment } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { useQueries } from '@tanstack/preact-query';
import { useRoles } from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { getRolePermissionsApi } from '@lib/superadminApi';
import { PERMISSION_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import { LucideIcon } from '@ui/LucideIcon';

const MAX_ROLES = 4;

export function AcCompareRolesModal({ onClose }: { onClose: () => void }): VNode {
  const rolesQ = useRoles(true);
  const roles  = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
  const [selected, setSelected] = useState<string[]>([]);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [search, setSearch]     = useState('');

  // Default to the two most-used roles once the list loads.
  useEffect(() => {
    if (!selected.length && roles.length) setSelected(roles.slice(0, 2).map(r => r.name));
  }, [roles, selected.length]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleRole = (name: string) => setSelected(prev =>
    prev.includes(name) ? prev.filter(n => n !== name) : prev.length >= MAX_ROLES ? prev : [...prev, name]);

  // One query per selected role (shares the Roles page's cache).
  const permQueries = useQueries({
    queries: selected.map(name => ({
      queryKey: consoleKeys.rolePerms(name),
      queryFn: async () => {
        const res = await getRolePermissionsApi(name);
        if (!res.success) throw new Error(res.message ?? 'Failed to load role permissions');
        return res.permissions ?? [];
      },
    })),
  });
  const loading = permQueries.some(q => q.isLoading);
  // Superadmin's default set is "everything" — reflect that even if the API returns [].
  const permSets = useMemo(
    () => selected.map((name, i) => ({ name, all: name === 'superadmin', set: new Set(permQueries[i]?.data ?? []) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, permQueries.map(q => q.data).join('|')],
  );
  const grants = (k: PermissionKey, col: { all: boolean; set: Set<string> }) => col.all || col.set.has(k);
  const roleLabel = (name: string) => roles.find(r => r.name === name)?.label ?? name;

  // Rows grouped by module, honoring search + only-differences.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byMod = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      const m = PERMISSION_META[k]; if (!m) continue;
      if (q && !m.label.toLowerCase().includes(q) && !m.module.toLowerCase().includes(q)) continue;
      if (onlyDiff && permSets.length > 1) {
        const first = grants(k, permSets[0]!);
        if (permSets.every(c => grants(k, c) === first)) continue;
      }
      (byMod.get(m.module) ?? byMod.set(m.module, []).get(m.module)!).push(k);
    }
    return byMod;
  }, [search, onlyDiff, permSets]);

  const totalRows = [...groups.values()].reduce((n, a) => n + a.length, 0);

  return (
    <div class="cmp-overlay" onClick={onClose}>
      <div class="cmp-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Compare roles">
        <div class="cmp-head">
          <div class="cmp-head-title"><LucideIcon name="GitCompareArrows" size={18} /> Compare Roles</div>
          <button class="cmp-x" onClick={onClose} aria-label="Close"><LucideIcon name="X" size={18} /></button>
        </div>

        <div class="cmp-toolbar">
          <div class="cmp-roles">
            {rolesQ.isLoading ? <span class="cmp-muted">Loading roles…</span>
             : roles.map(r => {
                const on = selected.includes(r.name);
                const full = !on && selected.length >= MAX_ROLES;
                return (
                  <button key={r.name} class={`cmp-chip${on ? ' on' : ''}`} disabled={full}
                    title={full ? `Up to ${MAX_ROLES} roles` : undefined} onClick={() => toggleRole(r.name)}>
                    <LucideIcon name={on ? 'Check' : 'Plus'} size={13} strokeWidth={2.5} /> {r.label}
                  </button>
                );
              })}
          </div>
          <div class="cmp-tools">
            <label class={`cmp-toggle${onlyDiff ? ' on' : ''}`}>
              <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff((e.target as HTMLInputElement).checked)} />
              Only differences
            </label>
            <div class="cmp-search">
              <LucideIcon name="Search" size={14} />
              <input placeholder="Search capabilities…" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        </div>

        <div class="cmp-body">
          {selected.length < 2 ? (
            <div class="cmp-empty"><LucideIcon name="GitCompareArrows" size={26} /><p>Select at least two roles to compare.</p></div>
          ) : loading ? (
            <div class="cmp-empty"><span class="cmp-muted">Loading role permissions…</span></div>
          ) : totalRows === 0 ? (
            <div class="cmp-empty"><LucideIcon name="SearchX" size={24} /><p>No capabilities match{onlyDiff ? ' — these roles are identical for this filter' : ''}.</p></div>
          ) : (
            <table class="cmp-grid">
              <thead>
                <tr>
                  <th class="cmp-cap-h">Capability</th>
                  <th class="cmp-risk-h">Risk</th>
                  {selected.map(n => <th key={n} class="cmp-role-h" title={roleLabel(n)}>{roleLabel(n)}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].map(([mod, keys]) => (
                  <Fragment key={mod}>
                    <tr class="cmp-mod-row">
                      <td colSpan={2 + selected.length}>{mod} <span class="cmp-mod-n">{keys.length}</span></td>
                    </tr>
                    {keys.map(k => {
                      const meta = PERMISSION_META[k]!;
                      return (
                        <tr key={k}>
                          <td class="cmp-cap"><div class="cmp-cap-name">{meta.label}</div><div class="cmp-cap-key">{k}</div></td>
                          <td class="cmp-risk"><span class={`cmp-risk-pill r-${meta.risk}`}>{meta.risk}</span></td>
                          {permSets.map(col => (
                            <td key={col.name} class="cmp-cell">
                              {grants(k, col)
                                ? <span class="cmp-yes"><LucideIcon name="Check" size={14} strokeWidth={3} /></span>
                                : <span class="cmp-no">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div class="cmp-foot">
          <span class="cmp-muted">{selected.length} role{selected.length === 1 ? '' : 's'} · {totalRows} capabilit{totalRows === 1 ? 'y' : 'ies'}{onlyDiff ? ' differing' : ''}</span>
          <button class="cmp-done" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
