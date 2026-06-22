/**
 * src/components/sections/HSE/_shared.tsx — COMPATIBILITY SHIM.
 *
 * The HSE shared primitives have been promoted into the app-wide design system
 * at `src/ui` (`@ui`). This file now just re-exports them under their original
 * names so existing HSE pages keep working unchanged during the migration.
 *
 * NEW CODE: import from '@ui' directly. This shim is removed once every HSE
 * page has been repointed (UI framework Phase C).
 */

export {
  // Page-shape
  AreaHero, AreaTabs, withCounts, SectionHead,
  // Cards
  SparkCard, MiniCard, RecordRow, Record,
  // Overlays (standard window)
  HseModal, HseDrawer,
  // Forms
  Field, TextInput, SelectInput, TextareaInput,
  // Types
  type AreaTab, type SparkDef, type HeroStatDef, type HeroFooterItem,
  type HeroMetric, type HeroBadge, type DrawerDetail,
} from '@ui';
