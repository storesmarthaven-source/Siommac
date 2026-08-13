/** Live control-plane coverage for Design System Studio. */
export const title = 'Design System Studio';

const config = (colour) => ({
  schemaVersion: 1,
  theme: { tokens: { '--ui-tab-indicator': '#315d8c' } },
  recipes: { button: { overrides: { '--ui-button-primary-bg': colour, '--ui-button-radius': '9px' } } },
});

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), employee: mint(b) };
  const { data: originalTheme } = await sb.from('app_theme').select('*').eq('scope', 'global').maybeSingle();
  const { data: originalDrafts } = await sb.from('app_theme_drafts').select('*').eq('scope', 'global');
  const originalVersion = Number(originalTheme?.version ?? 0);

  h.onCleanup(async () => {
    await sb.from('app_theme_drafts').delete().eq('scope', 'global');
    if (originalDrafts?.length) await sb.from('app_theme_drafts').insert(originalDrafts);
    await sb.from('app_theme_versions').delete().eq('scope', 'global').gt('version', originalVersion);
    if (originalTheme) await sb.from('app_theme').upsert(originalTheme, { onConflict: 'scope' });
    await sb.from('app_events').delete().like('dedupe_key', 'platform.theme.%:global:%');
    await sb.from('audit_logs').delete().eq('table_name', 'app_theme').like('action', 'platform.theme.%');
  });

  let draft;
  let published;

  await test('ACCESS: non-admin cannot read Studio state', async () => {
    fails(await api('theme/studio/get', T.employee, {}), 'employee should not read Design System Studio');
  });

  await test('validate accepts governed configuration and rejects arbitrary CSS', async () => {
    const valid = await api('theme/studio/validate', T.admin, { configuration: config('#173f6f') });
    ok(valid, 'valid configuration rejected');
    expect(valid.body.data.validation.valid === true, 'configuration did not validate');
    const invalid = await api('theme/studio/validate', T.admin, { configuration: {
      schemaVersion: 1, theme: { tokens: { '--ui-brand': 'red; display:none' } }, recipes: { button: { overrides: {} } },
    } });
    ok(invalid, 'validation request failed');
    expect(invalid.body.data.validation.valid === false, 'arbitrary CSS was accepted');
  });

  await test('draft/save persists typed config with optimistic revision', async () => {
    const state = await api('theme/studio/get', T.admin, {}); ok(state, 'state read failed');
    const expectedRevision = state.body.data.draft?.revision ?? 0;
    const saved = await api('theme/studio/draft/save', T.admin, { configuration: config('#173f6f'), expectedRevision });
    ok(saved, 'draft save failed');
    draft = saved.body.data.draft;
    expect(draft.revision === expectedRevision + 1, 'draft revision did not increment');
    expect(draft.configuration.recipes.button.overrides['--ui-button-primary-bg'] === '#173f6f', 'Button recipe shape changed');
    fails(await api('theme/studio/draft/save', T.admin, { configuration: config('#204f82'), expectedRevision }), 'stale draft write should conflict');
  });

  await test('publish validates, versions and updates runtime tokens', async () => {
    const summary = `${h.TAG} Button recipe publish`;
    const result = await api('theme/studio/publish', T.admin, { draftId: draft.id, expectedRevision: draft.revision, summary });
    ok(result, 'publish failed');
    published = result.body.data.published;
    expect(published.version === originalVersion + 1, 'published version did not increment');
    const runtime = await api('theme/get', T.admin, {}); ok(runtime, 'runtime theme read failed');
    expect(runtime.body.data.tokens['--ui-button-primary-bg'] === '#173f6f', 'canonical runtime did not receive published Button recipe');
    expect(runtime.body.data.tokens['--ui-tab-indicator'] === '#315d8c', 'independent tab semantic was lost');
  });

  await test('publish emits app event and immutable audit side effects', async () => {
    const { data: event } = await sb.from('app_events').select('id').eq('event_type', 'platform.theme.published').eq('source_entity_id', 'global').eq('actor_user_id', admin.id).maybeSingle();
    expect(!!event, 'publish app_event missing');
    const { data: audit } = await sb.from('audit_logs').select('id').eq('action', 'platform.theme.published').eq('record_id', 'global').eq('user_id', admin.id).maybeSingle();
    expect(!!audit, 'publish audit_log missing');
  });

  await test('history exposes the immutable version and rollback creates a new version', async () => {
    const history = await api('theme/studio/history', T.admin, {}); ok(history, 'history failed');
    expect(history.body.data.versions.some(v => v.version === published.version), 'published version absent from history');
    const rolled = await api('theme/studio/rollback', T.admin, { version: published.version, summary: `${h.TAG} rollback verification` });
    ok(rolled, 'rollback failed');
    expect(rolled.body.data.published.version === published.version + 1, 'rollback did not create an immutable new version');
    const { data: event } = await sb.from('app_events').select('id').eq('event_type', 'platform.theme.rolled_back').eq('source_entity_id', 'global').maybeSingle();
    expect(!!event, 'rollback app_event missing');
  });
}
