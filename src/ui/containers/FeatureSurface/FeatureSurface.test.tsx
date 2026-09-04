import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { LucideIcon } from '../../LucideIcon';
import { FeatureSurface } from './FeatureSurface';

describe('FeatureSurface', () => {
  it('composes its copy, icon and interactive action without changing semantics', () => {
    render(
      <FeatureSurface
        icon={<LucideIcon name="MoonStar" />}
        eyebrow="Focus protected"
        title="Quiet Mode is on"
        description="Routine popups are paused."
        actions={<button type="button">Resume</button>}
      />,
    );

    expect(screen.getByText('Focus protected')).toBeTruthy();
    expect(screen.getByText('Quiet Mode is on')).toBeTruthy();
    expect(screen.getByText('Routine popups are paused.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
});
