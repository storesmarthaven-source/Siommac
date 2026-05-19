/**
 * vitest.config.ts  —  Frontend test configuration
 *
 * Runs all *.test.tsx / *.test.ts files under src/.
 * Uses jsdom so Preact components can mount against a real DOM.
 *
 * Alias resolution mirrors vite.config.ts exactly so imports like
 * '@lib/logger' resolve identically in tests and in production.
 *
 * ORDERING RULE: explicit sub-path entries MUST appear before bare aliases.
 * Vite walks resolve.alias in array order; a bare '@lib' entry would match
 * '@lib/logger' as a prefix before the explicit '@lib/logger' entry is reached.
 */

import { defineConfig } from 'vitest/config';
import preact           from '@preact/preset-vite';
import { resolve }      from 'path';

export default defineConfig({
  plugins: [
    preact({
      // Disable the hook-names debug transform in tests — it depends on
      // `zimmerframe` which has a package.json exports mismatch with Vitest.
      devToolsEnabled: false,
    }),
  ],

  test: {
    // Only pick up frontend tests — exclude the legacy Jest test directory
    include:     ['src/**/*.test.{ts,tsx}'],
    exclude:     ['tests/**', 'node_modules/**'],
    environment: 'jsdom',
    globals:     true,           // describe / it / expect without imports
    setupFiles:  ['src/test-setup.ts'],

    // Provide the minimum required VITE_ vars so env.ts validation passes.
    // These are set at the Vite/Vitest level (not just import.meta) so they
    // are available even when env.ts executes during module graph resolution
    // before test-setup.ts's Object.defineProperty runs.
    env: {
      VITE_SUPABASE_URL:      'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_BASE:          '',
      VITE_APP_NAME:          'Siomac Test',
    },

    // Inline zustand so its internal `import 'react'` flows through our
    // resolve.alias and resolves to preact/compat instead of bare react.
    server: {
      deps: {
        inline: ['zustand'],
      },
    },

    coverage: {
      provider:  'v8',
      include:   ['src/**/*.{ts,tsx}'],
      exclude:   ['src/test-setup.ts', 'src/**/*.d.ts', 'src/main.tsx'],
      reporter:  ['text', 'lcov'],
      thresholds: {
        lines:      70,
        functions:  70,
        branches:   60,
        statements: 70,
      },
    },
  },

  resolve: {
    alias: [
      // ── Preact compat (most-specific first) ───────────────────────────────
      { find: 'react-dom/test-utils', replacement: 'preact/test-utils' },
      { find: 'react/jsx-runtime',    replacement: 'preact/jsx-runtime' },
      { find: 'react-dom',            replacement: 'preact/compat'      },
      { find: 'react',                replacement: 'preact/compat'      },

      // ── @lib sub-paths (BEFORE bare @lib) ─────────────────────────────────
      { find: '@lib/api',           replacement: resolve(__dirname, 'src/lib/api')           },
      { find: '@lib/logger',        replacement: resolve(__dirname, 'src/lib/logger')        },
      { find: '@lib/session',       replacement: resolve(__dirname, 'src/lib/session')       },
      { find: '@lib/env',           replacement: resolve(__dirname, 'src/lib/env')           },
      { find: '@lib/appState',      replacement: resolve(__dirname, 'src/lib/appState')      },
      { find: '@lib/cache',         replacement: resolve(__dirname, 'src/lib/cache')         },
      { find: '@lib/popup',         replacement: resolve(__dirname, 'src/lib/popup')         },
      { find: '@lib/charts',        replacement: resolve(__dirname, 'src/lib/charts')        },
      { find: '@lib/apiLegacy',     replacement: resolve(__dirname, 'src/lib/apiLegacy')     },
      { find: '@lib/attSystem',     replacement: resolve(__dirname, 'src/lib/attSystem')     },
      { find: '@lib/notifications', replacement: resolve(__dirname, 'src/lib/notifications') },
      { find: '@lib/queryClient',   replacement: resolve(__dirname, 'src/lib/queryClient')   },
      { find: '@lib/supabase',      replacement: resolve(__dirname, 'src/lib/supabase')      },
      { find: '@lib/permissions',   replacement: resolve(__dirname, 'src/lib/permissions')   },

      // ── @store sub-paths (BEFORE bare @store) ─────────────────────────────
      { find: '@store/data',          replacement: resolve(__dirname, 'src/store/data')          },
      { find: '@store/ui',            replacement: resolve(__dirname, 'src/store/ui')            },
      { find: '@store/session',       replacement: resolve(__dirname, 'src/store/session')       },
      { find: '@store/realtime',      replacement: resolve(__dirname, 'src/store/realtime')      },
      { find: '@store/notifications', replacement: resolve(__dirname, 'src/store/notifications') },

      // ── @shared sub-paths (BEFORE bare @shared) ───────────────────────────
      { find: '@shared/ErrorBoundary', replacement: resolve(__dirname, 'src/components/shared/ErrorBoundary') },
      { find: '@shared/Modal',         replacement: resolve(__dirname, 'src/components/shared/Modal')         },
      { find: '@shared/Spinner',       replacement: resolve(__dirname, 'src/components/shared/Spinner')       },
      { find: '@shared/Toast',         replacement: resolve(__dirname, 'src/components/shared/Toast')         },
      { find: '@shared/Avatar',        replacement: resolve(__dirname, 'src/components/shared/Avatar')        },
      { find: '@shared/Badge',         replacement: resolve(__dirname, 'src/components/shared/Badge')         },
      { find: '@shared/ConfirmDialog', replacement: resolve(__dirname, 'src/components/shared/ConfirmDialog') },
      { find: '@shared/DataTable',     replacement: resolve(__dirname, 'src/components/shared/DataTable')     },
      { find: '@shared/AuthGate',     replacement: resolve(__dirname, 'src/components/shared/AuthGate')      },

      // ── @cfg sub-paths (BEFORE bare @cfg) ─────────────────────────────────
      { find: '@cfg/index', replacement: resolve(__dirname, 'src/config/index') },

      // ── @sections sub-paths (BEFORE bare @sections) ───────────────────────
      { find: '@sections/Employees',    replacement: resolve(__dirname, 'src/components/sections/Employees')    },
      { find: '@sections/Attendance',  replacement: resolve(__dirname, 'src/components/sections/Attendance')  },
      { find: '@sections/AdminLeave',  replacement: resolve(__dirname, 'src/components/sections/AdminLeave')  },
      { find: '@sections/Profile',     replacement: resolve(__dirname, 'src/components/sections/Profile')     },
      { find: '@sections/Settings',    replacement: resolve(__dirname, 'src/components/sections/Settings')    },
      { find: '@sections/HourlyRates',  replacement: resolve(__dirname, 'src/components/sections/HourlyRates')  },
      { find: '@sections/Payroll',      replacement: resolve(__dirname, 'src/components/sections/Payroll')      },
      { find: '@sections/Dashboard',    replacement: resolve(__dirname, 'src/components/sections/Dashboard')    },
      { find: '@sections/LiveMap',         replacement: resolve(__dirname, 'src/components/sections/LiveMap')         },
      { find: '@sections/ProjectSites',         replacement: resolve(__dirname, 'src/components/sections/ProjectSites')         },
      { find: '@sections/AttendanceDashboard', replacement: resolve(__dirname, 'src/components/sections/AttendanceDashboard') },

      // ── @shell sub-paths (BEFORE bare @shell) ─────────────────────────────
      { find: '@shell', replacement: resolve(__dirname, 'src/shell/index.ts') },

      // ── @api sub-paths ────────────────────────────────────────────────────
      { find: /^@api\/(.+)$/, replacement: resolve(__dirname, 'src/api/$1')   },
      { find: '@api',         replacement: resolve(__dirname, 'src/api/index.ts') },

      // ── @components sub-paths ─────────────────────────────────────────────
      { find: '@components/auth',     replacement: resolve(__dirname, 'src/components/auth')     },
      { find: '@components/nav',      replacement: resolve(__dirname, 'src/components/nav')      },
      { find: '@components/realtime', replacement: resolve(__dirname, 'src/components/realtime') },
      { find: '@components/livemap',  replacement: resolve(__dirname, 'src/components/livemap')  },

      // ── Bare aliases (LAST — fallback for index-file imports) ─────────────
      { find: '@store',    replacement: resolve(__dirname, 'src/store/index.ts')         },
      { find: '@cfg',      replacement: resolve(__dirname, 'src/config/index.ts')        },
      { find: '@lib',      replacement: resolve(__dirname, 'src/lib/index.ts')           },
      { find: '@shared',   replacement: resolve(__dirname, 'src/components/shared')      },
      { find: '@sections', replacement: resolve(__dirname, 'src/components/sections')    },
      { find: '@',         replacement: resolve(__dirname, 'src')                        },
    ],
  },
});
