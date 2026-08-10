/**
 * scripts/publish-email-assets.mjs — publish email artwork to the public branding bucket.
 *
 *   node scripts/publish-email-assets.mjs [--dry-run] [--icons-only] [--illustrations-only]
 *
 * Email clients cannot resolve a repo-relative path. Anything an email references must live at an
 * absolute, publicly reachable URL — no auth, no signed URL, because the recipient's mail client
 * fetches it with no session. `branding` is already a PUBLIC bucket used for exactly this class of
 * asset, so email art goes there under `email/` rather than inventing new infrastructure.
 *
 * Two kinds of asset are published:
 *   1. ILLUSTRATIONS — hand-authored files in assets/images/email/, uploaded as they are.
 *   2. ICONS — rasterized HERE from Lucide's own data, one PNG per (icon, palette colour).
 *
 * ⭐⭐ Why icons are rasterized instead of shipped as SVG: Gmail strips inline `<svg>` from message
 * bodies, and its image proxy does not serve SVG either — proven against a real delivered message
 * where 9 inline icons vanished and both PNGs survived. A raster is the only icon primitive a mail
 * client is guaranteed to draw.
 *
 * ⭐ Generated, never committed. The matrix is derived from `EMAIL_ICON_CHOICES` and
 * `EMAIL_ICON_COLORS` in src/lib/emailIcons.ts — the SAME constants the renderer emits URLs from.
 * Adding an icon or a palette colour therefore publishes its assets on the next run; a committed
 * folder of binaries would drift from the picker the first time someone edited the list.
 *
 * Idempotent: upsert by path, so re-running after changing an image republishes it and re-running
 * unchanged is a no-op. Safe to run on every deploy.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { Resvg } from '@resvg/resvg-js';

const DRY = process.argv.includes('--dry-run');
const ICONS_ONLY = process.argv.includes('--icons-only');
const ILLUSTRATIONS_ONLY = process.argv.includes('--illustrations-only');
const SOURCE_DIR = new URL('../assets/images/email/', import.meta.url);
const BUCKET = 'branding';
const PREFIX = 'email';

/**
 * The icon matrix comes from the COMPILED renderer, not a copy of its constants. If this file
 * carried its own list it would silently publish the wrong set the moment someone edited the
 * picker — the exact drift class that let broken icon markup ship in the first place.
 */
const require_ = createRequire(import.meta.url);
const ICONS_MODULE = fileURLToPath(new URL('../dist/src/lib/emailIcons.js', import.meta.url));
if (!existsSync(ICONS_MODULE)) {
  console.error('dist/src/lib/emailIcons.js is missing — run `npm run build:backend` first.');
  process.exit(2);
}
const {
  EMAIL_ICON_CHOICES,
  EMAIL_ICON_COLORS,
  EMAIL_ICON_RASTER_SIZE,
  emailIconFileName,
  renderEmailIconSvg,
} = require_(ICONS_MODULE);

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[key]) { console.error(`Missing ${key} in .env`); process.exit(2); }
}

const CONTENT_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// fileURLToPath, not .pathname: a path containing a space arrives percent-encoded
// ("MSI%20Laptop") and every read then fails with ENOENT.
const dir = fileURLToPath(SOURCE_DIR);
const files = readdirSync(SOURCE_DIR).filter(f => CONTENT_TYPE[extname(f).toLowerCase()]);

let published = 0, failed = 0;

/** Upsert one object. Reports its own failure and never throws, so one bad asset cannot abandon the rest. */
async function upload(path, body, contentType) {
  if (DRY) { console.log(`  would publish ${path}`); published++; return; }
  const { error } = await sb.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: true,
    // A year: these are content-addressed by name and republished on change, so a long cache is
    // safe and keeps mail clients from re-fetching on every open.
    cacheControl: '31536000',
  });
  if (error) { console.error(`  ✖ ${path}: ${error.message}`); failed++; return; }
  published++;
  console.log(`  ✓ ${path}`);
}

if (!ICONS_ONLY) {
  console.log(`${DRY ? '[dry run] ' : ''}publishing ${files.length} illustration(s) → ${BUCKET}/${PREFIX}/\n`);
  for (const file of files) {
    await upload(`${PREFIX}/${file}`, DRY ? null : readFileSync(join(dir, file)), CONTENT_TYPE[extname(file).toLowerCase()]);
  }
}

if (!ILLUSTRATIONS_ONLY) {
  const colors = Object.keys(EMAIL_ICON_COLORS);
  const total = colors.length * EMAIL_ICON_CHOICES.length;
  console.log(`\n${DRY ? '[dry run] ' : ''}publishing ${total} icon(s) (${EMAIL_ICON_CHOICES.length} icons x ${colors.length} colours) → ${BUCKET}/${PREFIX}/icons/\n`);
  for (const color of colors) {
    for (const name of EMAIL_ICON_CHOICES) {
      const path = `${PREFIX}/icons/${color}/${emailIconFileName(name)}.png`;
      let png = null;
      if (!DRY) {
        // Rendered at EMAIL_ICON_RASTER_SIZE (3x the largest glyph the Studio can produce) so a
        // tile icon stays sharp on a high-DPI phone; the <img> carries the display size.
        const svg = renderEmailIconSvg(name, EMAIL_ICON_COLORS[color], EMAIL_ICON_RASTER_SIZE);
        png = new Resvg(svg, {
          fitTo: { mode: 'width', value: EMAIL_ICON_RASTER_SIZE },
          // Transparent: the chip behind the icon supplies the background, and the author can
          // change it. Baking one in would make every non-white chip show a coloured square.
          background: 'rgba(0,0,0,0)',
        }).render().asPng();
      }
      await upload(path, png, 'image/png');
    }
  }
}

console.log(`\n${published} published, ${failed} failed`);
if (!DRY && !failed) {
  const { data } = sb.storage.from(BUCKET).getPublicUrl(`${PREFIX}/${files[0]}`);
  console.log(`public URL form: ${data.publicUrl}`);
}
process.exit(failed ? 1 : 0);
