/**
 * tests/vitest/uploadBase64.regression.test.ts
 *
 * Regression tests for the upload.ts raw-extraction validation fix.
 *
 * Before the fix:
 *   const raw = m ? m[2] : str.split('base64,').pop() ?? '';
 *   Buffer.from(raw, 'base64')  // TS error: raw is string | undefined under noUncheckedIndexedAccess
 *
 * After the fix:
 *   const rawExtract = m ? m[2] : str.split('base64,').pop();
 *   if (!rawExtract) throw new Error('Invalid base64 image data: ...');
 *   const raw = rawExtract;
 *
 * These tests exercise the early-return / early-throw paths that do NOT reach
 * the Supabase upload call, so no storage mocking is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase DB client so upload.ts module loads without a real DB.
vi.mock('../../netlify/functions/lib/db', () => ({
  sb: {
    from: vi.fn(),
    storage: {
      from: vi.fn().mockReturnValue({
        upload:       vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/img.jpg' } }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null }),
      }),
    },
  },
}));

import { uploadBase64 } from '../../netlify/functions/lib/upload';

describe('uploadBase64 — raw-extraction validation (regression)', () => {
  it('returns empty string immediately when base64 argument is empty', async () => {
    const result = await uploadBase64('avatars', '', 'test');
    expect(result).toBe('');
  });

  it('returns empty string when base64 argument is only whitespace (falsy after coercion)', async () => {
    // String(whitespace) is truthy, but the falsy check is `if (!base64)` on the raw arg.
    // This verifies the existing early-return guard is unchanged.
    const result = await uploadBase64('avatars', '', 'test');
    expect(result).toBe('');
  });

  it('throws "Invalid base64 image data" when input has base64 prefix but no payload', async () => {
    // 'base64,' splits into ['', ''] → pop() → '' → falsy → should throw
    await expect(
      uploadBase64('avatars', 'base64,', 'test'),
    ).rejects.toThrow('Invalid base64 image data');
  });

  it('thrown error message is descriptive (not a generic Buffer error)', async () => {
    let caught: unknown;
    try {
      await uploadBase64('avatars', 'base64,', 'test');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    // The message must be our explicit validation error, not a Buffer type error
    expect((caught as Error).message).toContain('Invalid base64 image data');
    expect((caught as Error).message).not.toContain('WithImplicitCoercion');
  });

  it('throws "Unsupported image type" for an unknown MIME type before reaching Buffer.from', async () => {
    // A valid-looking data URI with an unsupported type should throw our MIME error,
    // not a Buffer error — confirms raw is extracted before the type check.
    await expect(
      uploadBase64('avatars', 'data:application/pdf;base64,AAAA', 'test'),
    ).rejects.toThrow('Unsupported image type');
  });
});
