/** Display the command-palette shortcut using the visitor's operating system. */
export function searchShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K';
}
