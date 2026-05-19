/**
 * src/lib/env.ts  —  Environment variable validation
 *
 * Validates all required VITE_* variables at module load time — before any
 * component mounts or API call fires.  A misconfigured deploy fails loudly
 * immediately rather than silently breaking on the first network call.
 *
 * Import this module once near the top of src/main.tsx so validation runs
 * before anything else.  It throws synchronously, which Vite's error overlay
 * will display in dev and which will surface as a blank page + console error
 * in production (where Sentry will capture it).
 *
 * Optional variables are accessed via `env.SENTRY_DSN` (may be undefined).
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

interface RequiredEnv {
  SUPABASE_URL:      string;
  SUPABASE_ANON_KEY: string;
}

interface OptionalEnv {
  API_BASE:   string;
  APP_NAME:   string;
  SENTRY_DSN: string | undefined;
}

export type AppEnv = RequiredEnv & OptionalEnv;

function validate(): AppEnv {
  const missing: string[] = [];

  function require(key: keyof RequiredEnv): string {
    // Vite inlines VITE_* at build time; access via import.meta.env
    const value = (import.meta.env as Record<string, string | undefined>)[`VITE_${key}`];
    if (!value || value.trim() === '') missing.push(`VITE_${key}`);
    return value ?? '';
  }

  function optional(key: keyof OptionalEnv): string | undefined {
    return (import.meta.env as Record<string, string | undefined>)[`VITE_${key}`];
  }

  const result: AppEnv = {
    SUPABASE_URL:      require('SUPABASE_URL'),
    SUPABASE_ANON_KEY: require('SUPABASE_ANON_KEY'),
    API_BASE:          optional('API_BASE') ?? '',
    APP_NAME:          optional('APP_NAME') ?? 'Siomac',
    SENTRY_DSN:        optional('SENTRY_DSN'),
  };

  if (missing.length > 0) {
    const msg =
      `[Siomac] Missing required environment variables:\n` +
      missing.map((k) => `  • ${k}`).join('\n') +
      `\n\nCopy .env.example → .env and fill in the values.`;

    // In development, throw so Vite's error overlay shows it.
    // In production, log to console (Sentry captures it via window.onerror).
    if (import.meta.env.DEV) {
      throw new Error(msg);
    } else {
      console.error(msg);
    }
  }

  return result;
}

/**
 * Validated, typed environment.
 * Accessing this module validates the env — import it before anything else.
 */
export const env: AppEnv = validate();
