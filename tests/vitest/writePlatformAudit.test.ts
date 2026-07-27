/**
 * tests/vitest/writePlatformAudit.test.ts
 *
 * Unit tests for writePlatformAudit (netlify/functions/lib/appEvents.ts).
 *
 * Purpose:
 *   - Prove fail-closed behaviour: a DB error MUST throw (status 500), never be swallowed
 *   - Prove success path: a successful insert resolves without throwing
 *   - Prove reqId injection: the current request's reqId is merged into changes when present
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all I/O imports of appEvents.ts before importing the module ──────────

vi.mock('../../netlify/functions/lib/db', () => ({
  sb: {
    from: vi.fn(),
  },
}));

vi.mock('../../netlify/functions/lib/recipientResolver', () => ({
  resolveRecipients: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../netlify/functions/lib/notify', () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../netlify/functions/lib/communications', () => ({
  emitSignal: vi.fn().mockResolvedValue(undefined),
}));

// reqContext is NOT mocked — we use the real implementation to verify reqId injection.

// ── Imports (after mocks are hoisted) ─────────────────────────────────────────

import { writePlatformAudit } from '../../netlify/functions/lib/appEvents';
import { runWithReqContext }  from '../../netlify/functions/lib/reqContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof writePlatformAudit>[0]> = {}) {
  return {
    action:    'test.action',
    tableName: 'test_table',
    recordId:  'REC-TEST-001',
    actorId:   'usr_actor',
    changes:   { key: 'value' },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('writePlatformAudit — fail-closed behaviour', () => {
  let sbFrom: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { sb } = await import('../../netlify/functions/lib/db');
    sbFrom = sb.from as ReturnType<typeof vi.fn>;
    sbFrom.mockReset();
  });

  it('throws when the DB insert returns an error (never swallows)', async () => {
    sbFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        error: { message: 'connection refused' },
      }),
    });

    await expect(writePlatformAudit(makeInput())).rejects.toThrow(
      'Platform audit write failed',
    );
  });

  it('thrown error carries status 500', async () => {
    sbFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        error: { message: 'unique violation' },
      }),
    });

    const err = await writePlatformAudit(makeInput()).catch(e => e as Error & { status?: number });
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(500);
  });

  it('resolves (returns undefined) when insert succeeds', async () => {
    sbFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    await expect(writePlatformAudit(makeInput())).resolves.toBeUndefined();
  });

  it('includes the action name in the error message for diagnostics', async () => {
    sbFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        error: { message: 'DB down' },
      }),
    });

    let caughtErr: unknown;
    try {
      await writePlatformAudit(makeInput({ action: 'ticket.created' }));
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(Error);
    expect((caughtErr as Error).message).toContain('ticket.created');
  });
});

describe('writePlatformAudit — reqId correlation injection', () => {
  let sbFrom: ReturnType<typeof vi.fn>;
  let capturedInsertArg: Record<string, unknown> | null = null;

  beforeEach(async () => {
    capturedInsertArg = null;
    const { sb } = await import('../../netlify/functions/lib/db');
    sbFrom = sb.from as ReturnType<typeof vi.fn>;
    sbFrom.mockReset();
    sbFrom.mockReturnValue({
      insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        capturedInsertArg = row;
        return Promise.resolve({ error: null });
      }),
    });
  });

  it('injects reqId into changes when a request context is active', async () => {
    const TEST_REQ_ID = 'test-req-id-abc123';

    await runWithReqContext({ reqId: TEST_REQ_ID }, () =>
      writePlatformAudit(makeInput({ changes: { field: 'data' } })),
    );

    expect(capturedInsertArg).not.toBeNull();
    const changes = capturedInsertArg!.changes as Record<string, unknown>;
    expect(changes.reqId).toBe(TEST_REQ_ID);
    expect(changes.field).toBe('data'); // original changes preserved
  });

  it('does not inject reqId when no request context is active (e.g. background job)', async () => {
    // Outside runWithReqContext the store is empty — no reqId.
    await writePlatformAudit(makeInput({ changes: { field: 'data' } }));

    expect(capturedInsertArg).not.toBeNull();
    const changes = capturedInsertArg!.changes as Record<string, unknown>;
    expect(changes.reqId).toBeUndefined();
    expect(changes.field).toBe('data');
  });

  it('does not mutate the original changes object passed by the caller', async () => {
    const TEST_REQ_ID = 'test-req-id-xyz';
    const originalChanges = { myField: 'original' };

    await runWithReqContext({ reqId: TEST_REQ_ID }, () =>
      writePlatformAudit(makeInput({ changes: originalChanges })),
    );

    // The spread must produce a NEW object; the caller's reference is untouched.
    expect(originalChanges).not.toHaveProperty('reqId');
  });
});
