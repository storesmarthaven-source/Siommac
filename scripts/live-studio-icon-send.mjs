/**
 * scripts/live-studio-icon-send.mjs — ONE authorised real Studio send, to verify Gmail parity.
 *
 * ⛔ Sends a REAL email. Run only with an explicit per-send approval. Not part of any suite.
 *
 * Deliberately mirrors the content of the 2026-08-09 send (provider 79f05115) so the two messages
 * differ in exactly one respect: whether the icons render. The template is seeded with AUTHORED
 * relative asset paths, so the server-side resolver is what runs — that is the path under test.
 */
import { Harness } from './e2e/harness.mjs';
import { createStarterEmailDocument } from '../dist/src/lib/emailTemplateDocument.js';

const TO = process.argv[2];
if (!TO) { console.error('usage: node scripts/live-studio-icon-send.mjs <address>'); process.exit(2); }

const h = new Harness();
await h.pickUsers();
const token = h.mint(h.users.admin);
const key = `live_icon_parity_${Date.now()}`;

const AVATAR = `${h.env.SUPABASE_URL}/storage/v1/object/public/branding/email/worker-avatar.png`;
const VARIABLES = {
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
  'onboarding.hubUrl': 'https://siomac.example.com/onboarding',
  'onboarding.roadmapUrl': 'https://siomac.example.com/onboarding/roadmap',
};

const { data: tpl, error } = await h.sb.from('email_templates').insert({
  template_key: key, name: 'Live icon parity check', family: 'onboarding', trigger_key: 'onboarding.welcome',
}).select('id').single();
if (error) { console.error('seed template failed:', error.message); process.exit(1); }

const { error: verErr } = await h.sb.from('email_template_versions').insert({
  template_id: tpl.id, version_no: 1, subject: 'Welcome to SIOMAC',
  editor_schema: createStarterEmailDocument('onboarding'), status: 'published',
});
if (verErr) { console.error('seed version failed:', verErr.message); process.exit(1); }

console.log(`template ${key} seeded (authored relative asset paths)\nsending REAL email to ${TO} …\n`);
const r = await h.api('email/template-send', token, {
  templateKey: key, to: TO, variables: VARIABLES, dryRun: false,
});

console.log('HTTP status        :', r.status);
console.log('response           :', JSON.stringify(r.body, null, 2));

const d = r.body?.data ?? {};
if (d.deliveryId) {
  // The columns are `recipient`/`sender`, NOT to_addresses/from_address. Check the error: a bad
  // column name makes PostgREST return an error with null data, which reads exactly like
  // "no row was written" — i.e. like the send having failed when it had not.
  const { data: rows, error: rowErr } = await h.sb.from('email_deliveries')
    .select('id, use_case, status, provider, provider_message_id, recipient, sender, reply_to, subject, sent_at, delivered_at, idempotency_key, metadata')
    .eq('id', d.deliveryId);
  if (rowErr) console.error('\n⚠ delivery lookup failed:', rowErr.message);
  console.log('\ndelivery record    :', JSON.stringify(rows?.[0] ?? null, null, 2));

  const { data: evs } = await h.sb.from('app_events')
    .select('id, event_type, created_at').eq('source_entity_id', d.deliveryId);
  console.log('app_events         :', JSON.stringify(evs ?? [], null, 2));
}

// Evidence is recorded ABOVE before the fixture is removed: email_deliveries.actor_user_id is
// ON DELETE SET NULL, so the row survives, but the template rows would take their context with them.
await h.sb.from('email_template_versions').delete().eq('template_id', tpl.id);
await h.sb.from('email_templates').delete().eq('id', tpl.id);
console.log('\nfixture template removed.');
process.exit(0);
