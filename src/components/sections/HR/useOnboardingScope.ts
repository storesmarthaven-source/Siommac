// src/components/sections/HR/useOnboardingScope.ts
//
// The ONE frontend source for onboarding read scope: which scopes this user may request,
// which is selected, and how a change is sequenced.
//
// The server is authoritative — `netlify/functions/lib/hr/onboardingScope.ts` resolves the
// visible case set and 403s an unauthorised scope. This hook only decides what to OFFER and
// what to ASK for. It never filters rows; a scope the user lacks is simply not rendered, and
// if one were requested anyway the request fails closed at the API.

import { useCallback, useMemo, useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import type { OnboardingReadScope } from '../../../../types/hrOnboarding';

export interface OnboardingScopeOption {
  key: OnboardingReadScope;
  label: string;
}

/** Labels are fixed copy; availability is permission-driven. */
const ALL_OPTIONS: readonly OnboardingScopeOption[] = [
  { key: 'my',   label: 'My Work' },
  { key: 'team', label: 'Team Work' },
  { key: 'all',  label: 'All Onboarding' },
];

/** Scopes this user may request. `my` is always available under base `hr.onboarding.view`. */
export function availableOnboardingScopes(): OnboardingScopeOption[] {
  return ALL_OPTIONS.filter(o =>
    o.key === 'my'
    || (o.key === 'team' && can('hr.onboarding.view_team'))
    || (o.key === 'all'  && can('hr.onboarding.view_all')));
}

export interface OnboardingScopeState {
  /** The scope the data currently shown was loaded for. */
  scope: OnboardingReadScope;
  options: OnboardingScopeOption[];
  /** Hide the control entirely when there is nothing to choose between. */
  visible: boolean;
  /** True from the moment a change is requested until the new scope's data is ready. */
  changing: boolean;
  select: (next: OnboardingReadScope) => void;
  /** Call once the new scope's required queries have settled. */
  settled: () => void;
}

/**
 * Scope state for a page.
 *
 * ALWAYS starts at `my`, regardless of the widest scope the user holds. Defaulting a manager
 * to `all` would silently widen every read on first paint and make the same page behave
 * differently for two roles — the server makes the same choice for the same reason.
 */
export function useOnboardingScope(): OnboardingScopeState {
  const options = useMemo(availableOnboardingScopes, []);
  const [scope, setScope] = useState<OnboardingReadScope>('my');
  const [changing, setChanging] = useState(false);

  const select = useCallback((next: OnboardingReadScope) => {
    if (next === scope) return;
    // Guard in depth: never request a scope this user cannot hold, even if a stale render
    // or tampered control emits one. The server would 403 anyway; this keeps the UI honest.
    if (!options.some(o => o.key === next)) return;
    setChanging(true);
    setScope(next);
  }, [scope, options]);

  const settled = useCallback(() => setChanging(false), []);

  return {
    scope,
    options,
    // One option means no decision to make — render nothing rather than a dead control.
    visible: options.length > 1,
    changing,
    select,
    settled,
  };
}
