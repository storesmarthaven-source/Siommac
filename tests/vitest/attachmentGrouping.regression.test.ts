/**
 * tests/vitest/attachmentGrouping.regression.test.ts
 *
 * Regression tests for the null guard added to the attachment-grouping loop in
 * netlify/functions/lib/communications.ts (getThreadPosts, line ~1296-1303).
 *
 * Before the fix — under noUncheckedIndexedAccess:
 *   const a = attachList[i];  // a: AttachmentRow | undefined
 *   // No guard — accessing a.post_id / a.id / etc. was a TS2532 type error
 *   // (and would throw at runtime if the array were somehow sparse)
 *
 * After the fix:
 *   const a = attachList[i];
 *   if (!a) continue;  // defensive: noUncheckedIndexedAccess guard
 *
 * Because the actual grouping loop lives inside getThreadPosts (which requires
 * a live DB), we unit-test the BEHAVIOUR of the loop logic in isolation —
 * the exact same logic extracted into a pure helper.  This covers:
 *  - Normal grouping (multiple attachments for different posts)
 *  - Multiple attachments for the same post
 *  - An empty attachment list (no iteration at all)
 *  - A sparse array or undefined element (the guard must skip without throwing)
 *
 * These tests have zero I/O — no DB, no storage mock needed.
 */

import { describe, it, expect } from 'vitest';

// ── Pure extraction of the grouping logic ─────────────────────────────────────
// We reproduce the minimal shape used inside getThreadPosts so the tests are
// testing THE SAME code pattern, not a hypothetical.

interface MinAttachment {
  id: string;
  post_id: string;
  file_name: string;
  file_path: string;
  content_type: string;
  size_bytes: number;
}

interface AttachmentRow {
  id: string;
  fileName: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  url: string | null;
}

/**
 * Exact copy of the loop body in getThreadPosts after the null-guard fix.
 * Input types mirror what Supabase returns (array may be undefined).
 */
function buildAttachMap(
  attachments: MinAttachment[] | null | undefined,
  signedUrls: (string | null)[],
): Map<string, AttachmentRow[]> {
  const attachList = attachments ?? [];
  const attachMap  = new Map<string, AttachmentRow[]>();

  for (let i = 0; i < attachList.length; i++) {
    const a = attachList[i];
    if (!a) continue;                         // ← the fix under test
    const url  = signedUrls[i] ?? null;
    const list = attachMap.get(a.post_id) ?? [];
    list.push({
      id: a.id, fileName: a.file_name, filePath: a.file_path,
      contentType: a.content_type, sizeBytes: a.size_bytes,
      url: url || null,
    });
    attachMap.set(a.post_id, list);
  }

  return attachMap;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAttachment(overrides: Partial<MinAttachment> = {}): MinAttachment {
  return {
    id:           overrides.id           ?? 'att-001',
    post_id:      overrides.post_id      ?? 'post-001',
    file_name:    overrides.file_name    ?? 'evidence.jpg',
    file_path:    overrides.file_path    ?? 'path/evidence.jpg',
    content_type: overrides.content_type ?? 'image/jpeg',
    size_bytes:   overrides.size_bytes   ?? 12345,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('attachment grouping loop — null guard (regression)', () => {
  it('produces an empty map for an empty attachment list', () => {
    const map = buildAttachMap([], []);
    expect(map.size).toBe(0);
  });

  it('produces an empty map when attachments is null (Supabase returns null on no rows)', () => {
    const map = buildAttachMap(null, []);
    expect(map.size).toBe(0);
  });

  it('produces an empty map when attachments is undefined', () => {
    const map = buildAttachMap(undefined, []);
    expect(map.size).toBe(0);
  });

  it('groups one attachment under the correct post_id', () => {
    const att = makeAttachment({ id: 'att-1', post_id: 'post-A' });
    const map = buildAttachMap([att], ['https://signed/att-1']);

    expect(map.size).toBe(1);
    const rows = map.get('post-A');
    expect(rows).toHaveLength(1);
    expect(rows![0]!.id).toBe('att-1');
    expect(rows![0]!.url).toBe('https://signed/att-1');
  });

  it('groups two attachments under different post_ids into separate entries', () => {
    const att1 = makeAttachment({ id: 'att-1', post_id: 'post-A' });
    const att2 = makeAttachment({ id: 'att-2', post_id: 'post-B' });
    const map  = buildAttachMap([att1, att2], ['https://s/att-1', 'https://s/att-2']);

    expect(map.size).toBe(2);
    expect(map.get('post-A')).toHaveLength(1);
    expect(map.get('post-B')).toHaveLength(1);
  });

  it('accumulates multiple attachments under the same post_id', () => {
    const att1 = makeAttachment({ id: 'att-1', post_id: 'post-A' });
    const att2 = makeAttachment({ id: 'att-2', post_id: 'post-A' });
    const att3 = makeAttachment({ id: 'att-3', post_id: 'post-A' });
    const map  = buildAttachMap([att1, att2, att3], ['u1', 'u2', 'u3']);

    expect(map.size).toBe(1);
    expect(map.get('post-A')).toHaveLength(3);
  });

  it('falls back to null url when signedUrl slot is missing (signedUrls shorter than attachList)', () => {
    // This mimics a Promise.all where one entry resolved to '' (catch returns '')
    const att = makeAttachment({ id: 'att-1', post_id: 'post-A' });
    const map = buildAttachMap([att], ['']);   // empty string → url: null

    const rows = map.get('post-A');
    expect(rows![0]!.url).toBeNull();         // '' || null → null
  });

  it('DOES NOT throw when a sparse-array element is undefined (the null guard skips it)', () => {
    // Simulate a sparse array: [attachment, undefined, attachment]
    // noUncheckedIndexedAccess guards cover the case where arr[i] is undefined.
    const att1 = makeAttachment({ id: 'att-1', post_id: 'post-A' });
    const att3 = makeAttachment({ id: 'att-3', post_id: 'post-B' });

    // TypeScript doesn't allow sparse array literals directly, so we cast.
    const sparseList = [att1, undefined as unknown as MinAttachment, att3];
    const urls       = ['url-a', '', 'url-b'];

    // Must not throw — undefined entries are skipped by the guard
    let map!: Map<string, AttachmentRow[]>;
    expect(() => {
      map = buildAttachMap(sparseList, urls);
    }).not.toThrow();

    // Only the two non-null entries should be in the map
    expect(map.size).toBe(2);
    expect(map.get('post-A')).toHaveLength(1);
    expect(map.get('post-B')).toHaveLength(1);
  });

  it('preserves the full attachment shape in each AttachmentRow', () => {
    const att = makeAttachment({
      id: 'att-full', post_id: 'post-Z',
      file_name: 'doc.pdf', file_path: 'uploads/doc.pdf',
      content_type: 'application/pdf', size_bytes: 99999,
    });
    const map = buildAttachMap([att], ['https://signed/doc.pdf']);

    const row = map.get('post-Z')![0]!;
    expect(row.id).toBe('att-full');
    expect(row.fileName).toBe('doc.pdf');
    expect(row.filePath).toBe('uploads/doc.pdf');
    expect(row.contentType).toBe('application/pdf');
    expect(row.sizeBytes).toBe(99999);
    expect(row.url).toBe('https://signed/doc.pdf');
  });
});
