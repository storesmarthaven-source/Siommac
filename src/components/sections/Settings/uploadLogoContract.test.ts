/**
 * src/components/sections/Settings/uploadLogoContract.test.ts
 *
 * Pins the WIRE CONTRACT of the company-logo upload.
 *
 * `uploadLogoApi` posted `{ base64 }` while the route validates against
 * `UploadLogoSchema` = `{ imageBase64 }`, so every logo save failed server-side
 * validation — silently, because the failure surfaced only as a toast. Nothing
 * caught it: the route sat on the E2E coverage waiver list, and no frontend test
 * asserted the payload SHAPE, only that the function resolved.
 *
 * So this asserts the one fact that broke: the exact key name crossing the
 * boundary. The schema is imported from the backend rather than restated, which
 * is what makes this a contract test instead of two copies of a guess that can
 * drift apart again.
 *
 * Test payloads are a 12-byte transparent GIF. Nothing here logs image bytes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadLogoSchema } from '../../../../netlify/functions/lib/validate';

const apiPost = vi.fn<(path: string, body: unknown) => Promise<unknown>>();
vi.mock('@lib/api', () => ({
  apiPost: (path: string, body: unknown) => apiPost(path, body),
  authPost: () => Promise.resolve({ success: true }),
}));

/** Smallest valid image data URI; never printed, only passed through. */
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

async function callUpload(dataUrl: string): Promise<string> {
  const { uploadLogoApi } = await import('./api');
  return uploadLogoApi(dataUrl);
}

describe('company logo upload — wire contract', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ success: true, url: 'https://cdn.example/branding/company_logo_1.png' });
  });

  it('posts to the branding route that already exists', async () => {
    await callUpload(TINY_GIF);
    expect(apiPost.mock.calls[0]?.[0]).toBe('uploadLogo');
  });

  it('sends the key the route validates — the defect that broke every save', async () => {
    await callUpload(TINY_GIF);
    const body = apiPost.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(['imageBase64']);
    expect(body).not.toHaveProperty('base64');
  });

  it('sends a payload the real backend schema accepts', async () => {
    await callUpload(TINY_GIF);
    const body = apiPost.mock.calls[0]?.[1];

    // The backend's own schema, not a local restatement of it.
    const parsed = UploadLogoSchema.safeParse(body);
    expect(parsed.success, parsed.success ? '' : parsed.error.issues.map(i => i.path.join('.')).join(', ')).toBe(true);
  });

  it('rejects the payload the frontend used to send', () => {
    // Proves the schema really was the gate, so this test would have failed
    // before the fix rather than passing vacuously.
    expect(UploadLogoSchema.safeParse({ base64: TINY_GIF }).success).toBe(false);
  });

  it('returns the persisted URL the caller renders', async () => {
    const url = await callUpload(TINY_GIF);
    expect(url).toBe('https://cdn.example/branding/company_logo_1.png');
  });

  it('surfaces a server rejection instead of reporting a phantom success', async () => {
    apiPost.mockResolvedValue({ success: false, message: 'Validation error: imageBase64: Required' });
    await expect(callUpload(TINY_GIF)).rejects.toThrow(/imageBase64/);
  });

  it('never returns undefined when the server omits the url', async () => {
    apiPost.mockResolvedValue({ success: true });
    expect(await callUpload(TINY_GIF)).toBe('');
  });
});
