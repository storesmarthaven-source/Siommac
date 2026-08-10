/**
 * scripts/seed-email-templates.mjs — publish the 13 starter templates into the server-side store.
 *
 *   node scripts/seed-email-templates.mjs [--dry-run] [--prune]
 *
 * The Email Template Studio's 13 templates live in a DEVELOPMENT adapter backed by localStorage.
 * The production send path deliberately loads an authoritative PUBLISHED version from
 * `email_templates` / `email_template_versions` and refuses a draft, so until they exist in the
 * database there is nothing that can be sent.
 *
 * ⚠ These are FIXTURES, not content a human reviewed. Publishing them here satisfies the send
 * path's state guard; it does not mean the maker-checker control was exercised. Real templates
 * should be authored and published through the Studio.
 *
 * Idempotent: keyed on `template_key`, so re-running updates in place rather than duplicating.
 * `--prune` removes seeded rows again (they are identifiable by their keys).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');

const require_ = createRequire(import.meta.url);
const distPath = name => fileURLToPath(new URL(`../dist/src/lib/${name}`, import.meta.url));
for (const file of ['emailTemplateSeeds.js', 'emailTemplateDocument.js']) {
  if (!existsSync(distPath(file))) {
    console.error(`dist/src/lib/${file} is missing — run \`npm run build:backend\` first.`);
    process.exit(2);
  }
}
const { EMAIL_TEMPLATE_SEEDS } = require_(distPath('emailTemplateSeeds.js'));
const { createStarterEmailDocument } = require_(distPath('emailTemplateDocument.js'));

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[key]) { console.error(`Missing ${key} in .env`); process.exit(2); }
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Studio keys are kebab-case; template_key is the send path's identifier. */
const templateKeyFor = key => key.replace(/-/g, '_');

if (PRUNE) {
  const keys = EMAIL_TEMPLATE_SEEDS.map(([key]) => templateKeyFor(key));
  const { data: rows, error } = await sb.from('email_templates').select('id, template_key').in('template_key', keys);
  if (error) { console.error('lookup failed:', error.message); process.exit(1); }
  const ids = (rows ?? []).map(r => r.id);
  console.log(`${DRY ? '[dry run] ' : ''}pruning ${ids.length} seeded template(s)`);
  if (!DRY && ids.length) {
    const { error: vErr } = await sb.from('email_template_versions').delete().in('template_id', ids);
    if (vErr) { console.error('version delete failed:', vErr.message); process.exit(1); }
    const { error: tErr } = await sb.from('email_templates').delete().in('id', ids);
    if (tErr) { console.error('template delete failed:', tErr.message); process.exit(1); }
  }
  console.log('done.');
  process.exit(0);
}

console.log(`${DRY ? '[dry run] ' : ''}seeding ${EMAIL_TEMPLATE_SEEDS.length} template(s)\n`);
let seeded = 0, failed = 0;

for (const [key, name, family, triggerKey, , , purpose, subject, preheader] of EMAIL_TEMPLATE_SEEDS) {
  const templateKey = templateKeyFor(key);
  if (DRY) { console.log(`  would seed ${templateKey.padEnd(30)} ${subject}`); seeded++; continue; }

  // Keyed upsert: the same key updates in place, so re-running cannot create a second copy that
  // the send path would then have to choose between.
  const { data: tpl, error: tErr } = await sb.from('email_templates')
    .upsert({ template_key: templateKey, name, description: purpose, family, trigger_key: triggerKey },
      { onConflict: 'template_key' })
    .select('id').single();
  if (tErr) { console.error(`  ✖ ${templateKey}: ${tErr.message}`); failed++; continue; }

  // The schema is BUILT here from the same factory the Studio uses, never copied from a cached
  // render — `editor_schema` is canonical and the send path recompiles from it.
  const editorSchema = createStarterEmailDocument(family, triggerKey);

  const { error: vErr } = await sb.from('email_template_versions')
    .upsert({ template_id: tpl.id, version_no: 1, subject, preheader, editor_schema: editorSchema, status: 'published' },
      { onConflict: 'template_id,version_no' });
  if (vErr) { console.error(`  ✖ ${templateKey} version: ${vErr.message}`); failed++; continue; }

  seeded++;
  console.log(`  ✓ ${templateKey.padEnd(30)} ${subject}`);
}

console.log(`\n${seeded} seeded, ${failed} failed`);
process.exit(failed ? 1 : 0);
