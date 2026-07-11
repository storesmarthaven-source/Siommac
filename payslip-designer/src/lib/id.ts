let counter = 0;

/** Monotonic element id. Reseeded from a design on import so ids stay unique. */
export function nextId(): string {
  counter += 1;
  return `el${counter}`;
}

export function reseedIds(ids: readonly string[]): void {
  let max = 0;
  for (const id of ids) {
    const n = parseInt(id.replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  counter = max;
}
