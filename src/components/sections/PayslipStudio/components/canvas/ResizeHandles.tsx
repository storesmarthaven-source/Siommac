import type { ResizeDir } from '@payslip/lib/geometry';

const ALL: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HORIZONTAL: ResizeDir[] = ['w', 'e'];

export function ResizeHandles({
  divider,
  onStart,
}: {
  divider: boolean;
  onStart: (dir: ResizeDir, e: PointerEvent) => void;
}) {
  const dirs = divider ? HORIZONTAL : ALL;
  return (
    <>
      {dirs.map((dir) => (
        <div
          key={dir}
          class={`handle ${dir}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onStart(dir, e);
          }}
        />
      ))}
    </>
  );
}
