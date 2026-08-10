/**
 * scripts/e2e/suites/emailTemplateSend.mjs
 *
 * Email Template Studio → canonical delivery. Proves the production send path:
 *   load AUTHORITATIVE version → resolve variables → resolve hosted assets
 *   → compile MJML server-side → validate → sendEmail()
 *
 * ⛔ NO REAL EMAIL. Every case is either a refusal or a DRY RUN. A dry run compiles and validates
 * for real, then transmits nothing and — the rule under test — records nothing.
 *
 * ⭐ Fixtures use `createStarterEmailDocument`, the Studio's own factory, rather than a
 * hand-written schema: the renderer rejects an approximated document ("children is not iterable"),
 * and a fixture that is not a real Studio document would prove nothing about real templates.
 */
import { createStarterEmailDocument, renderEmailMjml } from '../../../dist/src/lib/emailTemplateDocument.js';
import {
  EMAIL_ICON_CHOICES,
  EMAIL_ICON_COLORS,
  emailIconFileName,
} from '../../../dist/src/lib/emailIcons.js';

export const title = 'Platform — Email Template Studio send path';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { outsiderId: `TPL-OUT-${TAG}`, outsiderToken: null };
  const templateIds = [];

  h.onCleanup(async () => {
    if (templateIds.length) {
      try { await sb.from('email_template_versions').delete().in('template_id', templateIds); } catch {}
      try { await sb.from('email_templates').delete().in('id', templateIds); } catch {}
    }
    try {
      const { data } = await sb.from('email_deliveries').select('id').like('idempotency_key', `email_studio:tpl_${TAG}%`);
      const ids = (data ?? []).map(d => d.id);
      if (ids.length) {
        await sb.from('app_events').delete().in('source_entity_id', ids);
        await sb.from('email_deliveries').delete().in('id', ids);
      }
    } catch {}
    try { await sb.from('app_users').delete().eq('id', ctx.outsiderId); } catch {}
  });

  /** The starter document, optionally with every relative asset rewritten to an absolute URL. */
  const starterSchema = ({ hostAssets = false } = {}) => {
    const doc = createStarterEmailDocument('onboarding');
    if (!hostAssets) return doc;
    // Rewrite only the relative sources; tokens like {{recipient.profilePhotoUrl}} stay tokens and
    // are supplied as variables, exactly as a real send would.
    const json = JSON.stringify(doc).replace(/"\/assets\/images\/email\/([^"]+)"/g, '"https://cdn.example.com/$1"');
    return JSON.parse(json);
  };

  const seedTemplate = async (suffix, { published = true, hostAssets = false, subject = 'Welcome', strayAsset = null } = {}) => {
    const key = `tpl_${TAG}_${suffix}`.toLowerCase();
    const { data: tpl, error } = await sb.from('email_templates').insert({
      template_key: key, name: `Studio E2E ${suffix}`, family: 'onboarding', trigger_key: 'onboarding.welcome',
    }).select('id').single();
    expect(!error, `seed template: ${error?.message ?? ''}`);
    templateIds.push(tpl.id);

    const { error: verErr } = await sb.from('email_template_versions').insert({
      template_id: tpl.id, version_no: 1, subject,
      editor_schema: strayAsset
        // An image the resolver has no mapping for, to prove resolution did not become a
        // catch-all that invents URLs.
        ? JSON.parse(JSON.stringify(starterSchema({ hostAssets }))
            .replace(/"https:\/\/cdn\.example\.com\/company-logo\.png"/, JSON.stringify(strayAsset)))
        : starterSchema({ hostAssets }),
      status: published ? 'published' : 'draft',
    });
    expect(!verErr, `seed version: ${verErr?.message ?? ''}`);
    return key;
  };

  /**
   * Every token the starter document actually carries, DERIVED from the document rather than
   * hand-listed. A hardcoded list silently rots the moment the starter gains a token — which it
   * already had: an earlier version of this suite listed 8 and the template carries 22.
   * URL-ish tokens get absolute values so they also satisfy the hosted-asset rule.
   */
  const deriveVariables = subject => {
    const source = renderEmailMjml(starterSchema({ hostAssets: true }), subject ?? 'Welcome') + ' ' + (subject ?? '');
    const vars = {};
    for (const m of source.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      const key = m[1];
      vars[key] = /url|photo|image|avatar|logo/i.test(key)
        ? `https://cdn.example.com/${key.replace(/\W+/g, '-')}.png`
        : `E2E ${key}`;
    }
    return vars;
  };
  const ALL_VARIABLES = deriveVariables();

  const send = (args, token = A) => api('email/template-send', token, args);

  h.section('Studio send › Access control');

  await test('setup: a REAL user without the send permission', async () => {
    const { error } = await sb.from('app_users').insert({
      id: ctx.outsiderId, username: `${TAG}_tpl_out`, full_name: `Studio E2E Outsider ${TAG}`,
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed: ${error?.message ?? ''}`);
    ctx.outsiderToken = mint({ id: ctx.outsiderId, username: `${TAG}_tpl_out`, role: 'employee', department_id: null });
  });

  await test('sending is denied without platform.email_templates.send', async () => {
    const key = await seedTemplate('perm', { hostAssets: true });
    const r = await send({ templateKey: key, to: 'nobody@example.com', variables: ALL_VARIABLES }, ctx.outsiderToken);
    fails(r, 'an ordinary employee must not send platform email');
    expect(r.status === 403 || r.status === 401, `expected 403/401, got ${r.status}`);
  });

  h.section('Studio send › Refusals');

  await test('an unknown template key is a 404', async () => {
    const r = await send({ templateKey: `no_such_template_${TAG}`, to: 'a@example.com' });
    fails(r, 'unknown template');
    expect(r.status === 404, `expected 404, got ${r.status}`);
    expect(r.body.data.refusal === 'template_not_found', `got ${r.body.data.refusal}`);
  });

  await test('⛔ a template with no PUBLISHED version cannot be sent', async () => {
    // Publishing is the control that says a human approved this content for real recipients.
    const key = await seedTemplate('draft', { published: false, hostAssets: true });
    const r = await send({ templateKey: key, to: 'a@example.com', variables: ALL_VARIABLES });
    fails(r, 'a draft is not sendable');
    expect(r.status === 422, `expected 422, got ${r.status}`);
    expect(r.body.data.refusal === 'no_published_version', `got ${r.body.data.refusal}`);
    expect(/publish/i.test(r.body.message ?? ''), `it must say to publish — got ${r.body.message}`);
  });

  await test('⭐ missing variables are REFUSED and named — never sent as placeholders', async () => {
    // A placeholder reaching a real recipient is permanent; a refusal is visible and fixable.
    const key = await seedTemplate('vars', { hostAssets: true });
    const r = await send({ templateKey: key, to: 'a@example.com', variables: {} });
    fails(r, 'unresolved variables');
    expect(r.status === 422, `expected 422, got ${r.status}`);
    expect(r.body.data.refusal === 'unresolved_variables', `got ${r.body.data.refusal}`);
    expect(Array.isArray(r.body.data.detail) && r.body.data.detail.length > 0,
      'every missing variable is named so the caller can supply it');
    expect(r.body.data.detail.includes('recipient.firstName'),
      `the starter's own tokens are reported — got ${JSON.stringify(r.body.data.detail)}`);
  });

  await test('⭐ an unresolved token in the SUBJECT is caught too', async () => {
    // The subject is the most visible line in an email — the worst place for a placeholder, and
    // the easiest to miss if only the body is checked.
    const key = await seedTemplate('subj', { hostAssets: true, subject: 'Welcome to {{company.name}}' });
    const vars = { ...deriveVariables('Welcome to {{company.name}}') };
    delete vars['company.name'];
    const r = await send({ templateKey: key, to: 'a@example.com', variables: vars });
    fails(r, 'subject token unresolved');
    expect(r.body.data.refusal === 'unresolved_variables', `got ${r.body.data.refusal}`);
    expect(r.body.data.detail.includes('company.name'),
      `the subject's token is named — got ${JSON.stringify(r.body.data.detail)}`);
  });

  await test('⭐ AUTHORED asset paths are RESOLVED to public URLs, not refused', async () => {
    // The Studio authors `/assets/images/email/...`. Those used to be refused; the server now maps
    // them to the published public bucket at send time, so a template stays portable and no author
    // has to paste an infrastructure URL into content.
    const key = await seedTemplate('resolved', { hostAssets: false });
    const r = await send({ templateKey: key, to: 'a@example.com', variables: ALL_VARIABLES });
    ok(r, `authored paths must resolve: ${r.body.message ?? ''}`);
    expect(r.body.data.dryRun === true, 'still a dry run');
  });

  await test('⛔ a relative path OUTSIDE the authored prefix is still REFUSED', async () => {
    // Resolution widens what can be sent; it must not weaken the guarantee. An unknown relative
    // path is NOT pointed at the email bucket — inventing a URL would swap a visible refusal for a
    // broken image in a real inbox.
    const key = await seedTemplate('stray', { hostAssets: true, strayAsset: '/uploads/not-an-email-asset.png' });
    const r = await send({ templateKey: key, to: 'a@example.com', variables: ALL_VARIABLES });
    fails(r, 'a stray relative path cannot be reached by a mail client');
    expect(r.status === 422, `expected 422, got ${r.status}`);
    expect(r.body.data.refusal === 'unhosted_assets', `got ${r.body.data.refusal}`);
    expect((r.body.data.detail ?? []).includes('/uploads/not-an-email-asset.png'),
      `the offending path is named — got ${JSON.stringify(r.body.data.detail)}`);
  });

  h.section('Studio send › Compile and dry run');

  await test('⭐ a valid template COMPILES server-side and reports its version', async () => {
    const key = await seedTemplate('ok', { hostAssets: true });
    const r = await send({ templateKey: key, to: 'studio-dry@example.com', variables: ALL_VARIABLES });
    ok(r, `template-send dry run: ${r.body.message ?? ''}`);

    const d = r.body.data;
    expect(d.dryRun === true, `omitting dryRun MUST default to a dry run — got ${d.dryRun}`);
    expect(d.templateKey === key, `template key echoed, got ${d.templateKey}`);
    expect(d.versionNo === 1, `the PUBLISHED version is reported, got ${d.versionNo}`);
    expect(d.recipients.includes('studio-dry@example.com'), 'recipients echoed');
    expect(d.providerMessageId === null, 'a dry run has no provider message id');
    expect(/Nothing was sent/i.test(d.message), `it must say nothing was sent — got ${d.message}`);
  });

  await test('⛔ a dry run creates NO delivery record and NO app_event', async () => {
    // The explicit rule: preview/dry-run must never fabricate a sent/delivered record.
    const key = await seedTemplate('norecord', { hostAssets: true });
    const r = await send({ templateKey: key, to: 'studio-dry2@example.com', variables: ALL_VARIABLES });
    ok(r, 'dry run');
    expect(r.body.data.deliveryId === null, `a dry run must not open a delivery — got ${r.body.data.deliveryId}`);

    const { count } = await sb.from('email_deliveries').select('id', { count: 'exact', head: true })
      .eq('use_case', 'email_studio').like('idempotency_key', `email_studio:${key}%`);
    expect((count ?? 0) === 0, `no email_deliveries row may exist for a dry run, found ${count}`);

    const { count: evCount } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'platform.email.template_sent')
      .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString());
    expect((evCount ?? 0) === 0, `a dry run emits no template_sent event, found ${evCount}`);
  });

  await test('the route schema rejects a malformed request', async () => {
    const r = await send({ to: 'a@example.com' });
    fails(r, 'templateKey is required');
    expect(r.status === 400, `expected 400 from the schema, got ${r.status}`);
  });

  h.section('Studio send › Icon assets (Gmail strips inline SVG)');

  await test('⭐⭐ EVERY icon x colour is published as a PNG in the public bucket', async () => {
    // The renderer emits a URL for any (icon, colour) the picker offers. If even one asset is
    // missing, that combination is a broken image in a real inbox — and nothing else would catch
    // it, because the markup would still be perfectly well-formed.
    const colors = Object.keys(EMAIL_ICON_COLORS);
    const expected = EMAIL_ICON_CHOICES.map(name => `${emailIconFileName(name)}.png`).sort();
    expect(expected.length === 34, `the picker offers 34 icons, got ${expected.length}`);
    expect(colors.length === 7, `the palette is 7 colours, got ${colors.length}`);

    const missing = [];
    const wrongType = [];
    for (const color of colors) {
      const { data, error } = await sb.storage.from('branding').list(`email/icons/${color}`, { limit: 500 });
      expect(!error, `list email/icons/${color}: ${error?.message ?? ''}`);
      const present = new Map((data ?? []).map(entry => [entry.name, entry]));
      for (const file of expected) {
        const entry = present.get(file);
        if (!entry) { missing.push(`${color}/${file}`); continue; }
        if (entry.metadata?.mimetype !== 'image/png') wrongType.push(`${color}/${file}=${entry.metadata?.mimetype}`);
      }
    }
    expect(missing.length === 0, `unpublished icon assets: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10})` : ''}`);
    expect(wrongType.length === 0, `icons must be image/png: ${wrongType.slice(0, 10).join(', ')}`);
  });

  await test('⭐ published icons are fetchable with NO session, as a mail client fetches them', async () => {
    // The service-role listing above proves the objects exist. It does NOT prove they are publicly
    // readable — and a recipient's mail client has no cookie, no bearer token and no signed URL.
    const base = `${h.env.SUPABASE_URL}/storage/v1/object/public/branding/email/icons`;
    for (const color of Object.keys(EMAIL_ICON_COLORS)) {
      const file = `${emailIconFileName(EMAIL_ICON_CHOICES[0])}.png`;
      const res = await fetch(`${base}/${color}/${file}`);
      expect(res.status === 200, `anonymous GET ${color}/${file} -> ${res.status}`);
      expect(res.headers.get('content-type') === 'image/png', `content-type ${res.headers.get('content-type')}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.length > 0 && bytes.subarray(1, 4).toString() === 'PNG', 'the body is a real PNG');
    }
  });

  h.section('Studio send › Production-email compatibility gate');

  await test('⭐⭐ the REAL welcome template passes the compatibility gate', async () => {
    // This is the assertion that closes the Gmail defect end to end. The gate refuses any compiled
    // body containing inline <svg>, or an icon that is not on the approved asset host — so a
    // successful send here PROVES the production HTML has zero inline SVG and every icon hosted.
    // Asserting the refusal rule rather than counting tags is deliberate: it keeps holding as the
    // template changes.
    const key = await seedTemplate('icons', { hostAssets: false });
    const r = await send({ templateKey: key, to: 'studio-icons@example.com', variables: ALL_VARIABLES });
    ok(r, `the welcome template must survive the compatibility gate: ${r.body.message ?? ''}`);
    expect(r.body.data.dryRun === true, 'still a dry run');
  });

  await test('⛔ a localhost URL in a variable VALUE is refused as incompatible', async () => {
    // Proves the gate actually fires on the FINAL bytes. A staging URL arriving through a supplied
    // value is the realistic way one leaks — the template itself is clean, so no earlier check sees
    // it. Recipients would get a link that resolves only on the machine that built the message.
    const key = await seedTemplate('localurl', { hostAssets: true });
    const vars = { ...ALL_VARIABLES, 'onboarding.hubUrl': 'http://localhost:8888/onboarding' };
    const r = await send({ templateKey: key, to: 'a@example.com', variables: vars });
    fails(r, 'a localhost URL cannot reach a recipient');
    expect(r.status === 422, `expected 422, got ${r.status}`);
    expect(r.body.data.refusal === 'incompatible_html', `got ${r.body.data.refusal}`);
    expect((r.body.data.detail ?? []).includes('local_url'),
      `the offending rule is named — got ${JSON.stringify(r.body.data.detail)}`);
  });

  await test('⛔ a placeholder smuggled in through a variable VALUE is refused', async () => {
    // The pre-compile pass checks the TEMPLATE for unresolved tokens; it structurally cannot see a
    // token that arrives inside a value. Only a check on the final HTML catches it.
    const key = await seedTemplate('tokenvalue', { hostAssets: true });
    const vars = { ...ALL_VARIABLES, 'company.name': 'Acme {{company.legalName}}' };
    const r = await send({ templateKey: key, to: 'a@example.com', variables: vars });
    fails(r, 'a visible {{token}} in delivered mail is permanent');
    expect(r.body.data.refusal === 'incompatible_html', `got ${r.body.data.refusal}`);
    expect((r.body.data.detail ?? []).includes('unresolved_variable'),
      `the offending rule is named — got ${JSON.stringify(r.body.data.detail)}`);
  });
}
