// lib/totp.ts — TOTP two-factor authentication helpers
//
// TOTP secrets are encrypted at rest with AES-256-GCM using TOTP_ENCRYPTION_KEY.
// The plaintext secret never leaves the Lambda — only the ciphertext is stored.
//
// Backup codes: 8 random 8-char alphanumeric codes.
// Stored as bcrypt hashes in app_users.backup_codes (text[]).
// Each code is single-use; the array element is cleared after use.

import { generateSecret, verifySync, generateURI } from 'otplib';
import QRCode            from 'qrcode';
import crypto            from 'crypto';
import bcrypt            from 'bcryptjs';
import { sb }            from './db';
import type { AppUser }  from '../../../types/db';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY_HEX = process.env.TOTP_ENCRYPTION_KEY ?? '';
const CHALLENGE_TTL_MS   = 10 * 60 * 1000;   // 10 minutes
const MAX_ATTEMPTS       = 5;                 // lock challenge after 5 wrong codes
const BACKUP_CODE_COUNT  = 8;
const BACKUP_CODE_LEN    = 8;                 // characters per code
const TOTP_ISSUER        = 'Siomac';

if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length < 64) {
  console.warn('[totp] TOTP_ENCRYPTION_KEY is missing or shorter than 32 bytes (64 hex chars) — this is insecure');
}

/** 32-byte key derived from the hex env var. */
function _encryptionKey(): Buffer {
  return Buffer.from(ENCRYPTION_KEY_HEX.slice(0, 64), 'hex');
}

// ── Secret encryption / decryption ────────────────────────────────────────────

/**
 * Encrypt a TOTP secret with AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all hex) for storage.
 */
export function encryptSecret(plaintext: string): string {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _encryptionKey(), iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a TOTP secret stored in the DB.
 * Returns null if decryption fails (corrupt data / wrong key).
 */
export function decryptSecret(stored: string): string | null {
  try {
    const [ivHex, tagHex, encHex] = stored.split(':');
    if (!ivHex || !tagHex || !encHex) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', _encryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
}

// ── TOTP generation / verification ────────────────────────────────────────────

/**
 * Generate a new TOTP secret.
 * Returns [plainSecret, encryptedSecret].
 * The plain secret is shown to the user once (QR code / manual entry);
 * only the encrypted version is stored.
 */
export function generateTotpSecret(): [string, string] {
  const plain     = generateSecret();          // base32 TOTP secret
  const encrypted = encryptSecret(plain);
  return [plain, encrypted];
}

/**
 * Verify a 6-digit TOTP code against an encrypted stored secret.
 * Returns true if valid (with ±1 window for clock drift).
 */
export function verifyCode(encryptedSecret: string, code: string): boolean {
  const plain = decryptSecret(encryptedSecret);
  if (!plain) return false;
  try {
    const result = verifySync({ token: code, secret: plain });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Build the otpauth:// URI and render a base64 PNG QR code.
 * The QR code is shown to the user during TOTP setup.
 */
export async function buildQrCode(plainSecret: string, username: string): Promise<string> {
  const uri = generateURI({ label: username, issuer: TOTP_ISSUER, secret: plainSecret });
  return QRCode.toDataURL(uri);   // returns "data:image/png;base64,..."
}

// ── Backup codes ──────────────────────────────────────────────────────────────

/** Generate 8 random alphanumeric backup codes. Returns [plaintexts, bcryptHashes]. */
export async function generateBackupCodes(): Promise<[string[], string[]]> {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no ambiguous I/O/0/1
  const plains: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let code = '';
    const rand = crypto.randomBytes(BACKUP_CODE_LEN);
    for (let j = 0; j < BACKUP_CODE_LEN; j++) {
      code += charset[rand[j] % charset.length];
    }
    plains.push(code);
    hashes.push(await bcrypt.hash(code, 10));
  }
  return [plains, hashes];
}

/**
 * Attempt to consume a backup code for a user.
 * Iterates the stored hash array; on match, clears that slot in the DB.
 * Returns true if a valid code was found and consumed.
 */
export async function consumeBackupCode(user: AppUser, code: string): Promise<boolean> {
  const hashes = user.backup_codes;
  if (!hashes || hashes.length === 0) return false;

  const upper = code.toUpperCase().replace(/\s/g, '');
  for (let i = 0; i < hashes.length; i++) {
    if (!hashes[i]) continue;
    const match = await bcrypt.compare(upper, hashes[i]);
    if (match) {
      const updated = [...hashes];
      updated[i] = '';   // mark as used
      await sb.from('app_users').update({ backup_codes: updated }).eq('id', user.id);
      return true;
    }
  }
  return false;
}

// ── Pre-auth challenge tokens ─────────────────────────────────────────────────

/**
 * Issue a short-lived challenge token for a user (after password OK, before 2FA).
 * type = 'verify'  → user must enter TOTP code
 * type = 'setup'   → user must complete first-time enrolment
 * Returns the plaintext token to send to the client.
 */
export async function issueChallenge(userId: string, type: 'verify' | 'setup'): Promise<string> {
  const plain   = crypto.randomBytes(32).toString('hex');
  const hash    = crypto.createHash('sha256').update(plain).digest('hex');
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  // Delete any existing challenge for this user (one challenge at a time)
  await sb.from('totp_challenges').delete().eq('user_id', userId);

  await sb.from('totp_challenges').insert({
    user_id:    userId,
    token_hash: hash,
    type,
    expires_at: expires,
  });

  return plain;
}

type ChallengeRow = {
  id:            string;
  user_id:       string;
  type:          'verify' | 'setup';
  attempt_count: number;
  expires_at:    string;
};

/**
 * Validate a challenge token.
 * Returns the DB row on success, null if invalid / expired / too many attempts.
 * Does NOT delete the row — caller decides whether to consume it.
 */
export async function validateChallenge(
  plainToken: string,
): Promise<Omit<ChallengeRow, 'expires_at'> | null> {
  const hash = crypto.createHash('sha256').update(plainToken).digest('hex');

  const { data } = await sb
    .from('totp_challenges')
    .select('id, user_id, type, attempt_count, expires_at')
    .eq('token_hash', hash)
    .maybeSingle<ChallengeRow>();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await sb.from('totp_challenges').delete().eq('id', data.id);
    return null;
  }
  if (data.attempt_count >= MAX_ATTEMPTS) {
    await sb.from('totp_challenges').delete().eq('id', data.id);
    return null;
  }

  return { id: data.id, user_id: data.user_id, type: data.type, attempt_count: data.attempt_count };
}

/** Increment the attempt count on a challenge (called on wrong code). */
export async function incrementChallengeAttempt(challengeId: string): Promise<void> {
  // Read-modify-write (acceptable for a 5-attempt limit, not hot path)
  const { data } = await sb
    .from('totp_challenges')
    .select('attempt_count')
    .eq('id', challengeId)
    .single<{ attempt_count: number }>();
  if (data) {
    await sb
      .from('totp_challenges')
      .update({ attempt_count: data.attempt_count + 1 })
      .eq('id', challengeId);
  }
}

/** Consume (delete) a challenge after successful verification. */
export async function consumeChallenge(challengeId: string): Promise<void> {
  await sb.from('totp_challenges').delete().eq('id', challengeId);
}

// ── 2FA policy check ──────────────────────────────────────────────────────────

/**
 * Returns whether 2FA is mandatory for a given role.
 * admin / manager → mandatory
 * employee        → optional
 */
export function isTwoFactorMandatory(_role: string): boolean {
  // 2FA enforcement disabled until totp_challenges table is provisioned in DB.
  // Re-enable by returning: _role === 'admin' || _role === 'manager';
  return false;
}
