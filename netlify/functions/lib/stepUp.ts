// lib/stepUp.ts — Step-up authentication helper
//
// High-risk routes (passkey delete, admin security actions, etc.) require a
// *recent* MFA verification even when the session itself is authenticated.
// This helper reads the JWT's mfaVerifiedAt claim and enforces a freshness window.
//
// Usage:
//   const user = await requireStepUp(c);   // throws 401 { code:'step_up_required' } if stale
//
// Frontend intercepts the code and shows a step-up dialog:
//   POST /api/auth/step-up/options  → { totpAvailable, webauthn? }
//   POST /api/auth/step-up/verify   → { success, token }  (re-issued JWT with fresh mfaVerifiedAt)

import type { Context } from 'hono';
import { requireUser }  from './auth';
import type { AppUser } from '../../../types/db';
import type { HonoVariables } from '../../../types/api';
import { stepUpMaxAgeMinutes } from './securityPolicy';

/**
 * Enforce step-up authentication for the calling user.
 *
 * Passes when ALL of:
 *   • Session is authenticated (valid JWT, user active).
 *   • JWT `mfaSatisfied === true`.
 *   • JWT `mfaVerifiedAt` is present and no older than `maxAgeMinutes`.
 *
 * On failure returns a 401 JSON response with `{ code: 'step_up_required' }`
 * so the frontend can intercept and open the step-up dialog.
 *
 * @param c           Hono context.
 * @param maxAgeMinutes  Freshness window in minutes (defaults to securityPolicy.stepUpMaxAgeMinutes).
 * @returns The authenticated AppUser on success.
 * @throws  Object with `{ status: 401 }` and JSON body `{ code: 'step_up_required' }`.
 */
export async function requireStepUp(
  c: Context<{ Variables: HonoVariables }>,
  maxAgeMinutes = stepUpMaxAgeMinutes,
): Promise<AppUser> {
  // requireUser already handles: JWT validity, revocation, user active
  const user = await requireUser(c);

  const auth = c.get('auth');
  // auth cannot be null here — requireUser would have thrown — but TS doesn't know.
  if (!auth) {
    return throwStepUpRequired(c);
  }

  // Must have satisfied MFA
  if (!auth.mfaSatisfied) {
    return throwStepUpRequired(c);
  }

  // mfaVerifiedAt must be present and recent
  if (!auth.mfaVerifiedAt) {
    return throwStepUpRequired(c);
  }

  const verifiedAtMs = new Date(auth.mfaVerifiedAt).getTime();
  if (isNaN(verifiedAtMs)) {
    return throwStepUpRequired(c);
  }

  const ageMs     = Date.now() - verifiedAtMs;
  const maxAgeMs  = maxAgeMinutes * 60 * 1000;

  if (ageMs > maxAgeMs) {
    return throwStepUpRequired(c);
  }

  return user;
}

/** Throw a typed error that the global Hono error handler will propagate as JSON. */
function throwStepUpRequired(_c: Context<{ Variables: HonoVariables }>): never {
  // Attach a body discriminator so the frontend can identify this specific failure
  // even though the global error handler serialises { success, message }.
  // We encode the code in the message, and routes that call requireStepUp may
  // also set a `code` field via a thrown error property.
  const err = Object.assign(
    new Error('step_up_required'),
    { status: 401, code: 'step_up_required' },
  );
  throw err;
}
