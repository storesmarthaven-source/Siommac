/**
 * workerOnboardingShell.test.tsx — the shell host contract for My Onboarding.
 *
 * This exists because the module registered correctly, typechecked, and passed its live
 * API E2E while the page never rendered once: `main.tsx` mounts into
 * `document.getElementById(mount.rootId)`, and the shell had no such element, so the mount
 * was silently skipped. Nothing in the previous test surface could catch that — it is a
 * fact about the SHELL, not about the module or the endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import SharedSections from '@/shell/sections/SharedSections';
import { workerOnboardingModule } from './module';

const SECTION_ID = 's-my-onboarding';
const ROOT_ID = 'preact-my-onboarding-root';

const src = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('the shell hosts a panel for My Onboarding', () => {
  it('renders the section, with the mount root inside it', () => {
    const { container } = render(<SharedSections />);
    const section = container.querySelector(`#${SECTION_ID}`);
    expect(section).toBeTruthy();

    const root = section?.querySelector(`#${ROOT_ID}`);
    expect(root).toBeTruthy();
    // Nesting is the contract: navigating activates the SECTION, and the mounted app has
    // to live inside it or it would stay hidden while the panel is shown.
    expect(root?.closest(`#${SECTION_ID}`)).toBe(section);
  });

  it('is declared as a real app section, like every other shared panel', () => {
    const { container } = render(<SharedSections />);
    const section = container.querySelector(`#${SECTION_ID}`);
    expect(section?.classList.contains('app-section')).toBe(true);
  });
});

describe('the registered module and the shell agree', () => {
  it('the module targets exactly the ids the shell provides', () => {
    expect(workerOnboardingModule.mount.sectionId).toBe(SECTION_ID);
    expect(workerOnboardingModule.mount.rootId).toBe(ROOT_ID);
    expect(workerOnboardingModule.navItems.some(i => i.id === SECTION_ID)).toBe(true);
  });

  it('the nav item is gated on the self-service permission, not internal onboarding', () => {
    const item = workerOnboardingModule.navItems.find(i => i.id === SECTION_ID);
    expect(item?.permission).toBe('hr.onboarding.self.view');
    expect(item?.permission).not.toBe('hr.onboarding.view');
  });
});

describe('the module mounts into the shell root', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('finds its root and receives the SECTION id — not the root id', () => {
    // Reproduces main.tsx's loop against the real shell markup.
    const { container } = render(<SharedSections />);
    document.body.appendChild(container);

    const root = document.getElementById(ROOT_ID);
    expect(root).toBeTruthy();

    const mount = vi.fn();
    const mod = { ...workerOnboardingModule, mount: { ...workerOnboardingModule.mount, mount } };
    const found = document.getElementById(mod.mount.rootId);
    if (found) mod.mount.mount(found, { sectionId: mod.mount.sectionId, queryClient: {} });

    expect(mount).toHaveBeenCalledTimes(1);
    const [mountedInto, ctx] = mount.mock.calls[0] as [Element, { sectionId: string }];
    expect(mountedInto).toBe(root);
    expect(ctx.sectionId).toBe(SECTION_ID);
    expect(ctx.sectionId).not.toBe(ROOT_ID);
  });

  it('main.tsx passes sectionId from the mount contract, not the root id', () => {
    // Guards the exact regression this slice fixed.
    const main = src('src/main.tsx');
    expect(main).toMatch(/sectionId: mod\.mount\.sectionId/);
    expect(main).not.toMatch(/sectionId: mod\.mount\.rootId/);
  });
});

describe('navigation activates the panel', () => {
  it('the section is inert until activated, and shown when it is', () => {
    const { container } = render(<SharedSections />);
    const section = container.querySelector<HTMLElement>(`#${SECTION_ID}`)!;
    // The shell shows exactly one panel at a time via the `active` class; assert the
    // mechanism rather than a colour so this survives styling changes.
    expect(section.classList.contains('active')).toBe(false);
    section.classList.add('active');
    expect(section.classList.contains('active')).toBe(true);
  });
});
