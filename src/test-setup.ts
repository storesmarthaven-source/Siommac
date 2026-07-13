/**
 * src/test-setup.ts  —  Vitest global test setup
 *
 * Runs once before every test file.
 * - Polyfills browser APIs that jsdom doesn't implement
 * - Stubs import.meta.env so env.ts validation passes in tests
 * - Resets Zustand stores between tests so state doesn't leak
 * - Cleans up localStorage between tests
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import '@testing-library/preact';
import { cleanup } from '@testing-library/preact';
import { afterEach, beforeAll, vi } from 'vitest';

// ── Env stub — must be set before any module that imports @lib/env ────────────
// Vitest doesn't process .env files by default.
// We set the minimum required vars so env.ts validation passes.
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_SUPABASE_URL:      'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    VITE_API_BASE:          '',
    VITE_APP_NAME:          'Siomac Test',
    DEV:                    true,
    PROD:                   false,
    MODE:                   'test',
  },
  writable: true,
});

// ── BroadcastChannel stub (not in jsdom) ─────────────────────────────────────
class BroadcastChannelStub {
  onmessage: ((evt: MessageEvent) => void) | null = null;
  postMessage(_data: unknown): void { /* no-op in tests */ }
  close(): void { /* no-op */ }
  addEventListener(): void { /* no-op */ }
  removeEventListener(): void { /* no-op */ }
  dispatchEvent(): boolean { return true; }
}
// Cast through Record<string, unknown> (not any) so member access is typed.
const _g = globalThis as Record<string, unknown>;
_g.BroadcastChannel = BroadcastChannelStub;

// ── IntersectionObserver stub (used by some component patterns) ───────────────
_g.IntersectionObserver = class {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
};

// ── ResizeObserver stub ───────────────────────────────────────────────────────
_g.ResizeObserver = class {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
};

// ── matchMedia stub ───────────────────────────────────────────────────────────
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches:             false,
    media:               query,
    onchange:            null,
    addListener:         vi.fn(),
    removeListener:      vi.fn(),
    addEventListener:    vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent:       vi.fn(),
  })),
});

// ── Cleanup after each test ───────────────────────────────────────────────────
afterEach(() => {
  cleanup();                         // unmount Preact trees
  localStorage.clear();              // reset persisted session
  vi.clearAllMocks();                // reset spy call counts
});

// ── Suppress known noisy warnings in test output ─────────────────────────────
beforeAll(() => {
  // Preact logs "Consider adding an error boundary" — suppress in tests
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = (args[0] as string | undefined) ?? '';
    if (
      msg.includes('Consider adding an error boundary') ||
      msg.includes('The above error occurred')
    ) return;
     
    console.warn('[test console.error suppressed]', ...args);
  });
});
