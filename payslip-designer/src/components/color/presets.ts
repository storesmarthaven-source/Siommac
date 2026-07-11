export const COLOR_PRESETS: readonly string[] = [
  '#111a3a', '#1a2340', '#3b5bdb', '#4f6ef7', '#5b7cfa', '#8a5bf0', '#6366f1', '#0ea5e9', '#12a25a',
  '#7be0a6', '#f59e0b', '#e5484d', '#f472b6', '#b08d57', '#ffffff', '#f6f8fd', '#e5e8f0', '#8a93ab',
  '#6a7290', '#0b1020', '#141c33', '#5eead4', '#9dffce', '#c3d2ff', '#000000',
];

/** Session-scoped recent colours, most-recent first. */
const recents: string[] = [];

export function getRecents(): readonly string[] {
  return recents;
}

export function pushRecent(color: string): void {
  const idx = recents.findIndex((c) => c.toLowerCase() === color.toLowerCase());
  if (idx >= 0) recents.splice(idx, 1);
  recents.unshift(color);
  if (recents.length > 9) recents.length = 9;
}
