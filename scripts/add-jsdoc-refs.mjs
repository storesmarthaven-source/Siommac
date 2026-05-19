/**
 * scripts/add-jsdoc-refs.mjs
 *
 * One-time migration: inserts @see docs/ references into every
 * src/*.ts / src/*.tsx file that lacks them.
 *
 * Run: node scripts/add-jsdoc-refs.mjs
 */

import { execSync }          from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

/** Decide which docs to cite based on the file path. */
function getDocs(file) {
  const f = file.replace(/\\/g, '/');
  const docs = [
    ' * @see docs/ARCHITECTURE.md',
    ' * @see docs/CODING_STANDARDS.md',
  ];
  if (f.includes('/shell/'))                            docs.push(' * @see docs/SHELL_STRUCTURE.md');
  if (f.includes('/sections/') || f.includes('/shell/sections/')) docs.push(' * @see docs/UI_DESIGN_SYSTEM.md');
  if (f.includes('/lib/') || f.includes('/store/') || f.includes('/api')) docs.push(' * @see docs/PHASE_PLAN.md');
  return docs;
}

// Collect files that don't already have @see docs/
const raw = execSync(
  'grep -rL "@see docs/" src/ --include="*.ts" --include="*.tsx"',
  { encoding: 'utf8' }
).trim();

const files = raw.split('\n').filter(Boolean);
let updated = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  const docs = getDocs(file);
  const seeBlock = ' *\n' + docs.join('\n') + '\n';

  const closeIdx = content.indexOf(' */');
  if (closeIdx === -1) {
    // No JSDoc — prepend a minimal block
    const header = `/**\n * ${file.replace(/\\/g, '/')}\n *\n${docs.join('\n')}\n */\n\n`;
    content = header + content;
  } else {
    // Insert before the first closing */
    content = content.slice(0, closeIdx) + seeBlock + content.slice(closeIdx);
  }

  writeFileSync(file, content, 'utf8');
  updated++;
}

console.log(`Updated ${updated} files with @see docs/ references.`);
