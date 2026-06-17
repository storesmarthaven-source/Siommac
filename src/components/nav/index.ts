/**
 * src/components/nav/index.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

export { mountNavController, unmountNavController } from './mount';
export { mountCommandPalette }                       from './CommandPalette';
export { scheduleHdrBadgeSync, doHdrBadgeSync }     from './badgeSync';
export {
  buildSidebar, buildTopTabs,
  showSection, refreshSection,
  applyPalette, applyLayout,
  renderPalettes, renderLayouts,
  savePalette, saveLayout,
  setHdrBadge, refreshNavBadges,
  getRole, getUser, getFullName, getProfileImage,
  getScheme, getLayout,
  allSectionItems,
  setSkel, skelStatValues, skelTableRows,
  skelStatCards, skelCards, skelList,
  esc,
} from './navCore';
