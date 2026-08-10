/**
 * Email asset resolution — pure string work, so every rule is provable without a bucket.
 *
 * The property that matters: an authored path becomes a publicly fetchable URL, and anything that
 * cannot be resolved stays unresolved so the caller refuses it. Resolution must never INVENT a URL
 * — a guessed URL turns a visible refusal into a broken image in a real inbox.
 */
import { describe, expect, it } from 'vitest';
import { resolveEmailAssets, emailAssetBaseUrl } from '../../netlify/functions/lib/email/emailAssetResolver';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co' } as NodeJS.ProcessEnv;
const BASE = 'https://proj.supabase.co/storage/v1/object/public/branding/email';

describe('emailAssetBaseUrl', () => {
  it('derives the public bucket URL from SUPABASE_URL', () => {
    expect(emailAssetBaseUrl(ENV)).toBe(BASE);
  });

  it('honours an EMAIL_ASSET_BASE_URL override so a CDN move is config, not code', () => {
    expect(emailAssetBaseUrl({ ...ENV, EMAIL_ASSET_BASE_URL: 'https://cdn.siomac.app/email/' }))
      .toBe('https://cdn.siomac.app/email');
  });

  it('returns null when nothing is configured, rather than guessing a host', () => {
    expect(emailAssetBaseUrl({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('resolveEmailAssets', () => {
  it('rewrites an authored path to its public URL', () => {
    const r = resolveEmailAssets('<img src="/assets/images/email/company-logo.png">', ENV);
    expect(r.html).toContain(`${BASE}/company-logo.png`);
    expect(r.resolved).toEqual(['/assets/images/email/company-logo.png']);
    expect(r.unresolved).toEqual([]);
  });

  it('leaves absolute URLs and data URIs untouched', () => {
    const html = '<img src="https://cdn.example.com/a.png"><img src="data:image/png;base64,AAA">';
    const r = resolveEmailAssets(html, ENV);
    expect(r.html).toBe(html);
    expect(r.unresolved).toEqual([]);
  });

  it('⛔ does NOT invent a URL for a relative path outside the authored prefix', () => {
    // Pointing an unknown relative path at the email bucket would fabricate a URL that does not
    // exist — replacing a visible refusal with a broken image in someone's inbox.
    const r = resolveEmailAssets('<img src="/uploads/random.png">', ENV);
    expect(r.html).toContain('/uploads/random.png');
    expect(r.unresolved).toEqual(['/uploads/random.png']);
    expect(r.resolved).toEqual([]);
  });

  it('reports an authored path as unresolved when no base URL is configured', () => {
    const r = resolveEmailAssets('<img src="/assets/images/email/logo.png">', {} as NodeJS.ProcessEnv);
    expect(r.unresolved).toEqual(['/assets/images/email/logo.png']);
    expect(r.resolved).toEqual([]);
  });

  it('resolves every image in a document, not just the first', () => {
    const html = '<img src="/assets/images/email/a.png"><p>x</p><img src="/assets/images/email/b.png">';
    const r = resolveEmailAssets(html, ENV);
    expect(r.resolved).toHaveLength(2);
    expect(r.html).toContain(`${BASE}/a.png`);
    expect(r.html).toContain(`${BASE}/b.png`);
  });

  it('handles single quotes and extra attributes', () => {
    const r = resolveEmailAssets(`<img alt="Logo" src='/assets/images/email/logo.png' width="120">`, ENV);
    expect(r.html).toContain(`${BASE}/logo.png`);
    expect(r.html).toContain('width="120"');
  });

  it('de-duplicates repeated unresolved paths', () => {
    const r = resolveEmailAssets('<img src="/x/a.png"><img src="/x/a.png">', ENV);
    expect(r.unresolved).toEqual(['/x/a.png']);
  });

  it('ignores non-img src attributes — a mail client does not fetch them', () => {
    const html = '<script src="/assets/images/email/nope.js"></script>';
    const r = resolveEmailAssets(html, ENV);
    expect(r.html).toBe(html);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });
});
