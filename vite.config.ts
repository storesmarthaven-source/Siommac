import { defineConfig } from 'vite';
import preact           from '@preact/preset-vite';
import { VitePWA }      from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // react-grid-layout (+ react-draggable/-resizable) read `process.env.NODE_ENV` at runtime
  // for dev warnings; the browser has no `process`, so define it (mode-aware) or the board
  // crashes with "process is not defined". Only NODE_ENV is defined (the only key those deps
  // read) to avoid clobbering the whole process.env object.
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
  plugins: [
    preact({
      // Disable the hook-names debug transform in dev mode — it depends on
      // `zimmerframe` which has a package.json exports map incompatible with
      // Node's CJS loader, causing "No exports main defined" errors in the
      // dev server. The production build is unaffected (Rolldown handles ESM
      // natively). DevTools still work; only the hook-name annotation is off.
      devToolsEnabled: false,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      filename:     'sw.js',
      // Self-destroying by default: the SW unregisters itself + clears all caches on
      // load, so heavy dev iteration (chunk-hash churn) can never leave the browser
      // stuck on a stale bundle. Build with PWA=on to ship the real caching PWA in prod.
      selfDestroying: process.env.PWA !== 'on',
      manifest: {
        name:             'Siomac',
        short_name:       'Siomac',
        theme_color:      '#1B2D55',
        background_color: '#1B2D55',
        display:          'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.datatables\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//,
            handler:    'CacheFirst',
            options: {
              cacheName:  'cdn-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],

  build: {
    outDir:    'dist',
    emptyOutDir: false,   // backend writes dist/netlify — only wipe assets manually
    target:    'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split each section directory into its own chunk to avoid a single
        // 600 kB+ blob that causes OOM crashes on low-memory devices.
        manualChunks(id) {
          // Per-section chunks — extract the section folder name
          const secMatch = id.match(/\/sections\/([^/]+)\//);
          if (secMatch) return `sec-${secMatch[1].toLowerCase()}`;
          if (id.includes('@tanstack'))  return 'query';
          if (id.includes('flatpickr')) return 'flatpickr';
          if (id.includes('sortablejs'))return 'sortable';
          if (id.includes('zustand'))   return 'zustand';
        },
        entryFileNames: 'assets/bundle.[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
      // CDN globals — NOT bundled
      external: [],
    },
  },

  resolve: {
    alias: [
      // Preact compat — allows any library importing 'react' to use Preact
      { find: 'react-dom/test-utils', replacement: 'preact/test-utils'  },
      { find: 'react/jsx-runtime',    replacement: 'preact/jsx-runtime'  },
      { find: 'react-dom',            replacement: 'preact/compat'        },
      { find: 'react',                replacement: 'preact/compat'        },

      // ── @api ─────────────────────────────────────────────────────────────────
      { find: /^@api\/(.+)$/,   replacement: '/src/api/$1'   },
      { find: /^@api$/,         replacement: '/src/api/index.ts' },

      // ── Sub-path (prefix) aliases — MUST come before bare aliases ──────────
      // String-based find does prefix matching in Vite, so bare '@store' would
      // swallow '@store/session' before the sub-path entry is reached.
      // Using exact regexes here guarantees the right entry fires first.
      { find: /^@store\/(.+)$/,      replacement: '/src/store/$1'               },
      { find: /^@lib\/(.+)$/,        replacement: '/src/lib/$1'                 },
      { find: /^@shared\/(.+)$/,     replacement: '/src/components/shared/$1'   },
      { find: /^@sections\/(.+)$/,   replacement: '/src/components/sections/$1' },
      { find: /^@ui\/(.+)$/,         replacement: '/src/ui/$1'                  },
      { find: /^@components\/(.+)$/, replacement: '/src/components/$1'          },
      { find: /^@cfg\/(.+)$/,        replacement: '/src/config/$1'              },
      { find: /^@shell\/(.+)$/,      replacement: '/src/shell/$1'               },
      { find: /^@\/(.+)$/,           replacement: '/src/$1'                     },

      // ── Bare aliases — exact-match regexes (AFTER sub-path aliases) ─────────
      { find: /^@store$/,  replacement: '/src/store/index.ts'  },
      { find: /^@cfg$/,    replacement: '/src/config/index.ts' },
      { find: /^@lib$/,    replacement: '/src/lib/index.ts'    },
      { find: /^@ui$/,     replacement: '/src/ui/index.ts'     },
      { find: /^@shell$/,  replacement: '/src/shell/index.ts'  },
      { find: /^@$/,       replacement: '/src'                 },
    ],
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy /api to Netlify Dev (port 8888) in development
      '/api': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
}));
