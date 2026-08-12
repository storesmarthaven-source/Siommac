/**
 * src/ui/overlays/portalRoot.ts — where portalled overlays actually mount.
 *
 * Every floating surface in the kit (Dialog, and every popup built on
 * AnchoredPopup — Select, Combobox, MultiSelect, Menu) portals out of its
 * invoking tree so it cannot be clipped by an ancestor's `overflow` or trapped
 * under a `z-index` stacking context. `document.body` is the right destination
 * in the application, and it is the default here.
 *
 * ── Why it needs to be overridable ──────────────────────────────────────────
 * The Gallery previews a DRAFT theme by setting custom properties on one
 * element, `[data-ui-preview-scope]`. Custom properties inherit, so everything
 * rendered INSIDE that element picks the draft up — and everything portalled to
 * `document.body` does not. The result was a workbench where changing the brand
 * repainted the Select's trigger but not the listbox that dropped out of it, and
 * the Dialog's invoking button but not the Dialog.
 *
 * The wrong fix is to write the draft to `:root`: that is precisely the defect
 * the draft layer exists to prevent — every slider drag would re-theme the live
 * application for the person using the workbench.
 *
 * The right fix is to let a themed region provide its own portal destination.
 * The Gallery renders one inside its preview scope and publishes it here; the
 * overlays ask for it and fall back to `document.body`. Application runtime
 * behaviour is unchanged, because nothing outside the Gallery provides a value.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

/**
 * The element portalled overlays mount into. `null` means "use `document.body`".
 *
 * Deliberately a plain element rather than a boolean "am I in a preview" flag:
 * the overlays should not know what a Gallery is, only where to render.
 */
export const PortalRootContext = createContext<HTMLElement | null>(null);

/** The attribute the Gallery's portal container carries, for tests and CSS. */
export const PREVIEW_PORTAL_ATTR = 'data-ui-preview-portal-root';

/**
 * Resolve the portal destination for the current tree.
 *
 * Returns `document.body` when no themed region has provided one — which is
 * every case in the application itself.
 */
export function usePortalRoot(): HTMLElement {
  return useContext(PortalRootContext) ?? document.body;
}
