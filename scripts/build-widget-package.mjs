// scripts/build-widget-package.mjs — turn a single design .html (sections + shared <style>/<script>)
// into the CANONICAL package form: a folder of manifest.json + styles.css [+ shared.js] + one .html
// per widget, then zip it. The manifest references the files by name.
//
//   node scripts/build-widget-package.mjs <source.html> <out-name> [--min] [--ext=zip|siowidget]
//     --min            light obfuscation: strip comments + collapse whitespace (NOT real protection —
//                      the rendered widget is always visible in the browser; see the guide).
//     --ext=siowidget  write a branded ".siowidget" archive instead of ".zip" (still a zip inside).
import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const srcPath = args[0] ?? 'docs/examples/employee-master-health-pack.html';
const outName = args[1] ?? 'employee-master-health-pack';
const outDir = path.join('docs/examples', outName.replace(/-pack$/, ''));
const MIN = flags.includes('--min');
const ext = (flags.find(f => f.startsWith('--ext=')) ?? '--ext=zip').split('=')[1];

// Light, SAFE minify — strips comments + collapses inter-tag/indent whitespace. Not real protection.
const min = (s, kind) => {
  if (!MIN) return s;
  let out = kind === 'html' ? s.replace(/<!--[\s\S]*?-->/g, '') : s.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
  if (kind === 'html') out = out.replace(/>\s+</g, '><');
  return out.trim();
};

const src = fs.readFileSync(srcPath, 'utf8');
const css = (src.match(/<style>([\s\S]*?)<\/style>/) ?? [, ''])[1].trim();
const sections = src.match(/<section\b[^>]*\bdata-widget-id="[^"]*"[^>]*>[\s\S]*?<\/section>/g) ?? [];
if (!sections.length) { console.error('No <section data-widget-id> found in', srcPath); process.exit(1); }
// Shared <script>s = those OUTSIDE every widget section (per-section scripts ride along in the section
// html). Strip the sections first so we don't double-bundle a per-widget script.
let outside = src; for (const s of sections) outside = outside.replace(s, '');
const js = [...outside.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(code => code && code.trim()).join('\n').trim();

const pkgName = (src.match(/<meta name="widget-package-name" content="([^"]*)"/) ?? [, outName])[1];
const pkgVer  = (src.match(/<meta name="widget-package-version" content="([^"]*)"/) ?? [, '1.0.0'])[1];
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];

const files = { 'styles.css': strToU8(min(css, 'css')) };
if (js) files['shared.js'] = strToU8(min(js, 'js'));
const widgets = sections.map(sec => {
  const open = sec.match(/<section\b[^>]*>/)[0];
  const id = attr(open, 'data-widget-id');
  const file = `${id.split('.').pop()}.html`;
  files[file] = strToU8(min(sec, 'html'));
  const sizes = attr(open, 'data-widget-sizes');
  return {
    id,
    title: attr(open, 'data-widget-title') ?? id,
    description: attr(open, 'data-widget-description') ?? '',
    icon: attr(open, 'data-widget-icon') ?? 'fa-table-cells-large',
    category: attr(open, 'data-widget-category') ?? 'Custom',
    tags: (attr(open, 'data-widget-tags') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    size: attr(open, 'data-widget-size') ?? 'standard',
    ...(sizes ? { sizes: sizes.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    kind: 'html',
    html: file,          // ← reference to the file in the package
    css: 'styles.css',   // ← shared stylesheet
    ...(js ? { js: 'shared.js' } : {}), // ← shared script (runs sandboxed)
  };
});

const manifest = { name: pkgName, version: pkgVer, widgets };
files['manifest.json'] = strToU8(JSON.stringify(manifest, MIN ? undefined : null, MIN ? undefined : 2));

// Write the unpacked folder (so the structure is visible) + the archive.
fs.mkdirSync(outDir, { recursive: true });
for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(outDir, k), Buffer.from(v));
const archive = path.join('docs/examples', `${outName}.${ext}`);
fs.writeFileSync(archive, zipSync(files, { level: 9 }));
console.log(`Built "${pkgName}" v${pkgVer}: ${widgets.length} widgets${js ? ' (+ shared.js)' : ''}${MIN ? ' [minified]' : ''}`);
console.log(`  folder:  ${outDir}/ (${Object.keys(files).length} files)`);
console.log(`  archive: ${archive}`);
