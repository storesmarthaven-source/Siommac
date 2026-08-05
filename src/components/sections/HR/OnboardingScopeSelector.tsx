// src/components/sections/HR/OnboardingScopeSelector.tsx
//
// The My / Team / All control for onboarding surfaces. Built on the shared `Tabs` primitive
// from @ui — not a local segmented control — so it inherits the app's tab styling, keyboard
// behaviour and active treatment.
//
// It renders NOTHING when the user holds only `my`: a single-option control is a dead
// affordance that implies an authority the user does not have. Hidden authority is not
// represented by a disabled button (production UX audit).

import { type VNode } from 'preact';
import { Tabs } from '@ui';
import type { OnboardingReadScope } from '../../../../types/hrOnboarding';
import type { OnboardingScopeOption } from './useOnboardingScope';

export interface OnboardingScopeSelectorProps {
  scope: OnboardingReadScope;
  options: OnboardingScopeOption[];
  visible: boolean;
  onSelect: (next: OnboardingReadScope) => void;
  /** Disabled while the newly selected scope is still loading, so a second change cannot race. */
  busy?: boolean;
}

export function OnboardingScopeSelector({
  scope, options, visible, onSelect, busy = false,
}: OnboardingScopeSelectorProps): VNode | null {
  if (!visible) return null;

  return (
    <div
      class="obv-scope-switch"
      role="group"
      aria-label="Onboarding work scope"
      aria-busy={busy ? 'true' : 'false'}
    >
      <Tabs<OnboardingReadScope>
        tabs={options.map(o => ({ key: o.key, label: o.label }))}
        active={scope}
        onChange={next => { if (!busy) onSelect(next); }}
      />
    </div>
  );
}
