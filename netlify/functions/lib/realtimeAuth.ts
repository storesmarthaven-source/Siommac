/**
 * netlify/functions/lib/realtimeAuth.ts
 *
 * Server-issued Supabase Realtime tokens (messaging-audit finding #5).
 *
 * Supabase Realtime accepts any JWT verifiable against the project's CURRENT
 * JWT signing key and evaluates RLS policies with its claims. We mint a
 * short-lived ES256 token whose `sub` is the TEXT app_users id, so the
 * communication_signals SELECT policy can scope rows via (auth.jwt()->>'sub')
 * against user_realtime_channels.
 *
 * Key model (production design — NOT the legacy HS256 shared secret):
 *   - SIOMAC generates and controls the ES256 keypair. The private key lives
 *     ONLY in backend env; the full JWK was imported into Supabase
 *     (dashboard → JWT Keys → import) and rotated to CURRENT so Supabase
 *     verifies our tokens. The `kid` header must match the imported key id.
 *   - SUPABASE_JWT_ES256_PRIVATE_KEY = base64 of the PKCS8 PEM private key.
 *   - SUPABASE_JWT_ES256_KID         = the imported key's kid (uuid).
 *   - Never expose either through a VITE_/PUBLIC_/frontend variable.
 *
 * When unconfigured, minting returns null and the frontend keeps polling —
 * the RLS migration (20260919000351) is the enforcement point and its runbook
 * requires these env vars first. See lib/REALTIME_AUTH_CONTRACT.md.
 */

import jwt from 'jsonwebtoken';

const TOKEN_TTL_SECONDS = 55 * 60;   // refreshed by the 30s summary poll long before expiry

export interface RealtimeToken {
  token:     string;
  /** ISO timestamp of expiry — clients refresh well before this. */
  expiresAt: string;
}

let cachedPem: string | null | undefined;

/** Decode the base64-wrapped PEM once per process; null when unconfigured/invalid. */
function privateKeyPem(): string | null {
  if (cachedPem !== undefined) return cachedPem;
  const b64 = process.env.SUPABASE_JWT_ES256_PRIVATE_KEY;
  if (!b64) { cachedPem = null; return null; }
  try {
    const pem = Buffer.from(b64, 'base64').toString('utf8');
    cachedPem = pem.includes('BEGIN PRIVATE KEY') ? pem : null;
  } catch {
    cachedPem = null;
  }
  if (cachedPem === null) console.error('[realtimeAuth] SUPABASE_JWT_ES256_PRIVATE_KEY is set but not a base64 PKCS8 PEM — realtime tokens disabled');
  return cachedPem;
}

/** Mint a realtime token for a user, or null when the signing key is unconfigured. */
export function mintRealtimeToken(userId: string): RealtimeToken | null {
  const pem = privateKeyPem();
  const kid = process.env.SUPABASE_JWT_ES256_KID;
  if (!pem || !kid || !userId) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + TOKEN_TTL_SECONDS;
  const token = jwt.sign(
    {
      sub:  userId,               // TEXT app_users.id — policies use auth.jwt()->>'sub'
      role: 'authenticated',      // postgres role Realtime adopts for RLS
      aud:  'authenticated',
      iss:  'siomac-realtime',
      iat:  nowSec,
      exp:  expSec,
    },
    pem,
    { algorithm: 'ES256', keyid: kid },
  );
  return { token, expiresAt: new Date(expSec * 1000).toISOString() };
}
