/**
 * Email icons — the canvas/production renderer split, and the gate that keeps it honest.
 *
 * ⭐⭐ THE PROPERTY UNDER TEST, stated plainly: production email HTML contains ZERO inline `<svg>`.
 * Gmail strips it. A real delivered message proved it — 9 inline icons sent, 0 rendered, both
 * hosted `<img>` survived. Every assertion here exists so that cannot regress silently.
 *
 * ⛔ Note what these tests deliberately do NOT do: they never compare one of our renderers against
 * another. That is precisely the check that passed while the defect shipped — `renderEmailPreview`
 * and `renderEmailMjml` agreed perfectly BECAUSE both emitted the construct Gmail deletes. These
 * assert the ABSOLUTE shape of the output instead.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_ICON_COLOR,
  EMAIL_ICON_CHOICES,
  EMAIL_ICON_COLORS,
  emailIconAssetPath,
  emailIconFileName,
  emailIconHex,
  FALLBACK_EMAIL_ICON,
  normalizeEmailIconColor,
  normalizeEmailIconName,
  renderEmailIcon,
} from '../../src/lib/emailIcons';
import {
  createStarterEmailDocument,
  normalizeEmailDocument,
  renderEmailMjml,
  renderEmailPreview,
} from '../../src/lib/emailTemplateDocument';
import { checkEmailCompatibility } from '../../netlify/functions/lib/email/emailCompatibility';
import type { EmailIconColor } from '../../types/emailTemplates';

const COLORS = Object.keys(EMAIL_ICON_COLORS) as EmailIconColor[];
const ENV = { SUPABASE_URL: 'https://proj.supabase.co' } as NodeJS.ProcessEnv;
const BASE = 'https://proj.supabase.co/storage/v1/object/public/branding/email';

describe('semantic icon palette', () => {
  it('offers exactly the seven email-safe colours', () => {
    expect(COLORS).toEqual(['navy', 'blue', 'green', 'amber', 'red', 'slate', 'white']);
  });

  it('passes a palette token through unchanged', () => {
    for (const color of COLORS) expect(normalizeEmailIconColor(color)).toBe(color);
  });

  it('snaps a legacy hex to its NEAREST token, preserving the author\'s intent', () => {
    // These are the hexes real stored documents carry. Collapsing every one to the default would
    // repaint a whole template library; nearest-colour keeps each close to what was designed.
    expect(normalizeEmailIconColor('#173f76')).toBe('navy');
    expect(normalizeEmailIconColor('#FFFFFF')).toBe('white');
    expect(normalizeEmailIconColor('#0f8a4d')).toBe('green');
    expect(normalizeEmailIconColor('#b42318')).toBe('red');
    expect(normalizeEmailIconColor('#fff')).toBe('white');
  });

  it('falls back to the default for anything that is not a colour', () => {
    for (const value of [undefined, null, '', 'not-a-colour', 42, {}]) {
      expect(normalizeEmailIconColor(value)).toBe(DEFAULT_EMAIL_ICON_COLOR);
    }
  });
});

describe('icon asset naming', () => {
  it('derives Lucide-style kebab file names, including trailing digits', () => {
    expect(emailIconFileName('CalendarDays')).toBe('calendar-days');
    expect(emailIconFileName('Clock3')).toBe('clock-3');
    expect(emailIconFileName('Building2')).toBe('building-2');
    expect(emailIconFileName('ShieldCheck')).toBe('shield-check');
    expect(emailIconFileName('Wifi')).toBe('wifi');
  });

  it('produces a distinct path for every icon in every colour', () => {
    const paths = new Set<string>();
    for (const color of COLORS) {
      for (const name of EMAIL_ICON_CHOICES) paths.add(emailIconAssetPath(name, color));
    }
    expect(paths.size).toBe(EMAIL_ICON_CHOICES.length * COLORS.length);
    expect(paths.size).toBe(238);
  });

  it('⛔ coerces an unknown icon name to a PUBLISHED one', () => {
    // Load-bearing: an unrecognised name must never produce a URL for an asset that was never
    // generated. The canvas can survive drawing nothing; an inbox shows a broken image.
    expect(normalizeEmailIconName('NoSuchIcon')).toBe(FALLBACK_EMAIL_ICON);
    expect(emailIconAssetPath('NoSuchIcon', 'navy'))
      .toBe(`/assets/images/email/icons/navy/${emailIconFileName(FALLBACK_EMAIL_ICON)}.png`);
    for (const name of EMAIL_ICON_CHOICES) expect(normalizeEmailIconName(name)).toBe(name);
  });
});

describe('renderEmailIcon — one definition, two primitives', () => {
  it('canvas draws inline SVG in the palette hex', () => {
    const svg = renderEmailIcon({ name: 'CalendarDays', color: 'navy', size: 18, target: 'canvas' });
    expect(svg).toContain('<svg');
    expect(svg).toContain(emailIconHex('navy'));
    expect(svg).not.toContain('<img');
  });

  it('email draws a hosted PNG <img> and NO svg', () => {
    const img = renderEmailIcon({ name: 'CalendarDays', color: 'navy', size: 20, target: 'email' });
    expect(img).toContain('<img');
    expect(img).not.toContain('<svg');
    expect(img).toContain('/assets/images/email/icons/navy/calendar-days.png');
    expect(img).toContain('width="20"');
    expect(img).toContain('height="20"');
  });

  it('⭐ email icons are decorative: empty alt + presentation role', () => {
    // Every icon sits beside its own label. Announcing "calendar icon Start date Monday 17" tells
    // a screen-reader user the same thing twice.
    const img = renderEmailIcon({ name: 'Clock3', color: 'slate', size: 16, target: 'email' });
    expect(img).toContain('alt=""');
    expect(img).toContain('role="presentation"');
  });

  it('never stores a hosted URL — the document model stays conceptual', () => {
    // The authored path is what goes in the markup; emailAssetResolver maps it at send time.
    // Baking a bucket hostname into content would break every saved template on a CDN move.
    const img = renderEmailIcon({ name: 'MapPin', color: 'green', size: 18, target: 'email' });
    expect(img).not.toContain('supabase');
    expect(img).not.toContain('http');
  });
});

describe('the real welcome template', () => {
  const schema = normalizeEmailDocument(createStarterEmailDocument('onboarding'));
  const emailHtml = renderEmailMjml(schema, 'Welcome to SIOMAC');
  const canvasHtml = renderEmailPreview(schema, 'Welcome to SIOMAC').html;

  it('⭐⭐ production output contains ZERO inline SVG', () => {
    expect(emailHtml.match(/<svg/gi)).toBeNull();
  });

  it('still draws SVG on the canvas, where it is the right primitive', () => {
    expect((canvasHtml.match(/<svg/gi) ?? []).length).toBeGreaterThan(0);
  });

  it('renders every icon the canvas draws as a hosted <img> instead', () => {
    // The two surfaces must show the same NUMBER of icons — the split changes the primitive,
    // never the design. This is what proves icons were converted rather than dropped.
    const canvasIcons = (canvasHtml.match(/<svg/gi) ?? []).length;
    const emailIcons = [...emailHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)]
      .map(m => m[1] ?? '')
      .filter(src => src.startsWith('/assets/images/email/icons/'));
    expect(emailIcons.length).toBe(canvasIcons);
    // The onboarding starter: 4 fact tiles + 2 support rows + 3 footer trust chips.
    expect(emailIcons.length).toBe(9);
  });

  it('carries the hosted logo and avatar alongside the icons', () => {
    expect(emailHtml).toContain('/assets/images/email/company-logo.png');
    expect(emailHtml).toContain('{{recipient.profilePhotoUrl}}');
  });

  it('normalizes stored hex icon colours into the model, not at render time', () => {
    const legacy = createStarterEmailDocument('onboarding');
    const withHex = JSON.parse(JSON.stringify(legacy).replace(/"iconColor":"navy"/g, '"iconColor":"#0f8a4d"'));
    const normalized = JSON.stringify(normalizeEmailDocument(withHex));
    expect(normalized).toContain('"iconColor":"green"');
    expect(normalized).not.toContain('#0f8a4d');
  });
});

describe('production-email compatibility gate', () => {
  const clean = '<html><body><img src="https://cdn.example.com/a.png" alt=""><p>Hi</p></body></html>';

  it('passes markup a mail client can actually render', () => {
    expect(checkEmailCompatibility(clean, ENV)).toEqual({ ok: true, issues: [] });
  });

  const cases: Array<[string, string, string]> = [
    ['inline_svg', '<p><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></p>', 'strips inline SVG'],
    ['script_tag', '<p>hi</p><script>alert(1)</script>', 'scripts never run in mail'],
    ['javascript_url', '<a href="javascript:alert(1)">go</a>', 'hostile and inert'],
    ['local_url', '<a href="http://localhost:8888/x">go</a>', 'dead for every recipient'],
    ['unresolved_variable', '<p>Welcome {{company.name}}</p>', 'a visible token is permanent'],
    ['relative_image', '<img src="/assets/images/email/logo.png">', 'nothing to resolve against'],
  ];

  for (const [code, html, why] of cases) {
    it(`refuses ${code} — ${why}`, () => {
      const report = checkEmailCompatibility(html, ENV);
      expect(report.ok).toBe(false);
      expect(report.issues.map(i => i.code)).toContain(code);
    });
  }

  it('refuses an icon that is not on the approved asset host', () => {
    // An icon URL pointing anywhere else means the asset was never published by our pipeline.
    const report = checkEmailCompatibility('<img src="https://elsewhere.example/icons/navy/clock-3.png">', ENV);
    expect(report.ok).toBe(false);
    expect(report.issues.map(i => i.code)).toContain('unhosted_icon');
  });

  it('accepts icons served from the approved asset host', () => {
    const report = checkEmailCompatibility(`<img src="${BASE}/icons/navy/clock-3.png" alt="">`, ENV);
    expect(report.ok).toBe(true);
  });

  it('names the offending fragments so a refusal is actionable', () => {
    const report = checkEmailCompatibility('<p>{{a.b}} {{c.d}}</p>', ENV);
    const issue = report.issues.find(i => i.code === 'unresolved_variable');
    expect(issue?.samples).toEqual(['{{a.b}}', '{{c.d}}']);
  });
});
