/**
 * scripts/e2e/suites/messengerPagination.mjs
 *
 * Boundary proofs for the messenger pagination + content-search contract
 * (docs/module-contracts/messenger-pagination-search.md — slice 2).
 * Requires operator migration 20260919000410 (RPCs + indexes), then
 * `npm run build:backend` + dev restart.
 */

export const title = 'Messenger — cursor pagination + content search';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const ctx = { threadIds: [], createdUserIds: [] };

  h.onCleanup(async () => {
    if (ctx.threadIds.length) {
      const posts = (await sb.from('message_posts').select('id').in('thread_id', ctx.threadIds)).data ?? [];
      if (posts.length) await sb.from('message_attachments').delete().in('post_id', posts.map(p => p.id));
      await sb.from('message_posts').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_participants').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_thread_access_grants').delete().in('thread_id', ctx.threadIds);
      await sb.from('notifications').delete().in('source_id', ctx.threadIds);
      await sb.from('message_threads').delete().in('id', ctx.threadIds);
    }
    if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds);
  });

  let A, B, C, tA, tB, tC;
  await test('setup: provision two participants + one outsider', async () => {
    const r = await acquireActors('employee', 3);
    [A, B, C] = r.actors;
    ctx.createdUserIds.push(...r.createdIds);
    tA = mint(A); tB = mint(B); tC = mint(C);
    expect(A && B && C, 'need three employee actors');
  });

  // ═══════════ Posts: BACKWARD keyset pages ═══════════
  let threadId;
  const NEEDLE = `${TAG}-needle-${Math.abs(TAG.length * 7919)}`;

  await test('setup: thread with 7 numbered posts (first carries the search needle)', async () => {
    const ct = await api('communications/messages/createThread', tA, {
      threadType: 'group', subject: `${TAG} paging`, participantUserIds: [B.id], body: `p1 ${NEEDLE}`,
    });
    ok(ct, 'createThread failed: ' + ct.body.message);
    threadId = ct.body.threadId;
    ctx.threadIds.push(threadId);
    for (let i = 2; i <= 7; i++) {
      const r = await api('communications/messages/post', tA, { threadId, body: `p${i}` });
      ok(r, `post p${i} failed: ` + r.body.message);
    }
  });

  const bodies = (r) => (r.body.data ?? []).map(p => (p.body ?? '').split(' ')[0]);

  let cursor1;
  await test('backward page 1 = the NEWEST 3, ascending, with a cursor', async () => {
    const r = await api('communications/messages/posts', tA, { threadId, limit: 3, direction: 'backward' });
    ok(r, 'page 1 failed: ' + r.body.message);
    expect(JSON.stringify(bodies(r)) === JSON.stringify(['p5', 'p6', 'p7']),
      `page 1 must be [p5,p6,p7] ascending, got ${JSON.stringify(bodies(r))}`);
    cursor1 = r.body.nextCursor;
    expect(cursor1, 'page 1 must carry a nextCursor');
  });

  let cursor2;
  await test('backward page 2 continues EXACTLY (no skip, no dupe)', async () => {
    const r = await api('communications/messages/posts', tA, { threadId, limit: 3, direction: 'backward', cursor: cursor1 });
    ok(r, 'page 2 failed: ' + r.body.message);
    expect(JSON.stringify(bodies(r)) === JSON.stringify(['p2', 'p3', 'p4']),
      `page 2 must be [p2,p3,p4], got ${JSON.stringify(bodies(r))}`);
    cursor2 = r.body.nextCursor;
    expect(cursor2, 'page 2 must carry a nextCursor');
  });

  await test('KEYSET STABILITY: a post landing mid-pagination does not disturb the remaining pages', async () => {
    const r0 = await api('communications/messages/post', tA, { threadId, body: 'p8-mid-pagination' });
    ok(r0, 'mid-pagination post failed');
    const r = await api('communications/messages/posts', tA, { threadId, limit: 3, direction: 'backward', cursor: cursor2 });
    ok(r, 'page 3 failed: ' + r.body.message);
    expect(JSON.stringify(bodies(r)) === JSON.stringify(['p1']),
      `page 3 must still be exactly [p1], got ${JSON.stringify(bodies(r))}`);
    expect(r.body.nextCursor === null, 'history exhausted — terminal cursor must be null');
  });

  await test('forward direction keeps the legacy ascending walk (composite keyset)', async () => {
    const r = await api('communications/messages/posts', tA, { threadId, limit: 3, direction: 'forward' });
    ok(r, 'forward page failed: ' + r.body.message);
    expect(JSON.stringify(bodies(r)) === JSON.stringify(['p1', 'p2', 'p3']),
      `forward page must be [p1,p2,p3], got ${JSON.stringify(bodies(r))}`);
  });

  await test('malformed posts cursor → 400', async () => {
    const r = await api('communications/messages/posts', tA, { threadId, limit: 3, direction: 'backward', cursor: 'not-a-cursor' });
    fails(r, 'malformed cursor must be rejected');
    expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  // ═══════════ Threads: SQL keyset pages ═══════════
  await test('setup: four more threads with staggered activity', async () => {
    for (let i = 2; i <= 5; i++) {
      const ct = await api('communications/messages/createThread', tA, {
        threadType: 'group', subject: `${TAG} paging ${i}`, participantUserIds: [B.id], body: `t${i} opener`,
      });
      ok(ct, `thread ${i} failed: ` + ct.body.message);
      ctx.threadIds.push(ct.body.threadId);
      await new Promise(r => setTimeout(r, 60));   // distinct last_post_at ordering
    }
  });

  await test('thread pages are EXACT-SIZE, newest activity first, no overlap, terminal null', async () => {
    // acquireActors may hand back a REUSED employee with unrelated threads —
    // scope the exactness walk to THIS run's tagged threads via SQL search.
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const r = await api('communications/messages/threads', tA, { tab: 'all', limit: 2, cursor, search: `${TAG} paging` });
      ok(r, `thread page ${page} failed: ` + r.body.message);
      const ids = (r.body.data ?? []).map(t => t.id);
      if (page < 2) expect(ids.length === 2, `page ${page} must have exactly 2 threads, got ${ids.length}`);
      for (const id of ids) {
        expect(!seen.includes(id), `thread ${id} appeared on two pages — cursor overlap`);
        seen.push(id);
      }
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.length === 5, `A must see exactly the 5 tagged threads across pages, got ${seen.length}`);
    expect(cursor === null, 'terminal thread cursor must be null');
    // Newest-activity-first within the tagged set.
    const first = await api('communications/messages/threads', tA, { tab: 'all', limit: 1, search: `${TAG} paging` });
    expect((first.body.data ?? [])[0]?.subject === `${TAG} paging 5`, 'newest-activity thread must lead page 1');
  });

  await test('SENT tab pages are SQL-exact (B authored nothing in the tagged threads)', async () => {
    const rA = await api('communications/messages/threads', tA, { tab: 'sent', limit: 2, search: `${TAG} paging` });
    ok(rA, 'A sent page failed');
    expect((rA.body.data ?? []).length === 2, 'A page 1 of tagged sent must be exactly 2');
    // B (possibly a reused actor with unrelated history) authored NOTHING in
    // this run's threads — none of them may appear in B's sent tab.
    const rB = await api('communications/messages/threads', tB, { tab: 'sent', limit: 10, search: `${TAG} paging` });
    ok(rB, 'B sent page failed');
    expect((rB.body.data ?? []).length === 0, 'B authored nothing in the tagged threads — sent must exclude them');
  });

  await test('thread SEARCH pages are SQL-side (subject match, exact size)', async () => {
    const r = await api('communications/messages/threads', tA, { tab: 'all', limit: 3, search: `${TAG} paging` });
    ok(r, 'thread search failed');
    expect((r.body.data ?? []).length === 3, `search page must be exactly 3, got ${(r.body.data ?? []).length}`);
    expect(r.body.nextCursor, 'search page 1 of 5 matches must carry a cursor');
  });

  await test('malformed threads cursor → 400', async () => {
    const r = await api('communications/messages/threads', tA, { tab: 'all', limit: 2, cursor: 'garbage' });
    fails(r, 'malformed thread cursor must be rejected');
    expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  // ═══════════ Content search ═══════════
  await test('participants FIND the needle; the hit carries thread + snippet', async () => {
    for (const [who, tok] of [['A', tA], ['B', tB]]) {
      const r = await api('communications/messages/search', tok, { query: NEEDLE });
      ok(r, `${who} search failed: ` + r.body.message);
      const hits = r.body.data ?? [];
      expect(hits.length === 1, `${who} must get exactly 1 hit, got ${hits.length}`);
      expect(hits[0].threadId === threadId, 'hit must reference the right thread');
      expect(hits[0].snippet.includes(NEEDLE), 'snippet must contain the needle');
    }
  });

  await test('ISOLATION: a non-participant searching the same needle sees NOTHING', async () => {
    const r = await api('communications/messages/search', tC, { query: NEEDLE });
    ok(r, 'C search failed: ' + r.body.message);
    expect((r.body.data ?? []).length === 0,
      'non-participant received content hits from a private thread — search leak');
  });

  await test('content search pages by keyset', async () => {
    // 4 more needle posts → 5 total matching; page size 2 → 2/2/1.
    for (let i = 0; i < 4; i++) {
      const r = await api('communications/messages/post', tA, { threadId, body: `extra ${NEEDLE} ${i}` });
      ok(r, `needle post ${i} failed`);
    }
    let cursor = null; let total = 0; const seen = new Set();
    for (let page = 0; page < 4; page++) {
      const r = await api('communications/messages/search', tA, { query: NEEDLE, limit: 2, cursor });
      ok(r, `search page ${page} failed`);
      for (const hit of r.body.data ?? []) {
        expect(!seen.has(hit.postId), 'search hit duplicated across pages');
        seen.add(hit.postId); total++;
      }
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(total === 5, `expected 5 needle hits across pages, got ${total}`);
    expect(cursor === null, 'terminal search cursor must be null');
  });

  await test('1-char query → 400; malformed search cursor → 400', async () => {
    const short = await api('communications/messages/search', tA, { query: 'x' });
    fails(short, 'sub-2-char query must be rejected');
    expect(short.status === 400, `expected 400 for short query, got ${short.status}`);
    const bad = await api('communications/messages/search', tA, { query: NEEDLE, cursor: 'zzz' });
    fails(bad, 'malformed search cursor must be rejected');
    expect(bad.status === 400, `expected 400 for bad cursor, got ${bad.status}`);
  });
}
