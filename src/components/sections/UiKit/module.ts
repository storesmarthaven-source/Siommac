/**
 * src/components/sections/UiKit/module.ts
 *
 * UI Kit — the design-system workbench, as a TOP-LEVEL section.
 *
 * It used to live at Settings ▸ Administration ▸ UI Kit, inside the Settings
 * console shell. That was wrong for what this screen is: the shell capped it at
 * ~840px of a 1280px window, so the three-pane workbench had ~310px of canvas
 * and a 560px dialog preview rendered at 221px. A tool for judging component
 * geometry cannot be shown in a box that changes the geometry.
 *
 * As a top-level module it gets the full content area, and its own sidebar —
 * both the app rail entry here, and the component navigation inside the gallery.
 *
 * Superadmin-only: it can publish tokens app-wide.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountUiKitSection, unmountUiKitSection } from './mount';

const UI_KIT_ROOT_ID = 'preact-ui-kit-root';

const ITEMS: ModuleNavItem[] = [
  {
    id: 's-ui-kit',
    label: 'UI Kit',
    icon: 'fa-palette',
    sub: 'Design-system workbench — canonical components, tokens and recipes',
    roles: ['superadmin'],
  },
];

export const uiKitModule: ModuleDefinition = {
  id: 'ui-kit',
  /**
   * The FLAT top group, not `administration`.
   *
   * Administration sits below Finance (15), HSE (17), HR (13) and Access
   * Control (8) — the UI Kit row rendered 2,895px down a 3,051px sidebar, which
   * is indistinguishable from not existing. Module groups are inserted *before*
   * `administration`, so giving it a group of its own would have been equally
   * deep.
   *
   * It is superadmin-only, so it costs no one else a nav row, and it is a tool
   * you open deliberately rather than something you route through.
   */
  navGroup: { id: 'overview', label: '' },
  navItems: ITEMS,
  roles: ['superadmin'],
  mount: {
    sectionId: 's-ui-kit',
    rootId:    UI_KIT_ROOT_ID,
    mount:   (root, ctx) => mountUiKitSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountUiKitSection(root),
  },
  visibilityNamespace: 'ui-kit',
};

registerModule(uiKitModule);
