/**
 * scripts/port-drawer-css.mjs
 *
 * Ports the LOCKED drawer mockup's stylesheet into the production drawer CSS
 * verbatim, scoping every rule under `.epd-root` so the mockup's generic class
 * names (.card, .status, .panel, .tabs, .icon, .footer, .badge …) cannot collide
 * with or leak into the rest of the application.
 *
 * This is a mechanical port on purpose: transcribing 941 lines by hand is how
 * pixel drift gets introduced. Re-run it if the locked reference ever changes.
 * It READS the locked mockup and never writes to it.
 *
 *   node scripts/port-drawer-css.mjs            # write
 *   node scripts/port-drawer-css.mjs --check    # verify the committed CSS is current
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SOURCE = 'docs/mockups/employee-profile-drawer-unified-command-brief.html';
const TARGET = 'src/components/sections/HR/ProfileDrawer.css';
const ROOT = '.epd-root';

/** Mockup page chrome — the demo's fake register behind the drawer. Not ported. */
const SKIP_SELECTORS = [/^\.page$/, /^\.register-ghost/, /^\.ghost-/, /^body$/, /^html$/];

/** Animations are renamed so they cannot clash with app-level keyframes. */
const KEYFRAME_PREFIX = 'epd-';

function scopeSelector(sel) {
  const s = sel.trim();
  if (!s) return null;
  if (SKIP_SELECTORS.some(re => re.test(s))) return null;

  // `:root` holds the design tokens — scope them onto the drawer root itself.
  if (s === ':root') return ROOT;

  // `body[data-theme="dark"] { --tokens }` → same tokens, drawer-scoped.
  if (s === 'body[data-theme="dark"]') return `body[data-theme="dark"] ${ROOT}`;

  // `body[data-theme="dark"] .x` → `body[data-theme="dark"] .epd-root .x`
  if (s.startsWith('body[data-theme="dark"]')) {
    const rest = s.slice('body[data-theme="dark"]'.length).trim();
    return `body[data-theme="dark"] ${ROOT} ${rest}`;
  }

  // Bare element/universal rules must stay inside the drawer.
  if (s === '*' || s === 'button') return `${ROOT} ${s}`;

  return `${ROOT} ${s}`;
}

function scopeSelectorList(list) {
  const out = list.split(',').map(scopeSelector).filter(Boolean);
  return out.length ? out.join(',\n') : null;
}

/** Split a CSS string into top-level `@…{}` blocks and `selector{}` rules. */
function* topLevelBlocks(css) {
  let i = 0;
  while (i < css.length) {
    const braceAt = css.indexOf('{', i);
    if (braceAt === -1) break;
    const prelude = css.slice(i, braceAt).trim();
    let depth = 1;
    let j = braceAt + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    yield { prelude, body: css.slice(braceAt + 1, j - 1), end: j };
    i = j;
  }
}

/**
 * Declarations that belong to a bare `body` rule are PAGE chrome, not drawer
 * chrome. From those blocks keep only the design tokens and `color-scheme` —
 * porting the mockup's page backdrop would paint the drawer's own root.
 */
function isTokenDeclaration(decl) {
  const name = decl.split(':')[0]?.trim() ?? '';
  return name.startsWith('--') || name === 'color-scheme';
}

function renderDeclarations(body, tokensOnly = false) {
  const lines = body
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !tokensOnly || isTokenDeclaration(l));
  return lines.map(l => `  ${l}`).join('\n');
}

function portRules(css, indent = '') {
  const chunks = [];
  for (const { prelude, body } of topLevelBlocks(css)) {
    if (prelude.startsWith('@keyframes')) {
      const name = prelude.replace('@keyframes', '').trim();
      chunks.push(`${indent}@keyframes ${KEYFRAME_PREFIX}${name} {\n${body.trim().split('\n').map(l => `${indent}  ${l.trim()}`).join('\n')}\n${indent}}`);
      continue;
    }
    if (prelude.startsWith('@media')) {
      const inner = portRules(body, `${indent}  `);
      if (inner.trim()) chunks.push(`${indent}${prelude} {\n${inner}\n${indent}}`);
      continue;
    }
    if (prelude.startsWith('@')) { chunks.push(`${indent}${prelude} { ${body.trim()} }`); continue; }

    const scoped = scopeSelectorList(prelude);
    if (!scoped) continue;
    // `:root` and bare `body[data-theme=…]` carry tokens; anything else in them
    // is page chrome and is dropped.
    const tokensOnly = prelude.trim() === ':root' || prelude.trim() === 'body[data-theme="dark"]';
    const rendered = renderDeclarations(body, tokensOnly);
    if (!rendered.trim()) continue;
    const decls = rendered.split('\n').map(l => `${indent}${l}`).join('\n');
    chunks.push(`${indent}${scoped.split('\n').map(l => `${indent}${l}`).join('\n').trim()} {\n${decls}\n${indent}}`);
  }
  return chunks.join('\n\n');
}

const html = readFileSync(SOURCE, 'utf8');
const sourceHash = createHash('sha256').update(readFileSync(SOURCE)).digest('hex');
const css = html.split('<style>')[1].split('</style>')[0];

let ported = portRules(css);
// The gauge animation is referenced by its original name in the ported rules.
ported = ported.replace(/animation:\s*load-gauge/g, `animation: ${KEYFRAME_PREFIX}load-gauge`);

const header = `/* GENERATED — do not hand-edit.
 *
 * Ported verbatim from the LOCKED drawer mockup by scripts/port-drawer-css.mjs.
 *   source: ${SOURCE}
 *   sha256: ${sourceHash}
 *
 * Every rule is scoped under \`${ROOT}\` so the mockup's generic class names
 * cannot leak into the rest of the application. Dark mode uses the app's own
 * global \`body[data-theme="dark"]\` selector — the mockup already used exactly
 * that selector, so the dark rules port with no translation and there is no
 * local theme toggle.
 *
 * Regenerate with: node scripts/port-drawer-css.mjs
 */
`;

const output = `${header}\n${ported}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(TARGET, 'utf8');
  if (current !== output) {
    console.error(`${TARGET} is stale against the locked mockup. Run: node scripts/port-drawer-css.mjs`);
    process.exit(1);
  }
  console.log(`Drawer CSS is current against ${SOURCE} (${sourceHash.slice(0, 12)}…).`);
} else {
  writeFileSync(TARGET, output);
  console.log(`Ported ${css.split('\n').length} source lines → ${output.split('\n').length} scoped lines in ${TARGET}`);
}
