// src/ui/LucideIcon.tsx — render a Lucide line icon as a Preact component.
//
// Lucide is the app's STANDARD icon set. The `lucide` package exports each icon as an
// IconNode (`[tag, attrs][]`); here we build that into an inline <svg> so icons can be
// used directly in JSX (the sidebar renders them to DOM strings instead — see navIcons.ts).
// Colour follows `currentColor` (set via CSS `color`); size and stroke width are overridable.
import { h } from 'preact';
import type { VNode, JSX } from 'preact';
import * as lucide from 'lucide';

type IconNode = [string, Record<string, string | number>][];
export type LucideName = keyof typeof lucide;

export function LucideIcon(
  { name, size = 24, strokeWidth = 2, class: cls, style, title }: {
    name: LucideName;
    size?: number;
    strokeWidth?: number;
    class?: string;
    style?: JSX.CSSProperties;
    /** Accessible label — omit for decorative icons (they get aria-hidden). */
    title?: string;
  },
): VNode {
  const node = lucide[name] as unknown as IconNode | undefined;
  const children = (node ?? []).map(([tag, attrs], i) => h(tag, { ...attrs, key: i }));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width={strokeWidth}
      stroke-linecap="round" stroke-linejoin="round"
      class={cls} style={style}
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}
    >
      {children}
    </svg>
  );
}
