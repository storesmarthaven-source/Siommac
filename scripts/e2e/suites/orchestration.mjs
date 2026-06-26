// E2E — Cross-module orchestration: unified record timeline.
// Verifies POST /api/orchestration/timeline/get aggregates the existing platform
// tables (app_events + handoff_outbox + ...) for one record, newest-first, and is
// gated by the source record's own view permission (no leak).

export const title = 'Orchestration';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb } = h;
  const { admin, b } = h.users;

  const recordId = `${h.TAG}-INC`;
  const rec = { module: 'hse', recordType: 'incident', recordId };

  // Seed a small cross-table timeline for a synthetic incident record.
  h.onCleanup(async () => {
    await sb.from('app_events').delete().eq('source_entity_id', recordId);
    await sb.from('handoff_outbox').delete().eq('source_entity_id', recordId);
  });

  h.section('Orchestration › Setup');
  await test('seed app_events + handoff for the record', async () => {
    const { error: e1 } = await sb.from('app_events').insert([
      { event_type: 'hse.incident.reported', source_module: 'hse', source_entity_type: 'incident', source_entity_id: recordId, actor_user_id: admin.id, severity: 'warning', payload: { tag: h.TAG } },
      { event_type: 'hse.incident.assigned', source_module: 'hse', source_entity_type: 'incident', source_entity_id: recordId, actor_user_id: admin.id, severity: 'info',    payload: { tag: h.TAG } },
    ]);
    expect(!e1, `seed app_events failed: ${e1?.message}`);
    const { error: e2 } = await sb.from('handoff_outbox').insert({
      source_module: 'hse', target_module: 'hr', source_entity_type: 'incident', source_entity_id: recordId,
      payload: { tag: h.TAG }, created_by: admin.id,
    });
    expect(!e2, `seed handoff failed: ${e2?.message}`);
  });

  h.section('Orchestration › Timeline');
  await test('timeline (admin) → aggregates events + handoff, newest-first', async () => {
    const r = await api('orchestration/timeline/get', mint(admin), rec);
    ok(r, 'timeline get');
    const items = r.body.data ?? [];
    expect(items.length >= 3, `expected >= 3 items, got ${items.length}`);
    expect(items.some(i => i.item_type === 'event'), 'has an event item');
    expect(items.some(i => i.item_type === 'handoff'), 'has a handoff item');
    const ts = items.map(i => new Date(i.created_at).getTime());
    expect(ts.every((t, i) => i === 0 || ts[i - 1] >= t), 'items are sorted newest-first');
  });

  await test('timeline handoff item points at the target module', async () => {
    const r = await api('orchestration/timeline/get', mint(admin), rec);
    const handoff = (r.body.data ?? []).find(i => i.item_type === 'handoff');
    expect(handoff && /→ hr/.test(handoff.title), `handoff title names the target — got ${handoff?.title}`);
  });

  h.section('Orchestration › Access control');
  await test('ACCESS: user without source-module view → denied', async () => {
    // b = employee1 holds hse.incidents.view (incidents are broadly viewable) but
    // NOT hr.view — so an HR-record timeline must be denied (gate fires before any read).
    fails(await api('orchestration/timeline/get', mint(b), { module: 'hr', recordType: 'employee', recordId }),
      'employee lacks hr.view → denied');
  });

  await test('ACCESS: unmapped module → denied (fail closed)', async () => {
    fails(await api('orchestration/timeline/get', mint(admin), { module: 'mystery', recordType: 'thing', recordId }),
      'unmapped module has no view permission → denied');
  });

  // ── Record links (requires migration 20260713000000; skips cleanly if absent) ──
  h.section('Orchestration › Record Links');
  const { error: rlMissing } = await sb.from('record_links').select('id').limit(1);
  if (rlMissing) {
    h.log?.(`record_links not present (${rlMissing.message}) — apply migration 20260713000000; skipping link tests.`);
    return;
  }

  const empId = `${h.TAG}-EMP`;
  const linkArgs = {
    source: { module: 'hse', recordType: 'incident', recordId, title: 'Test incident' },
    target: { module: 'hr',  recordType: 'employee', recordId: empId, title: 'Test employee' },
    relationshipType: 'related_to',
  };
  h.onCleanup(async () => { await sb.from('record_links').delete().eq('source_record_id', recordId); });

  await test('record-links/create (admin) → links two records', async () => {
    const r = await api('orchestration/record-links/create', mint(admin), linkArgs);
    ok(r, 'link create');
    expect(r.body.data?.relationship_type === 'related_to', 'relationship persisted');
  });
  await test('record-links/list shows the link on the SOURCE record', async () => {
    const r = await api('orchestration/record-links/list', mint(admin), { module: 'hse', recordType: 'incident', recordId });
    ok(r); expect((r.body.data ?? []).some(l => l.target_record_id === empId), 'link present on source');
  });
  await test('record-links/list shows the link on the TARGET record (bidirectional)', async () => {
    const r = await api('orchestration/record-links/list', mint(admin), { module: 'hr', recordType: 'employee', recordId: empId });
    ok(r); expect((r.body.data ?? []).some(l => l.source_record_id === recordId), 'link present on target');
  });
  await test('record-links/create is idempotent (upsert, no duplicate)', async () => {
    await api('orchestration/record-links/create', mint(admin), linkArgs);
    const r = await api('orchestration/record-links/list', mint(admin), { module: 'hse', recordType: 'incident', recordId });
    const matches = (r.body.data ?? []).filter(l => l.target_record_id === empId && l.relationship_type === 'related_to');
    expect(matches.length === 1, `expected exactly 1 link, got ${matches.length}`);
  });
  await test('ACCESS: linking an HR record without hr.view → denied', async () => {
    // b can view the incident (source) but not the HR employee (target) → must be denied.
    fails(await api('orchestration/record-links/create', mint(b), linkArgs), 'employee lacks hr.view on target → denied');
  });
  await test('record-links/delete (admin) → removed', async () => {
    const list = await api('orchestration/record-links/list', mint(admin), { module: 'hse', recordType: 'incident', recordId });
    const id = (list.body.data ?? []).find(l => l.target_record_id === empId)?.id;
    expect(id, 'have a link id to delete');
    ok(await api('orchestration/record-links/delete', mint(admin), { id }), 'delete');
    const after = await api('orchestration/record-links/list', mint(admin), { module: 'hse', recordType: 'incident', recordId });
    expect(!(after.body.data ?? []).some(l => l.id === id), 'link removed');
  });
}
