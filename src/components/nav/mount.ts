/**
 * src/components/nav/mount.ts
 *
 * Renders NavController into a hidden host element.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, render } from 'preact';
import { NavController } from './NavController';

export function mountNavController(container: Element): void {
  render(h(NavController, null), container);
}

export function unmountNavController(container: Element): void {
  render(null, container);
}
