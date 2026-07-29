/**
 * lib/hr/readinessOwnership.ts — resolve the operational owner of a readiness
 * domain, and FAIL CLOSED when no valid owner exists.
 *
 * From docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md:
 *
 *   "It does not grant authority by itself. The selected owner must still hold
 *    the required capability. If no valid owner exists, the blocker fails closed
 *    and appears as **Owner Required** for an administrator to configure."
 *
 * Three rules this file exists to enforce:
 *
 *  1. NO HARD-CODED DEPARTMENT NAMES OR ROLES. The owner comes from the
 *     `workforce_readiness.owner.<domain>` setting. There is no "default to HR"
 *     branch anywhere below — that would silently make HR responsible for
 *     Payroll, Learning and Account Support decisions.
 *
 *  2. CONFIGURATION IS NOT AUTHORITY. A configured owner is only accepted if it
 *     still resolves to a live principal that HOLDS the capability the domain's
 *     control actually requires. A role emptied of that capability, or a user
 *     who has left, resolves to `owner_required` — not to a stale routing target.
 *
 *  3. RESOLVE BEFORE WRITING. `requireReadinessOwner()` is called before the
 *     lifecycle transaction opens, so a work item is never created with no
 *     destination. An undeliverable work item is worse than a refused one: it
 *     looks handled and is not.
 */

import { sb } from '../db';
import { loadRolePermissions } from '../permissions';
import { firstNonBlank } from './employeeCore';
import { resolveSettingsBatch } from '../settings/resolveSetting';
import type { ReadinessDomain, ReadinessOwnerType, ReadinessOwnerResolution } from '../../../../types/hrEmployeeProfile';

/** Every readiness area, in the order the collaboration note lists them. */
export const READINESS_DOMAINS: readonly ReadinessDomain[] = [
  'assignment', 'payroll', 'training', 'documents', 'statutory', 'access',
];

/**
 * The capability a principal must hold to COMPLETE work in this domain.
 *
 * These are the exact keys from the permission catalogue (verified against
 * `lib/permissions.ts` — `hr.employees.statutory.update`, not the similarly
 * named `hr.employee.statutory.capture`). A key that does not match the
 * catalogue would make every owner resolve as unqualified.
 *
 * Note the deliberate asymmetry: payroll requires a FINANCE capability. An
 * organisation that assigns Payroll to HR Operations must give that HR role the
 * finance capability — configuration alone will not do it.
 */
export const DOMAIN_COMPLETION_CAPABILITY: Record<ReadinessDomain, string> = {
  assignment: 'hr.employees.update',
  payroll:    'finance.bank_accounts.manage',
  training:   'hse.training.verify',
  documents:  'hr.employee_documents.verify',
  statutory:  'hr.employees.statutory.update',
  access:     'hr.employees.access_assignments.manage',
};

const SETTING_PREFIX = 'workforce_readiness.owner.';
const settingKeyFor = (domain: ReadinessDomain) => `${SETTING_PREFIX}${domain}`;

/** Typed refusal thrown when a domain has no valid owner. */
export class OwnerRequiredError extends Error {
  readonly code = 'owner_required';
  /** 409: the request was well-formed; the ORGANISATION is misconfigured. */
  readonly status = 409;
  constructor(readonly domain: ReadinessDomain, readonly reason: string) {
    super(`Owner Required: ${reason}`);
    this.name = 'OwnerRequiredError';
  }
}

function unresolved(domain: ReadinessDomain, reason: string): ReadinessOwnerResolution {
  return { domain, status: 'owner_required', ownerType: null, ownerId: null, ownerLabel: null, recipientUserIds: [], reason };
}

/**
 * Parse `"<ownerType>:<ownerId>"`.
 *
 * Anything that is not exactly one of the two supported principal kinds is
 * treated as unconfigured rather than guessed at — a malformed value must not
 * become a routing decision.
 */
function parseOwnerValue(raw: unknown): { ownerType: ReadinessOwnerType; ownerId: string } | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const ownerType = value.slice(0, separator).trim();
  const ownerId = value.slice(separator + 1).trim();
  if (!ownerId) return null;
  if (ownerType !== 'role' && ownerType !== 'user') return null;
  return { ownerType, ownerId };
}

interface OwnerCandidate { domain: ReadinessDomain; ownerType: ReadinessOwnerType; ownerId: string }

/**
 * Resolve owners for several domains at once.
 *
 * Batched deliberately: the control matrix resolves all six domains on every
 * read, and a per-domain resolve would issue roughly seven setting queries each.
 */
export async function resolveReadinessOwners(
  domains: readonly ReadinessDomain[] = READINESS_DOMAINS,
): Promise<Map<ReadinessDomain, ReadinessOwnerResolution>> {
  const out = new Map<ReadinessDomain, ReadinessOwnerResolution>();
  if (!domains.length) return out;

  const keys = domains.map(settingKeyFor);

  // The catalog row is what makes a setting resolvable. If the manifest has not
  // been synced yet the rows are absent, and every domain is legitimately
  // unconfigured — never an exception, and never a fallback owner.
  const { data: catalogData, error: catalogError } = await sb
    .from('app_setting_catalog')
    .select('setting_key, module_key, default_value, user_override_allowed, role_override_allowed, site_override_allowed, department_override_allowed, module_override_allowed')
    .in('setting_key', keys)
    .eq('is_active', true);
  if (catalogError) throw new Error(`Readiness ownership catalog read failed: ${catalogError.message}`);

  const resolved = await resolveSettingsBatch(sb, catalogData, { moduleKey: 'workforce_readiness' });

  const candidates: OwnerCandidate[] = [];
  for (const domain of domains) {
    const parsed = parseOwnerValue(resolved.get(settingKeyFor(domain))?.value);
    if (!parsed) {
      out.set(domain, unresolved(domain, `No owner is configured for the ${domain} readiness area.`));
      continue;
    }
    candidates.push({ domain, ownerType: parsed.ownerType, ownerId: parsed.ownerId });
  }
  if (!candidates.length) return out;

  const roleNames = [...new Set(candidates.filter(c => c.ownerType === 'role').map(c => c.ownerId))];
  const userIds  = [...new Set(candidates.filter(c => c.ownerType === 'user').map(c => c.ownerId))];

  const [roleRes, roleUserRes, userRes] = await Promise.all([
    roleNames.length
      ? sb.from('roles').select('name, label').in('name', roleNames)
      : Promise.resolve({ data: [] as { name: string; label: string | null }[], error: null }),
    // Only ACTIVE holders count: a role whose every holder is disabled has no
    // one to receive the work, so it cannot be a valid destination.
    roleNames.length
      ? sb.from('app_users').select('id, role').in('role', roleNames).eq('status', 'active')
      : Promise.resolve({ data: [] as { id: string; role: string }[], error: null }),
    userIds.length
      ? sb.from('app_users').select('id, full_name, display_name, username, role, status').in('id', userIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);
  if (roleRes.error) throw new Error(`Readiness owner role read failed: ${roleRes.error.message}`);
  if (roleUserRes.error) throw new Error(`Readiness owner role-holder read failed: ${roleUserRes.error.message}`);
  if (userRes.error) throw new Error(`Readiness owner user read failed: ${userRes.error.message}`);

  const roleLabels = new Map((roleRes.data as { name: string; label: string | null }[]).map(r => [r.name, r.label]));
  const holdersByRole = new Map<string, string[]>();
  for (const u of roleUserRes.data as { id: string; role: string }[]) {
    holdersByRole.set(u.role, [...(holdersByRole.get(u.role) ?? []), u.id]);
  }
  const usersById = new Map(
    (userRes.data as { id: string; full_name: string | null; display_name: string | null; username: string | null; role: string | null; status: string }[])
      .map(u => [u.id, u]),
  );

  // One capability lookup per distinct role, reused across domains.
  const rolePermissions = new Map<string, Set<string>>();
  const distinctRoles = new Set<string>(roleNames);
  for (const c of candidates) {
    if (c.ownerType === 'user') {
      const role = usersById.get(c.ownerId)?.role;
      if (role) distinctRoles.add(role);
    }
  }
  await Promise.all([...distinctRoles].map(async role => {
    rolePermissions.set(role, await loadRolePermissions(role));
  }));

  for (const c of candidates) {
    const capability = DOMAIN_COMPLETION_CAPABILITY[c.domain];

    if (c.ownerType === 'role') {
      if (!roleLabels.has(c.ownerId)) {
        out.set(c.domain, unresolved(c.domain, `The configured owner role "${c.ownerId}" no longer exists.`));
        continue;
      }
      const holders = holdersByRole.get(c.ownerId) ?? [];
      if (!holders.length) {
        out.set(c.domain, unresolved(c.domain, `No active user holds the configured owner role "${roleLabels.get(c.ownerId) ?? c.ownerId}".`));
        continue;
      }
      if (!rolePermissions.get(c.ownerId)?.has(capability)) {
        out.set(c.domain, unresolved(c.domain,
          `The configured owner role "${roleLabels.get(c.ownerId) ?? c.ownerId}" does not hold "${capability}", which is required to complete ${c.domain} readiness.`));
        continue;
      }
      out.set(c.domain, {
        domain: c.domain, status: 'resolved', ownerType: 'role', ownerId: c.ownerId,
        ownerLabel: roleLabels.get(c.ownerId) ?? c.ownerId, recipientUserIds: holders, reason: null,
      });
      continue;
    }

    const user = usersById.get(c.ownerId);
    if (!user) {
      out.set(c.domain, unresolved(c.domain, 'The configured owner user no longer exists.'));
      continue;
    }
    if (user.status !== 'active') {
      out.set(c.domain, unresolved(c.domain, 'The configured owner user is not active.'));
      continue;
    }
    if (!user.role || !rolePermissions.get(user.role)?.has(capability)) {
      out.set(c.domain, unresolved(c.domain,
        `The configured owner user does not hold "${capability}", which is required to complete ${c.domain} readiness.`));
      continue;
    }
    out.set(c.domain, {
      domain: c.domain, status: 'resolved', ownerType: 'user', ownerId: c.ownerId,
      ownerLabel: firstNonBlank(user.display_name, user.full_name, user.username) ?? c.ownerId,
      recipientUserIds: [c.ownerId], reason: null,
    });
  }

  return out;
}

/** Single-domain convenience wrapper. */
export async function resolveReadinessOwner(domain: ReadinessDomain): Promise<ReadinessOwnerResolution> {
  const map = await resolveReadinessOwners([domain]);
  return map.get(domain) ?? unresolved(domain, `No owner is configured for the ${domain} readiness area.`);
}

/**
 * Resolve an owner or refuse.
 *
 * Call this BEFORE opening the lifecycle transaction. Every readiness write that
 * routes work to someone goes through here, so "fail closed" is enforced in one
 * place rather than re-implemented per route.
 */
export async function requireReadinessOwner(domain: ReadinessDomain): Promise<ReadinessOwnerResolution> {
  const resolution = await resolveReadinessOwner(domain);
  if (resolution.status !== 'resolved') {
    throw new OwnerRequiredError(domain, resolution.reason ?? `No owner is configured for the ${domain} readiness area.`);
  }
  return resolution;
}
