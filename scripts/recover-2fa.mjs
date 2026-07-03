/**
 * scripts/recover-2fa.mjs — emergency 2FA lockout recovery (superadmin).
 *
 * WHY: this dev environment runs on a simulated 2026 clock. TOTP codes are
 * time-based (±30s tolerance), so if the machine/server clock is set to 2026 but
 * your authenticator phone is on real time, EVERY code is rejected. Backup codes
 * are NOT time-based and still work — but if you don't have one, run this.
 *
 * WHAT IT DOES for the given user (default: superadmin):
 *   1. Disables TOTP  (totp_enabled=false, secret/enrolled_at/backup_codes cleared)
 *      → you can log in with just your password.
 *   2. Relaxes the mandatory-MFA policy for super_admin so password-only login is
 *      allowed in this dev env (auth_security_policy.require_mfa_for_super_admin=false).
 *   3. Clears any session-revocation epoch for the user (so a fresh login isn't blocked).
 *
 * RUN (Node 20+, from the repo root, loads .env automatically):
 *     node --env-file=.env scripts/recover-2fa.mjs           # superadmin
 *     node --env-file=.env scripts/recover-2fa.mjs someuser  # a specific username
 *
 * After it runs: log in with username + password (no 2FA). Re-enroll later from
 * Settings → Security ONLY once your machine clock matches your phone, otherwise
 * TOTP will fail again for the same clock-skew reason.
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run with:  node --env-file=.env scripts/recover-2fa.mjs');
  process.exit(1);
}

const username = process.argv[2] || 'superadmin';
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: before, error: e0 } = await sb
  .from('app_users')
  .select('id, username, role, totp_enabled, totp_enrolled_at')
  .eq('username', username)
  .maybeSingle();

if (e0) { console.error('Lookup failed:', e0.message); process.exit(1); }
if (!before) { console.error(`No user with username "${username}".`); process.exit(1); }

console.log(`\nUser: ${before.username}  (role: ${before.role})`);
console.log(`  2FA before: enabled=${before.totp_enabled}, enrolledAt=${before.totp_enrolled_at ?? '—'}`);

// 1. Disable TOTP
const { error: e1 } = await sb
  .from('app_users')
  .update({ totp_enabled: false, totp_secret: null, totp_enrolled_at: null, backup_codes: null })
  .eq('id', before.id);
if (e1) { console.error('Failed to disable TOTP:', e1.message); process.exit(1); }
console.log('  ✓ TOTP disabled (secret + backup codes cleared)');

// 2. Relax mandatory-MFA for super_admin so password-only login is allowed (dev accommodation).
if (before.role === 'superadmin') {
  const { error: e2 } = await sb
    .from('auth_security_policy')
    .update({ require_mfa_for_super_admin: false })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // update the single policy row
  if (e2) console.warn('  ! Could not relax auth_security_policy (may be fine):', e2.message);
  else    console.log('  ✓ require_mfa_for_super_admin set to false (dev)');
}

// 3. Clear any session-revocation epoch so a fresh login is not blocked.
const { error: e3 } = await sb.from('session_revocations').delete().eq('user_id', before.id);
if (e3) console.warn('  ! Could not clear session_revocations (may be fine):', e3.message);
else    console.log('  ✓ session revocation cleared');

console.log('\nDone. Log in with your username + password — no 2FA code needed.\n');
