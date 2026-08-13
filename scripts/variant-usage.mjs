/**
 * scripts/variant-usage.mjs — which canonical variants does the app ACTUALLY use?
 *
 * A design system that ships variants nobody calls is carrying dead surface: it
 * has to be themed, tested, documented and kept accessible forever. This counts
 * real call sites per variant and splits them three ways, because "used" means
 * different things in different places:
 *
 *   app   a product surface uses it            — genuine demand
 *   kit   another canonical component uses it  — genuine, the kit composing itself
 *   docs  registry / studio / gallery only     — it exists to be documented
 *
 * A variant with app=0 and kit=0 is only ever demonstrated by the thing that
 * documents it. Usage: node scripts/variant-usage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = {
  Button: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'],
  Badge:  ['soft', 'solid', 'outline'],
  Card:   ['surface', 'panel', 'metric', 'action'],
  Tabs:   ['underline', 'contained', 'subtle'],
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!p.includes('node_modules')) walk(p, out); }
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const zoneOf = (posix) =>
  /src\/ui\/(registry|studio|gallery)\//.test(posix) ? 'docs'
  : /src\/ui\//.test(posix) ? 'kit'
  : 'app';

const files = walk('src').map(f => ({ f, posix: f.split(path.sep).join('/') }));

for (const [comp, variants] of Object.entries(COMPONENTS)) {
  const tally = Object.fromEntries(variants.map(v => [v, { app: 0, kit: 0, docs: 0 }]));
  // `s` flag: a JSX element's props routinely span lines.
  const re = new RegExp(`<${comp}\\s[^>]*?variant=["']([a-z]+)["']`, 'gs');

  for (const { f, posix } of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) {
      const v = m[1];
      if (tally[v]) tally[v][zoneOf(posix)] += 1;
    }
  }

  console.log(`\n${comp}`);
  for (const v of variants) {
    const t = tally[v];
    const dead = t.app === 0 && t.kit === 0;
    console.log(
      `  ${v.padEnd(10)} app=${String(t.app).padStart(3)}  kit=${String(t.kit).padStart(3)}` +
      `  docs=${String(t.docs).padStart(3)}${dead ? '   <-- documented only' : ''}`,
    );
  }
}
