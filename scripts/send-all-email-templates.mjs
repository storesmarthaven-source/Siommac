/**
 * scripts/send-all-email-templates.mjs — send every seeded Studio template through the real path.
 *
 *   node scripts/send-all-email-templates.mjs <address>            # DRY RUN (default, sends nothing)
 *   node scripts/send-all-email-templates.mjs <address> --live     # REAL EMAIL, one per template
 *
 * ⛔ `--live` sends a real email per template. Requires an explicit per-run approval from the user.
 * Dry run is the DEFAULT for the same reason `email/test-send` defaults to it: the safe mode has to
 * be the one you get by forgetting a flag.
 *
 * A dry run still compiles, resolves variables, resolves hosted assets and runs the production
 * compatibility gate for real — it just transmits nothing and records nothing. So a green dry run
 * across all 13 proves every template would render correctly before a single message is sent.
 */
import { Harness } from './e2e/harness.mjs';
import { EMAIL_TEMPLATE_SEEDS } from '../dist/src/lib/emailTemplateSeeds.js';
import { createStarterEmailDocument, renderEmailMjml } from '../dist/src/lib/emailTemplateDocument.js';

const TO = process.argv[2];
const LIVE = process.argv.includes('--live');
if (!TO || TO.startsWith('--')) {
  console.error('usage: node scripts/send-all-email-templates.mjs <address> [--live]');
  process.exit(2);
}

const h = new Harness();
await h.pickUsers();
const token = h.mint(h.users.admin);

const AVATAR = `${h.env.SUPABASE_URL}/storage/v1/object/public/branding/email/worker-avatar.png`;
/** Realistic values so a rendered template can actually be judged by eye. */
const BASE = {
  'recipient.firstName': 'Ada',
  'recipient.fullName': 'Ada Lovelace',
  'recipient.profilePhotoUrl': AVATAR,
  'employee.fullName': 'Ada Lovelace',
  'employee.jobTitle': 'Field Engineer',
  'employee.number': 'EMP-00427',
  'employee.startDate': 'Monday 17 August 2026',
  'employee.startDay': 'Monday',
  'employee.startTime': '8:00 am',
  'employee.workAddress': 'Point Lisas Industrial Estate, Couva',
  'employee.workLocation': 'Point Lisas Yard',
  'manager.fullName': 'Grace Hopper',
  'manager.jobTitle': 'Operations Manager',
  'company.name': 'SIOMAC',
  'company.legalName': 'SIOMAC Limited',
  'company.address': '12 Harbour Road, Port of Spain, Trinidad',
  'company.helpUrl': 'https://siomac.example.com/help',
  'company.privacyUrl': 'https://siomac.example.com/privacy',
  'support.email': 'hr@siomac.example.com',
  'support.phone': '+1 868 555 0142',
};

/**
 * Variables are DERIVED from each rendered template, never hand-listed — a fixed list rots the
 * moment a template gains a token, and the refusal it causes looks like a bug in the send path.
 */
const variablesFor = (family, triggerKey, subject) => {
  const source = renderEmailMjml(createStarterEmailDocument(family, triggerKey), subject) + ' ' + subject;
  const vars = { ...BASE };
  for (const [, key] of source.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (vars[key] !== undefined) continue;
    vars[key] = /url|photo|image|avatar|logo|link/i.test(key)
      ? 'https://siomac.example.com/link'
      : /date|expires|at$/i.test(key)
        ? 'Friday 21 August 2026'
        : `SIOMAC ${key.split('.').pop()}`;
  }
  return vars;
};

console.log(`${LIVE ? '⛔ LIVE — REAL EMAIL' : 'DRY RUN — nothing is transmitted'} · ${EMAIL_TEMPLATE_SEEDS.length} template(s) → ${TO}\n`);

const results = [];
for (const [key, name, family, triggerKey, , , , subject] of EMAIL_TEMPLATE_SEEDS) {
  const templateKey = key.replace(/-/g, '_');
  const r = await h.api('email/template-send', token, {
    templateKey, to: TO, variables: variablesFor(family, triggerKey, subject), dryRun: !LIVE,
  });
  const d = r.body?.data ?? {};
  const ok = r.body?.success === true;
  results.push({ templateKey, name, ok, status: r.status, refusal: d.refusal ?? null, providerMessageId: d.providerMessageId ?? null, deliveryId: d.deliveryId ?? null, message: r.body?.message ?? '' });
  console.log(`${ok ? '  ✓' : '  ✖'} ${templateKey.padEnd(30)} ${ok ? (d.providerMessageId ?? 'compiled') : `${d.refusal ?? r.status}: ${r.body?.message ?? ''}`}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} succeeded, ${failed.length} failed`);
if (LIVE) {
  console.log('\nprovider message ids:');
  for (const r of results.filter(r => r.ok)) console.log(`  ${r.templateKey.padEnd(30)} ${r.providerMessageId}`);
}
process.exit(failed.length ? 1 : 0);
