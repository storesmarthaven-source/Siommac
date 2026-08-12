/**
 * src/ui/overlays/portalRoot.test.tsx
 *
 * Portalled overlays must mount inside a themed region's portal root when one
 * is provided, and inside `document.body` when one is not.
 *
 * The defect: the Gallery previews a draft theme by setting custom properties on
 * `[data-ui-preview-scope]`. Custom properties inherit, so a Select's trigger
 * picked the draft up and the listbox it opened — portalled to `document.body` —
 * did not. Changing the brand repainted half the workbench.
 *
 * jsdom cannot compute the custom-property cascade, so this asserts the thing
 * that actually decides it: WHERE the overlay mounts. The colour propagation
 * itself is verified in the browser.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { type VNode } from 'preact';
import { Dialog } from './Dialog';
import { PortalRootContext, PREVIEW_PORTAL_ATTR } from './portalRoot';
import { PREVIEW_SCOPE_ATTR } from '../theme/applyTheme';

/** These tests assert WHERE an overlay mounts; dismissal is Dialog's own suite. */
function noop(): void { /* intentionally empty */ }

function Scoped({ root, children }: { root: HTMLElement | null; children: VNode }): VNode {
  return <PortalRootContext.Provider value={root}>{children}</PortalRootContext.Provider>;
}

describe('portal root', () => {
  it('mounts a Dialog in document.body when no themed region provides a root', () => {
    render(<Dialog open onClose={noop}><p>body</p></Dialog>);
    const panel = document.body.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel?.closest(`[${PREVIEW_PORTAL_ATTR}]`)).toBeNull();
  });

  it('mounts a Dialog inside the provided portal root instead', () => {
    const { container } = render(<div />);
    const scope = document.createElement('div');
    scope.setAttribute(PREVIEW_SCOPE_ATTR, 'true');
    const portal = document.createElement('div');
    portal.setAttribute(PREVIEW_PORTAL_ATTR, 'true');
    scope.appendChild(portal);
    container.appendChild(scope);

    render(<Scoped root={portal}><Dialog open onClose={noop}><p>scoped</p></Dialog></Scoped>, { container });

    const panel = portal.querySelector('[role="dialog"]');
    expect(panel, 'dialog did not mount in the provided portal root').not.toBeNull();
    // The property that makes theming work: it is a DESCENDANT of the scope, so
    // it inherits whatever custom properties the draft set there.
    expect(scope.contains(panel)).toBe(true);
  });

  it('inherits custom properties set on the scope — the reason the root exists', () => {
    const { container } = render(<div />);
    const scope = document.createElement('div');
    scope.setAttribute(PREVIEW_SCOPE_ATTR, 'true');
    scope.style.setProperty('--ui-color-action-primary', '#0F766E');
    const portal = document.createElement('div');
    scope.appendChild(portal);
    container.appendChild(scope);

    render(<Scoped root={portal}><Dialog open onClose={noop}><p>scoped</p></Dialog></Scoped>, { container });

    const panel = portal.querySelector<HTMLElement>('[role="dialog"]')!;
    // Walk to the scope: inheritance is a DOM-ancestry fact, which jsdom models
    // faithfully even though it will not compute the resulting colour.
    expect(panel.closest(`[${PREVIEW_SCOPE_ATTR}]`)).toBe(scope);
    expect(document.documentElement.style.getPropertyValue('--ui-color-action-primary')).toBe('');
  });

  it('closing removes the overlay from the portal root', () => {
    const { container } = render(<div />);
    const portal = document.createElement('div');
    container.appendChild(portal);

    function Harness({ open }: { open: boolean }): VNode {
      return <Scoped root={portal}><Dialog open={open} onClose={noop}><p>x</p></Dialog></Scoped>;
    }
    render(<Harness open />, { container });
    expect(portal.querySelector('[role="dialog"]')).not.toBeNull();
    render(<Harness open={false} />, { container });
    expect(portal.querySelector('[role="dialog"]')).toBeNull();
  });
});
