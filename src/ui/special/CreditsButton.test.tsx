import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { findComponent, BUTTON_FAMILY } from '../registry';
import { CreditsButton } from './CreditsButton';

const ROOT = resolvePath(__dirname, '../../..');
const read = (path: string): string => readFileSync(resolvePath(ROOT, path), 'utf8');

describe('Credits special treatment', () => {
  it('is a native named action whose decoration stays out of the accessibility tree', () => {
    const onClick = vi.fn();
    const { getByRole, container } = render(<CreditsButton onClick={onClick} />);
    const button = getByRole('button', { name: 'Credits' });

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button.classList.contains('ui-credits')).toBe(true);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  });

  it('honours native disabled behaviour', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<CreditsButton disabled onClick={onClick} />);
    const button = getByRole('button', { name: 'Credits' }) as HTMLButtonElement;

    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not enter the canonical registry, family or Button variant enum', () => {
    const variant = findComponent('button')?.props?.variant;
    expect(variant?.type === 'select' ? variant.options : []).toEqual([
      'primary', 'secondary', 'outline', 'ghost', 'danger', 'link',
    ]);
    expect(findComponent('credits')).toBeUndefined();
    expect(BUTTON_FAMILY.componentIds).not.toContain('credits');

    const buttonSource = read('src/ui/primitives/Button.tsx');
    expect(buttonSource).toContain(
      "export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';",
    );
    expect(buttonSource.toLowerCase()).not.toContain('credits');
  });

  it('uses flat SIOMAC-aware tokens and no purple or gradient styling', () => {
    const css = read('src/ui/special/credits.recipe.css');
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain('--ui-credits-bg: var(--ui-color-action-primary)');
    expect(css).toContain('var(--siomac-gold)');
    expect(css).toContain('var(--siomac-red)');
    expect(declarations).not.toMatch(/#[0-9a-f]{6}/i);
    expect(declarations).not.toMatch(/(?:linear|radial|conic)-gradient/i);
    expect(declarations).not.toMatch(/purple/i);
  });
});
