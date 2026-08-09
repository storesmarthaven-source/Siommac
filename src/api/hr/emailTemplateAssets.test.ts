import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadEmailTemplateAsset } from './emailTemplateAssets';

afterEach(() => vi.unstubAllGlobals());

describe('uploadEmailTemplateAsset', () => {
  it('loads a development image, measures it, and returns a renderable asset', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ width: 480, height: 240, close: vi.fn() })));
    const file = new File(['image bytes'], 'team-photo.png', { type: 'image/png' });

    const asset = await uploadEmailTemplateAsset('template-1', file);

    expect(asset.fileName).toBe('team-photo.png');
    expect(asset.width).toBe(480);
    expect(asset.height).toBe(240);
    expect(asset.publicUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects unsupported and oversized files before upload', async () => {
    await expect(uploadEmailTemplateAsset('template-1', new File(['text'], 'notes.txt', { type: 'text/plain' })))
      .rejects.toThrow('Use a JPEG, PNG, WebP or GIF image.');

    const oversized = new File([new Uint8Array((5 * 1024 * 1024) + 1)], 'large.png', { type: 'image/png' });
    await expect(uploadEmailTemplateAsset('template-1', oversized)).rejects.toThrow('Images must be 5 MB or smaller.');
  });
});
