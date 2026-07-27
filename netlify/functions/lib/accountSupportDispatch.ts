/**
 * netlify/functions/lib/accountSupportDispatch.ts
 *
 * Pure resolver for the account-support ownership-model → dispatch-destination
 * mapping. No database or I/O imports — the caller fetches the config from the
 * DB and passes it in as a plain object. This separation makes the mapping
 * independently testable without a live database or HTTP context.
 *
 * Ownership model → registered receiver mapping:
 *   hr_managed     → hr   (canonical; HR owns all account support intake)
 *   shared         → hr   (HR is primary intake; ownership context in the handoff payload)
 *   dedicated_team → hr   (pre-assigned to assignedUserId; hrReceiver creates the case)
 *   external_admin → FAIL CLOSED — no registered module receiver exists for an
 *                    external administrator. Callers must fail before any DB write.
 *
 * Registered module receivers (registerModules.ts): only 'hr', 'finance', 'operations'.
 * There is no hard-coded per-role authorization in this path — the ownership model
 * is an org-level configuration, not a user role.
 */

/** One of the three registered module receivers in registerModules.ts. */
export type TargetModule = 'hr' | 'finance' | 'operations';

export interface DispatchDestination {
  targetModule:   TargetModule;
  ownershipModel: string;
  assignedUserId: string | null;
}

export type DispatchResult =
  | { ok: true;  destination: DispatchDestination }
  | { ok: false; message: string };

/**
 * Map a fetched org_account_support_config row to a typed DispatchDestination.
 *
 * @param config          The raw org_account_support_config row (already fetched by caller).
 * @param assigneeActive  For dedicated_team: true = assignee is active, false = inactive.
 *                        Pass null for models that do not require an assignee check.
 */
export function resolveDispatchFromConfig(
  config: { ownership_model: string; assigned_user_id: string | null },
  assigneeActive: boolean | null,
): DispatchResult {
  const model = config.ownership_model;

  // external_admin has no registered module receiver — fail closed before any write.
  if (model === 'external_admin') {
    return {
      ok: false,
      message:
        'The "external_admin" ownership model has no registered automated dispatch target. ' +
        'An administrator must reconfigure account support to hr_managed, shared, or ' +
        'dedicated_team before requests can be routed.',
    };
  }

  if (model === 'dedicated_team') {
    if (!config.assigned_user_id) {
      return {
        ok: false,
        message:
          'Account support ownership model is "dedicated_team" but no assigned user is ' +
          'configured. An administrator must update the configuration.',
      };
    }
    if (assigneeActive === false) {
      return {
        ok: false,
        message:
          'The configured account support receiver is inactive. An administrator must ' +
          'update the configuration before requests can be routed.',
      };
    }
    // Route to HR module; hrReceiver creates a case pre-assigned to the dedicated person.
    return {
      ok: true,
      destination: {
        targetModule:   'hr',
        ownershipModel: 'dedicated_team',
        assignedUserId: config.assigned_user_id,
      },
    };
  }

  // hr_managed and shared both route to the HR module.
  // shared: HR is primary intake; ownership context carried in the handoff payload.
  return {
    ok: true,
    destination: {
      targetModule:   'hr',
      ownershipModel: model,
      assignedUserId: null,
    },
  };
}
