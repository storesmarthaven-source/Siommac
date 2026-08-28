import { createContext, type ComponentChildren, type VNode } from 'preact';
import { useContext } from 'preact/hooks';
import type { OnboardingReadScope } from '../../../../../types/hrOnboarding';

const ScopeContext = createContext<OnboardingReadScope | undefined>(undefined);

export function OnboardingWidgetScopeProvider({
  scope,
  children,
}: {
  scope: OnboardingReadScope;
  children: ComponentChildren;
}): VNode {
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function useOnboardingWidgetScope(): OnboardingReadScope | undefined {
  return useContext(ScopeContext);
}
