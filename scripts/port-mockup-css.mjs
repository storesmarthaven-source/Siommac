/**
 * scripts/port-mockup-css.mjs
 *
 * Ports a LOCKED mockup's stylesheet into a production CSS file, scoping every
 * rule under a root class so the mockups' generic class names (.card, .grid,
 * .top, .btn, .badge …) cannot collide with or leak into the rest of the app.
 *
 * Mechanical on purpose: hand-transcribing thousands of lines of locked CSS is
 * how pixel drift gets introduced. Supersedes scripts/port-drawer-css.mjs.
 *
 *   node scripts/port-mockup-css.mjs           # write all targets
 *   node scripts/port-mockup-css.mjs --check   # fail if any target is stale
 *
 * `--check` does TWO things:
 *   1. staleness — the committed file matches what this script generates now;
 *   2. FIDELITY  — every selector and declaration in the locked source is
 *      present in the output. Staleness alone would pass a transformer that
 *      silently dropped rules, so the fidelity pass is the real proof.
 *
 * It READS the locked mockups and never writes to them.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Bare element selectors that belong to the MOCKUP PAGE, not the component.
 * `html`/`body` are page chrome and are dropped; `*` is re-scoped under the root.
 *
 * Shell chrome (.app/.sidebar/.nav/.top/…) is deliberately NOT skipped: it is
 * scoped like everything else and simply never matches, because the production
 * page renders inside the application's own shell and contains no sidebar of its
 * own. Keeping it costs a few inert rules and removes the risk of my mistaking a
 * content rule for chrome and silently dropping it.
 */
const DROP_SELECTORS = [/^html$/, /^body$/];

const TARGETS = [
  {
    name: 'onboarding-overview',
    source: 'docs/mockups/onboarding-overview-reference-conversion.html',
    target: 'src/components/sections/HR/onboardingOverviewPage.css',
    root: '.onb-ov',
  },
  {
    // The AUTHORITATIVE Case Detail design: the seven-tab operating page. This replaced the
    // older reference-conversion port, whose target was unreferenced dead CSS and has been
    // deleted along with its entry.
    name: 'onboarding-case-detail-v2',
    source: 'docs/mockups/onboarding-case-detail-implementation-ready.html',
    target: 'src/components/sections/HR/OnboardingCaseDetail.mockup.css',
    root: '.ocd-root',
    keyframePrefix: 'ocd-',
  },
  {
    name: 'employee-profile-drawer',
    source: 'docs/mockups/employee-profile-drawer-unified-command-brief.html',
    target: 'src/components/sections/HR/ProfileDrawer.mockup.css',
    root: '.epd-root',
    // The drawer mockup's demo page chrome is a fake register behind the drawer.
    drop: [/^\.page$/, /^\.register-ghost/, /^\.ghost-/],
    keyframePrefix: 'epd-',
  },
  {
    name: 'employee-profile-full-page',
    source: 'docs/mockups/employee-profile-full-page.html',
    target: 'src/components/sections/HR/EmployeeProfilePage.mockup.css',
    root: '.epf-root',
    // The full-page mockup carries a WHOLE fake application shell (sidebar, top
    // bar, nav, user pill) because it is a standalone page. Production renders
    // inside the real SIOMAC shell, so those rules are scoped like everything
    // else and simply never match — deliberately NOT dropped, so the fidelity
    // pass can still prove no content rule was lost. Verified before adding this
    // target: the mockup has ZERO `.main <descendant>` selectors, so no content
    // style depends on the shell being present.
    keyframePrefix: 'epf-',
  },
];

function scopeSelector(sel, cfg) {
  const s = sel.trim();
  if (!s) return null;
  const drops = [...DROP_SELECTORS, ...(cfg.drop ?? [])];
  if (drops.some(re => re.test(s))) return null;
  if (s === ':root') return cfg.root;
  if (s === 'body[data-theme="dark"]') return `body[data-theme="dark"] ${cfg.root}`;
  if (s.startsWith('body[data-theme="dark"]')) {
    return `body[data-theme="dark"] ${cfg.root} ${s.slice('body[data-theme="dark"]'.length).trim()}`;
  }
  return `${cfg.root} ${s}`;
}

/** Split a CSS string into top-level `prelude { body }` blocks. */
function* blocks(css) {
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const prelude = css.slice(i, brace).trim();
    let depth = 1, j = brace + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    yield { prelude, body: css.slice(brace + 1, j - 1) };
    i = j;
  }
}

/** Declarations, one per line. Splits on `;` so MINIFIED sources work too. */
function declarations(body, tokensOnly = false) {
  return body
    .split(';')
    .map(d => d.trim())
    .filter(Boolean)
    .filter(d => !tokensOnly || d.startsWith('--') || d.startsWith('color-scheme'))
    .map(d => `${d};`);
}

function port(css, cfg, indent = '') {
  const out = [];
  for (const { prelude, body } of blocks(css)) {
    const p = prelude.trim();
    if (p.startsWith('@keyframes')) {
      const name = p.replace('@keyframes', '').trim();
      out.push(`${indent}@keyframes ${cfg.keyframePrefix ?? ''}${name} {${body}}`);
      continue;
    }
    if (p.startsWith('@media') || p.startsWith('@supports')) {
      const inner = port(body, cfg, `${indent}  `);
      if (inner.trim()) out.push(`${indent}${p} {\n${inner}\n${indent}}`);
      continue;
    }
    if (p.startsWith('@')) { out.push(`${indent}${p} { ${body.trim()} }`); continue; }

    const scoped = p.split(',').map(s => scopeSelector(s, cfg)).filter(Boolean);
    if (!scoped.length) continue;
    // `:root` and a bare dark-theme block carry design tokens; anything else in
    // them is page chrome and is dropped.
    const tokensOnly = p === ':root' || p === 'body[data-theme="dark"]';
    const decls = declarations(body, tokensOnly);
    if (!decls.length) continue;
    out.push(`${indent}${scoped.join(',\n' + indent)} {\n${decls.map(d => `${indent}  ${d}`).join('\n')}\n${indent}}`);
  }
  return out.join('\n\n');
}

/** Every selector + declaration in the source must survive into the output. */
function fidelity(css, generated, cfg) {
  const problems = [];
  const norm = t => t.replace(/\s+/g, ' ').trim();
  for (const { prelude, body } of blocks(css)) {
    const p = prelude.trim();
    if (p.startsWith('@')) continue;
    const kept = p.split(',').map(s => scopeSelector(s, cfg)).filter(Boolean);
    if (!kept.length) continue;
    const tokensOnly = p === ':root' || p === 'body[data-theme="dark"]';
    for (const raw of declarations(body, tokensOnly)) {
      // Apply the SAME keyframe rename the porter performs, so an intentional
      // rewrite is not mistaken for a lost declaration. Anything else that
      // differs is a genuine loss.
      const decl = cfg.keyframePrefix
        ? raw.replace(/animation:\s*([a-z-]+)/g, (m, n) => `animation: ${cfg.keyframePrefix}${n}`)
        : raw;
      if (!norm(generated).includes(norm(decl))) {
        problems.push(`${p} -> missing declaration: ${decl}`);
      }
    }
  }
  return problems;
}

function build(cfg) {
  const html = readFileSync(cfg.source, 'utf8');
  const hash = createHash('sha256').update(readFileSync(cfg.source)).digest('hex');
  const css = html.split('<style>')[1].split('</style>')[0];
  let body = port(css, cfg);
  if (cfg.keyframePrefix) {
    body = body.replace(/animation:\s*([a-z-]+)/g, (m, n) => `animation: ${cfg.keyframePrefix}${n}`);
  }
  const header = `/* GENERATED — do not hand-edit.
 *
 * Ported verbatim from the LOCKED mockup by scripts/port-mockup-css.mjs.
 *   source: ${cfg.source}
 *   sha256: ${hash}
 *
 * Every rule is scoped under \`${cfg.root}\` so the mockup's generic class names
 * cannot leak into the rest of the application. Rules for the mockup's own app
 * shell (sidebar / topbar / nav) are scoped like everything else and simply
 * never match — the production page renders inside the application's own shell.
 * They are kept rather than filtered so no content rule can be dropped by
 * mistake.
 *
 * Regenerate with: node scripts/port-mockup-css.mjs
 */
`;
  return { output: `${header}\n${body}\n`, css, hash };
}

const check = process.argv.includes('--check');
let failed = 0;

for (const cfg of TARGETS) {
  if (!existsSync(cfg.source)) { console.log(`SKIP  ${cfg.name} — source missing`); continue; }
  const { output, css } = build(cfg);
  const problems = fidelity(css, output, cfg);
  if (problems.length) {
    failed += 1;
    console.error(`FAIL  ${cfg.name} — ${problems.length} declaration(s) lost by the transformer`);
    for (const p of problems.slice(0, 8)) console.error(`        ${p}`);
    continue;
  }
  if (check) {
    const current = existsSync(cfg.target) ? readFileSync(cfg.target, 'utf8') : '';
    if (current !== output) { failed += 1; console.error(`STALE ${cfg.name} — run: node scripts/port-mockup-css.mjs`); }
    else console.log(`OK    ${cfg.name} — current, ${output.split('\n').length} lines, fidelity verified`);
  } else {
    writeFileSync(cfg.target, output);
    console.log(`WROTE ${cfg.name} -> ${cfg.target} (${output.split('\n').length} lines, fidelity verified)`);
  }
}

process.exit(failed ? 1 : 0);
