/**
 * src/ui/layouts/ModulePageLayout.tsx
 *
 * The STANDARD MODULE PAGE shape for the whole ERP:
 *
 *   ┌ PageHero      — 4 dark stat cards + KPI footer ┐
 *   ├ SparkCard row — optional 4-up metric strip       ┤
 *   ├ ModuleTabs    — navigation tabs                   ┤
 *   └ content       — the active tab's body            ┘
 *
 * Every module page (HSE areas, HR, Finance, Operations, Reports) is built from
 * this so the app feels like one product. Hero + tabs are required; the spark
 * row and content are provided by the page.
 *
 * This is a thin composition over `PageHero`, `SparkCard` and `ModuleTabs` —
 * pages may also lay these out by hand when they need a bespoke arrangement.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { PageHero, type PageHeroProps } from '../components/PageHero';
import { SparkCard, type SparkDef } from '../components/SparkCard';
import { ModuleTabs, type ModuleTabsProps } from '../components/ModuleTabs';

export interface ModulePageLayoutProps {
  hero: PageHeroProps;
  /** Optional 4-up metric row rendered between the hero and the tabs. */
  sparks?: SparkDef[];
  tabs: ModuleTabsProps;
  /** The active tab's body. */
  children: ComponentChildren;
}

export function ModulePageLayout({ hero, sparks, tabs, children }: ModulePageLayoutProps): VNode {
  return (
    <div class="hse-tab hse-dash">
      <PageHero {...hero} />

      {sparks && sparks.length > 0 && (
        <div class="hse-spark-grid">
          {sparks.map((s, i) => <SparkCard key={i} spark={s} />)}
        </div>
      )}

      <ModuleTabs {...tabs} />

      {children}
    </div>
  );
}
