// src/ui/widgets/serializeLayout.ts — capture a live board arrangement as ready-to-paste
// `defInst(...)` code, so a hand-tuned layout can be hard-coded as a page's default. Generic
// (emits the raw widgetId string), so it works for ANY board — not just one page's constants.
import type { WidgetInstance } from './types';

export function serializeBoardLayout(items: WidgetInstance[]): string {
  const rows = [...items]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(w => {
      const id = `'${w.widgetId}'`.padEnd(42);
      const n = (v: number): string => String(v).padStart(2);
      return `        defInst(${id}, ${n(w.x)}, ${n(w.y)}, ${n(w.w)}, ${n(w.h)}, '${w.sizeKey}'),`;
    });
  return `      main: [\n${rows.join('\n')}\n      ],`;
}
