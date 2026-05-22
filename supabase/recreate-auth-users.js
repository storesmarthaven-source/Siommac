#!/usr/bin/env node
/**
 * supabase/recreate-auth-users.js
 *
 * Links app_users to Supabase Auth by creating auth.users rows via the
 * Supabase Admin API. Unlike direct SQL inserts, the Admin API automatically
 * creates the required auth.identities row and sets all internal bookkeeping.
 *
 * Usage:
 *   node supabase/recreate-auth-users.js
 *
 * Required env vars (read from .env in the project root):
 *   SUPABASE_URL             — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (never the anon key)
 *
 * What it does:
 *   1. Reads all app_users from the database
 *   2. For each user with auth_id set: deletes the existing auth.users row
 *      (handles the case where the row exists but is missing auth.identities)
 *   3. Creates a new auth.users row via Admin API (password: ChangeMe123!)
 *   4. Updates app_users.auth_id with the new UUID
 *
 * Safe to re-run — idempotent. Existing correctly-linked users are skipped
 * if their identity is already present (set DRY_RUN=1 to preview only).
 *
 * After running:
 *   All users can log in with password: ChangeMe123!
 *   Change passwords via Supabase Dashboard → Authentication → Users,
 *   or have users change their own password after first login.
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Load .env ─────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...rest] = line.split('=');
    const key = k?.trim();
    if (key && !key.startsWith('#') && !process.env[key]) {
      process.env[key] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD  = process.env.DEFAULT_AUTH_PASSWORD ?? 'ChangeMe123!';
const DRY_RUN           = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(url, opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function adminHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'apikey':        SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function getAppUsers() {
  const r = await request(
    `${SUPABASE_URL}/rest/v1/app_users?select=id,username,full_name,role,auth_email,auth_id,status&order=role,username`,
    { method: 'GET', headers: adminHeaders() },
  );
  if (r.status !== 200) throw new Error(`Failed to fetch app_users: ${r.body}`);
  return JSON.parse(r.body);
}

async function checkIdentityExists(authId) {
  const r = await request(
    `${SUPABASE_URL}/auth/v1/admin/users/${authId}`,
    { method: 'GET', headers: adminHeaders() },
  );
  if (r.status !== 200) return false;
  const user = JSON.parse(r.body);
  return Array.isArray(user.identities) && user.identities.length > 0;
}

async function deleteAuthUser(authId) {
  const r = await request(
    `${SUPABASE_URL}/auth/v1/admin/users/${authId}`,
    { method: 'DELETE', headers: adminHeaders() },
  );
  return r.status === 200;
}

async function createAuthUser(email, fullName, appUserId) {
  const body = JSON.stringify({
    email,
    password:      DEFAULT_PASSWORD,
    email_confirm: true,
    app_metadata:  { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: fullName, app_user_id: appUserId },
  });
  const r = await request(
    `${SUPABASE_URL}/auth/v1/admin/users`,
    { method: 'POST', headers: adminHeaders() },
    body,
  );
  if (r.status !== 200) {
    throw new Error(`Create failed (${r.status}): ${r.body.slice(0, 200)}`);
  }
  return JSON.parse(r.body);
}

async function updateAppUserId(appUserId, newAuthId) {
  const r = await request(
    `${SUPABASE_URL}/rest/v1/app_users?id=eq.${appUserId}`,
    {
      method:  'PATCH',
      headers: adminHeaders({ Prefer: 'return=minimal' }),
    },
    JSON.stringify({ auth_id: newAuthId }),
  );
  return r.status === 204 || r.status === 200;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('🔍  DRY RUN — no changes will be made\n');

  const users = await getAppUsers();
  console.log(`Found ${users.length} app_users\n`);

  let skipped = 0, repaired = 0, created = 0, failed = 0;

  for (const u of users) {
    if (!u.auth_email) {
      console.log(`⚠️   SKIP  ${u.username.padEnd(22)} — no auth_email`);
      skipped++;
      continue;
    }

    const label = `${u.username.padEnd(22)} ${u.auth_email.padEnd(38)}`;

    // If already linked, check whether auth.identities exists
    if (u.auth_id) {
      const hasIdentity = await checkIdentityExists(u.auth_id);
      if (hasIdentity) {
        console.log(`✅  OK    ${label} (already correct)`);
        skipped++;
        continue;
      }
      // Auth row exists but identity is missing — delete and recreate
      console.log(`🔧  FIX   ${label} (missing identity — deleting old row)`);
      if (!DRY_RUN) {
        const ok = await deleteAuthUser(u.auth_id);
        if (!ok) { console.log(`   ❌  Delete failed`); failed++; continue; }
      }
    } else {
      console.log(`➕  NEW   ${label}`);
    }

    if (DRY_RUN) { created++; continue; }

    try {
      const newUser = await createAuthUser(u.auth_email, u.full_name, u.id);
      const ok = await updateAppUserId(u.id, newUser.id);
      if (!ok) {
        console.log(`   ⚠️   Created auth user but failed to update app_users.auth_id`);
        failed++;
      } else {
        console.log(`   new auth_id: ${newUser.id.slice(0, 8)}...`);
        u.auth_id ? repaired++ : created++;
      }
    } catch (err) {
      console.log(`   ❌  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Skipped (already OK): ${skipped}`);
  console.log(`Repaired (missing identity): ${repaired}`);
  console.log(`Created (new):        ${created}`);
  console.log(`Failed:               ${failed}`);
  if (failed > 0) {
    console.log('\n⚠️  Some users failed — re-run the script to retry.');
    process.exit(1);
  } else {
    console.log('\n✅  All users are correctly linked to Supabase Auth.');
    console.log(`    Default password: ${DEFAULT_PASSWORD}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
