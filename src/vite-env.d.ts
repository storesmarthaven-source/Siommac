/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Typed Vite environment variables.
 *
 * All VITE_* variables declared here are inlined at build time.
 * Never put secrets here — these values are visible in the browser bundle.
 * Server-side secrets belong in Netlify environment variables only.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */
interface ImportMetaEnv {
  /** Supabase project URL — public, safe to expose */
  readonly VITE_SUPABASE_URL: string;

  /** Supabase anon key — public, safe to expose (RLS enforces security) */
  readonly VITE_SUPABASE_ANON_KEY: string;

  /** Optional: override the API base URL (defaults to '' = same origin) */
  readonly VITE_API_BASE?: string;

  /** App display name shown in UI and manifest */
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
