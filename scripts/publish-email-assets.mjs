/**
 * scripts/publish-email-assets.mjs — publish email illustrations to the public branding bucket.
 *
 *   node scripts/publish-email-assets.mjs [--dry-run]
 *
 * Email clients cannot resolve a repo-relative path. Anything an email references must live at an
 * absolute, publicly reachable URL — no auth, no signed URL, because the recipient's mail client
 * fetches it with no session. `branding` is already a PUBLIC bucket used for exactly this class of
 * asset, so email art goes there under `email/` rather than inventing new infrastructure.
 *
 * Idempotent: upsert by path, so re-running after changing an image republishes it and re-running
 * unchanged is a no-op. Safe to run on every deploy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry-run');
const SOURCE_DIR = new URL('../assets/images/email/', import.meta.url);
const BUCKET = 'branding';
const PREFIX = 'email';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[key]) { console.error(`Missing ${key} in .env`); process.exit(2); }
}

const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// fileURLToPath, not .pathname: a path containing a space arrives percent-encoded
// ("MSI%20Laptop") and every read then fails with ENOENT.
const dir = fileURLToPath(SOURCE_DIR);
const files = readdirSync(SOURCE_DIR).filter(f => CONTENT_TYPE[extname(f).toLowerCase()]);

console.log(`${DRY ? '[dry run] ' : ''}publishing ${files.length} asset(s) → ${BUCKET}/${PREFIX}/\n`);
let published = 0, failed = 0;

for (const file of files) {
  const path = `${PREFIX}/${file}`;
  if (DRY) { console.log(`  would publish ${path}`); published++; continue; }
  const body = readFileSync(join(dir, file));
  const { error } = await sb.storage.from(BUCKET).upload(path, body, {
    contentType: CONTENT_TYPE[extname(file).toLowerCase()],
    upsert: true,
    // A year: these are content-addressed by name and republished on change, so a long cache is
    // safe and keeps mail clients from re-fetching on every open.
    cacheControl: '31536000',
  });
  if (error) { console.error(`  ✖ ${path}: ${error.message}`); failed++; continue; }
  published++;
  console.log(`  ✓ ${path}`);
}

console.log(`\n${published} published, ${failed} failed`);
if (!DRY && !failed) {
  const { data } = sb.storage.from(BUCKET).getPublicUrl(`${PREFIX}/${files[0]}`);
  console.log(`public URL form: ${data.publicUrl}`);
}
process.exit(failed ? 1 : 0);
