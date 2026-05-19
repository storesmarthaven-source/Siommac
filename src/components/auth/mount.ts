/**
 * src/components/auth/mount.ts
 *
 * Mount / unmount the LoginPage headless controller.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h }                    from 'preact';
import { render }               from 'preact';
import { QueryClientProvider }  from '@tanstack/preact-query';
import type { QueryClient }     from '@tanstack/preact-query';
import { LoginPage }            from './LoginPage';
import type { LoginResult }     from './api';

export function mountLoginPage(
  container:  Element,
  opts: {
    queryClient:    QueryClient;
    onLoginSuccess: (result: LoginResult) => void;
  },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(LoginPage, { onLoginSuccess: opts.onLoginSuccess }),
    ),
    container,
  );
}

export function unmountLoginPage(container: Element): void {
  render(null, container);
}
