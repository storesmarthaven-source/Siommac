/**
 * netlify/functions/lib/realtimeAuth.ts
 *
 * Server-issued Supabase Realtime tokens (messaging-audit finding #5).
 *
 * Supabase Realtime accepts any JWT signed with the PROJECT JWT secret and
 * evaluates RLS policies with its claims. We mint a short-lived token whose
 * `sub` is the TEXT app_users id, so the communication_signals SELECT policy
 * can scope rows via (auth.jwt()->>'sub') against user_realtime_channels.
 *
 * SUPABASE_JWT_SECRET is the project JWT secret (dashboard → Settings → API).
 * It is DISTINCT from our app JWT_SECRET. When unconfigured, minting returns
 * null and the frontend keeps the anonymous connection — the RLS migration
 * (20260919000351) is the enforcement point and its runbook requires this env
 * var first. See lib/REALTIME_AUTH_CONTRACT.md.
 */

import jwt from 'jsonwebtoken';

const TOKEN_TTL_SECONDS = 55 * 60;   // refreshed by the 30s summary poll long before expiry

export interface RealtimeToken {
  token:     string;
  /** ISO timestamp of expiry — clients refresh well before this. */
  expiresAt: string;
}

/** Mint a realtime token for a user, or null when the secret is unconfigured. */
export function mintRealtimeToken(userId: string): RealtimeToken | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || !userId) return null;

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
    secret,
    { algorithm: 'HS256' },
  );
  return { token, expiresAt: new Date(expSec * 1000).toISOString() };
}
