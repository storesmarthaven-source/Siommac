// lib/webauthn.ts — WebAuthn / passkey helpers (server-side only)
//
// Uses @simplewebauthn/server v13.  All credential data is stored in
// webauthn_credentials; ephemeral challenges live in webauthn_challenges.
//
// Public key bytes are stored as base64url strings (the library's native
// representation) and converted to Uint8Array only when the library needs them.

import {
  generateRegistrationOptions   as _genRegOpts,
  verifyRegistrationResponse    as _verifyReg,
  generateAuthenticationOptions as _genAuthOpts,
  verifyAuthenticationResponse  as _verifyAuth,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialDescriptorJSON,
} from '@simplewebauthn/server';

import crypto            from 'crypto';
import { sb }            from './db';
import { isTwoFactorMandatory } from './totp';
import type { AppUser }  from '../../../types/db';

// ── RP configuration ──────────────────────────────────────────────────────────

export const WEBAUTHN_RP_ID     = process.env.WEBAUTHN_RP_ID     ?? 'localhost';
export const WEBAUTHN_RP_NAME   = process.env.WEBAUTHN_RP_NAME   ?? 'SIOMAC ERP';
/** Allowed ceremony origins, comma-separated. The dev stack is reachable on
 *  BOTH the Vite origin (5173, proxying /api) and the Netlify origin (8888) —
 *  a single pinned origin rejects passkeys from the other one. Production
 *  sets WEBAUTHN_ORIGIN to its real origin(s); rpID 'localhost' covers both
 *  dev ports (rpID is a hostname, ports don't participate). */
export const WEBAUTHN_ORIGINS   = (process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:8888,http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);

/** Challenge TTL: 5 minutes (enough for a credential ceremony). */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// ── Internal types ────────────────────────────────────────────────────────────

interface CredentialRow {
  id:            string;
  user_id:       string;
  credential_id: string;
  public_key:    string;   // base64url
  counter:       number;
  transports:    string[] | null;
  device_type:   string | null;
  backed_up:     boolean;
  aaguid:        string | null;
  label:         string | null;
  created_at:    string;
  last_used_at:  string | null;
}

interface ChallengeRow {
  id:         string;
  user_id:    string | null;
  type:       'register' | 'authenticate';
  challenge:  string;
  expires_at: string;
  created_at: string;
}

export interface CredentialSummary {
  id:          string;
  credentialId: string;
  label:       string | null;
  deviceType:  string | null;
  backedUp:    boolean;
  transports:  string[];
  createdAt:   string;
  lastUsedAt:  string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert base64url string → Uint8Array (used by the library's credential shape). */
function b64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  // Node's Buffer understands base64url; copy into a fresh Uint8Array so the
  // result is backed by a plain ArrayBuffer (Buffers may share a pooled one).
  return new Uint8Array(Buffer.from(b64url, 'base64url'));
}

/** Convert Uint8Array → base64url string for storage. */
function bytesToB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Lazy-clean expired challenges (best-effort, no await needed). */
function _pruneExpiredChallenges(): void {
  // Wrap in Promise.resolve to get a real Promise (Supabase builder is PromiseLike)
  void Promise.resolve(
    sb.from('webauthn_challenges')
      .delete()
      .lt('expires_at', new Date().toISOString()),
  ).catch(() => { /* best-effort */ });
}

/** Fetch all credentials for a user (raw rows). */
async function _getCredentialRows(userId: string): Promise<CredentialRow[]> {
  const { data } = await sb
    .from('webauthn_credentials')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return (data ?? []) as CredentialRow[];
}

/** Fetch a challenge row and validate expiry. Returns null if missing/expired. */
async function _consumeChallenge(challengeId: string): Promise<ChallengeRow | null> {
  const { data } = await sb
    .from('webauthn_challenges')
    .select('*')
    .eq('id', challengeId)
    .maybeSingle<ChallengeRow>();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await sb.from('webauthn_challenges').delete().eq('id', challengeId);
    return null;
  }
  await sb.from('webauthn_challenges').delete().eq('id', challengeId);
  return data;
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Generate WebAuthn registration options for a user.
 * Persists an ephemeral challenge row (type 'register').
 * Returns `{ options, challengeId }` — the frontend only needs `options`.
 * The route stores `challengeId` in the response so /register/verify can
 * supply it back. Alternatively the client sends it back or we look it up
 * by user_id + type (we do the latter for simplicity).
 */
export async function generateRegistrationOptions(
  user: Pick<AppUser, 'id' | 'username' | 'full_name'>,
): Promise<{ options: Awaited<ReturnType<typeof _genRegOpts>>; challengeId: string }> {
  _pruneExpiredChallenges();

  const existing = await _getCredentialRows(user.id);
  const excludeCredentials: PublicKeyCredentialDescriptorJSON[] = existing.map(c => ({
    id:         c.credential_id,
    type:       'public-key',
    // DB stores plain strings; the registration ceremony only echoes them back.
    transports: (c.transports ?? undefined) as PublicKeyCredentialDescriptorJSON['transports'],
  }));

  const options = await _genRegOpts({
    rpName:                WEBAUTHN_RP_NAME,
    rpID:                  WEBAUTHN_RP_ID,
    userName:              user.username,
    userDisplayName:       user.full_name,
    userID:                new TextEncoder().encode(user.id),
    timeout:               60_000,
    attestationType:       'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey:        'preferred',
      userVerification:   'preferred',
    },
  });

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const { data: challengeRow } = await sb
    .from('webauthn_challenges')
    .insert({
      user_id:    user.id,
      type:       'register',
      challenge:  options.challenge,
      expires_at: expiresAt,
    })
    .select('id')
    .single<{ id: string }>();

  return { options, challengeId: challengeRow?.id ?? '' };
}

/**
 * Verify a registration response and persist the credential.
 * Looks up the most recent unexpired 'register' challenge for this user.
 */
export async function verifyRegistration(
  user: Pick<AppUser, 'id'>,
  attResp:  RegistrationResponseJSON,
  label?:   string,
): Promise<CredentialSummary> {
  // Find the most recent pending register challenge for this user
  const { data: challengeRow } = await sb
    .from('webauthn_challenges')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'register')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ChallengeRow>();

  if (!challengeRow) {
    throw Object.assign(new Error('No valid registration challenge found'), { status: 400 });
  }

  // Consume the challenge
  await sb.from('webauthn_challenges').delete().eq('id', challengeRow.id);

  const verification = await _verifyReg({
    response:                 attResp,
    expectedChallenge:        challengeRow.challenge,
    expectedOrigin:           WEBAUTHN_ORIGINS,
    expectedRPID:             WEBAUTHN_RP_ID,
    requireUserVerification:  false,
  });

  if (!verification.verified) {
    throw Object.assign(new Error('Registration verification failed'), { status: 400 });
  }

  const info = verification.registrationInfo;
  const credId = `WAC-${crypto.randomUUID()}`;
  // '' (label cleared/blank) intentionally stores NULL, not empty string.
  const trimmedLabel = label?.trim();

  const row: Omit<CredentialRow, 'created_at' | 'last_used_at'> = {
    id:            credId,
    user_id:       user.id,
    credential_id: info.credential.id,
    public_key:    bytesToB64Url(info.credential.publicKey),
    counter:       info.credential.counter,
    transports:    info.credential.transports ?? [],
    device_type:   info.credentialDeviceType,
    backed_up:     info.credentialBackedUp,
    aaguid:        info.aaguid,
    label:         trimmedLabel === undefined || trimmedLabel === '' ? null : trimmedLabel,
  };

  await sb.from('webauthn_credentials').insert(row);

  return {
    id:           credId,
    credentialId: info.credential.id,
    label:        row.label,
    deviceType:   row.device_type,
    backedUp:     row.backed_up,
    transports:   row.transports ?? [],
    createdAt:    new Date().toISOString(),
    lastUsedAt:   null,
  };
}

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * Generate WebAuthn authentication options.
 * If `userId` is supplied, populates allowCredentials with that user's passkeys
 * (standard second-factor flow). If null/undefined, returns an empty
 * allowCredentials array for a usernameless/discoverable-credential flow.
 */
export async function generateAuthenticationOptions(
  userId?: string | null,
): Promise<{ options: Awaited<ReturnType<typeof _genAuthOpts>>; challengeId: string }> {
  _pruneExpiredChallenges();

  let allowCredentials: PublicKeyCredentialDescriptorJSON[] = [];
  if (userId) {
    const creds = await _getCredentialRows(userId);
    allowCredentials = creds.map(c => ({
      id:         c.credential_id,
      type:       'public-key',
      transports: (c.transports ?? undefined) as PublicKeyCredentialDescriptorJSON['transports'],
    }));
  }

  const options = await _genAuthOpts({
    rpID:             WEBAUTHN_RP_ID,
    timeout:          60_000,
    allowCredentials,
    userVerification: 'preferred',
  });

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const { data: challengeRow } = await sb
    .from('webauthn_challenges')
    .insert({
      user_id:    userId ?? null,
      type:       'authenticate',
      challenge:  options.challenge,
      expires_at: expiresAt,
    })
    .select('id')
    .single<{ id: string }>();

  return { options, challengeId: challengeRow?.id ?? '' };
}

/**
 * Verify an authentication assertion.
 * Looks up the credential by `response.id`, finds the matching challenge,
 * verifies the signature, bumps the counter + last_used_at.
 * Returns `{ user, credential }` on success.
 */
export async function verifyAuthentication(
  assertionResp: AuthenticationResponseJSON,
): Promise<{ user: AppUser; credential: CredentialSummary }> {
  // Look up the credential
  const { data: credRow } = await sb
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', assertionResp.id)
    .maybeSingle<CredentialRow>();

  if (!credRow) {
    throw Object.assign(new Error('Unknown credential'), { status: 401 });
  }

  // Find the most recent unexpired authenticate challenge
  // We look for user-scoped challenge first, then fall back to usernameless
  const { data: challengeRow } = await sb
    .from('webauthn_challenges')
    .select('*')
    .eq('type', 'authenticate')
    .gt('expires_at', new Date().toISOString())
    .or(`user_id.eq.${credRow.user_id},user_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ChallengeRow>();

  if (!challengeRow) {
    throw Object.assign(new Error('No valid authentication challenge found'), { status: 401 });
  }

  // Consume challenge immediately (prevents replay)
  await sb.from('webauthn_challenges').delete().eq('id', challengeRow.id);

  const verification = await _verifyAuth({
    response:                assertionResp,
    expectedChallenge:       challengeRow.challenge,
    expectedOrigin:          WEBAUTHN_ORIGINS,
    expectedRPID:            WEBAUTHN_RP_ID,
    requireUserVerification: false,
    credential: {
      id:         credRow.credential_id,
      publicKey:  b64UrlToBytes(credRow.public_key),
      counter:    credRow.counter,
      transports: (credRow.transports ?? undefined) as PublicKeyCredentialDescriptorJSON['transports'],
    },
  });

  if (!verification.verified) {
    throw Object.assign(new Error('Authentication verification failed'), { status: 401 });
  }

  const newCounter = verification.authenticationInfo.newCounter;
  const now        = new Date().toISOString();

  await sb
    .from('webauthn_credentials')
    .update({ counter: newCounter, last_used_at: now })
    .eq('id', credRow.id);

  // Fetch the owning user
  const { data: user } = await sb
    .from('app_users')
    .select('*')
    .eq('id', credRow.user_id)
    .single<AppUser>();

  if (user?.status !== 'active') {
    throw Object.assign(new Error('User not found or inactive'), { status: 401 });
  }

  return {
    user,
    credential: {
      id:           credRow.id,
      credentialId: credRow.credential_id,
      label:        credRow.label,
      deviceType:   credRow.device_type,
      backedUp:     credRow.backed_up,
      transports:   credRow.transports ?? [],
      createdAt:    credRow.created_at,
      lastUsedAt:   now,
    },
  };
}

// ── Credential management ─────────────────────────────────────────────────────

/** List all credentials for a user as summaries (no secret material). */
export async function listCredentials(userId: string): Promise<CredentialSummary[]> {
  const rows = await _getCredentialRows(userId);
  return rows.map(c => ({
    id:           c.id,
    credentialId: c.credential_id,
    label:        c.label,
    deviceType:   c.device_type,
    backedUp:     c.backed_up,
    transports:   c.transports ?? [],
    createdAt:    c.created_at,
    lastUsedAt:   c.last_used_at,
  }));
}

/** Rename a credential (label). Only the owning user's credentials can be renamed. */
export async function renameCredential(
  userId:       string,
  credentialId: string,
  label:        string,
): Promise<void> {
  const { error } = await sb
    .from('webauthn_credentials')
    .update({ label: label.trim() || null })
    .eq('id', credentialId)
    .eq('user_id', userId);

  if (error) throw Object.assign(new Error('Rename failed'), { status: 500 });
}

/**
 * Delete a credential.
 * Callers MUST check the last-factor guard before calling this:
 * if mandatory and this is the last strong factor, reject with 400 { code:'last_factor' }.
 */
export async function deleteCredential(
  userId:       string,
  credentialId: string,
): Promise<void> {
  const { error } = await sb
    .from('webauthn_credentials')
    .delete()
    .eq('id', credentialId)
    .eq('user_id', userId);

  if (error) throw Object.assign(new Error('Delete failed'), { status: 500 });
}

// ── Strong-factor gate ────────────────────────────────────────────────────────

/**
 * Returns true if the user has at least one registered strong factor:
 * TOTP (totp_enabled) OR a registered passkey.
 * Used by the login gate and by the last-factor guard on passkey delete.
 */
export async function hasStrongFactor(userId: string): Promise<boolean> {
  // Check TOTP first (cheap column read)
  const { data: u } = await sb
    .from('app_users')
    .select('totp_enabled')
    .eq('id', userId)
    .maybeSingle<{ totp_enabled: boolean }>();

  if (u?.totp_enabled) return true;

  // Check passkeys
  const { count } = await sb
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return (count ?? 0) > 0;
}

/**
 * Returns { hasTotp, passkeyCount } — used by the login gate to build the
 * `methods` array returned in `requiresTwoFactor` responses.
 */
export async function getFactorMethods(userId: string): Promise<{ hasTotp: boolean; passkeyCount: number }> {
  const [userRes, passkeyRes] = await Promise.all([
    sb.from('app_users').select('totp_enabled').eq('id', userId).maybeSingle<{ totp_enabled: boolean }>(),
    sb.from('webauthn_credentials').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  return {
    hasTotp:      userRes.data?.totp_enabled ?? false,
    passkeyCount: passkeyRes.count ?? 0,
  };
}

export { isTwoFactorMandatory };
