/**
 * fix_suggestions.js — apply ESLint suggestion fixes using raw CRLF offsets
 *
 * KEY INSIGHT: ESLint's fix.range values are character positions in the RAW file
 * (CRLF preserved). Do NOT normalize CRLF before applying.
 *
 * Usage: node fix_suggestions.js <ruleName>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ruleName = process.argv[2] || '@typescript-eslint/no-unnecessary-type-conversion';

// Get fresh ESLint output
let rawJson;
try {
  rawJson = execSync(
    `npx eslint src/ --rule "{\\"${ruleName}\\":\\"error\\"}" --format json`,
    { maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }
  );
} catch (e) {
  // eslint exits 1 when there are violations, output is still valid JSON on stdout
  rawJson = e.stdout;
}

const d = JSON.parse(rawJson);
const byFile = {};
d.forEach(function(f) {
  f.messages.forEach(function(m) {
    if (m.ruleId !== ruleName) return;
    if (!m.suggestions || !m.suggestions.length) return;
    const fix = m.suggestions[0].fix;
    if (!byFile[f.filePath]) byFile[f.filePath] = [];
    byFile[f.filePath].push(fix);
  });
});

let totalFixed = 0;
Object.keys(byFile).forEach(function(filePath) {
  const fixes = byFile[filePath];
  // Read raw content — ESLint's range values are positions in the CRLF file as-is.
  // Do NOT do any CRLF→LF normalization.
  let content = fs.readFileSync(filePath, 'utf8');

  // Apply from highest offset to lowest so earlier offsets stay valid.
  fixes.sort(function(a, b) { return b.range[0] - a.range[0]; });

  fixes.forEach(function(fix) {
    content = content.slice(0, fix.range[0]) + fix.text + content.slice(fix.range[1]);
    totalFixed++;
  });

  fs.writeFileSync(filePath, content, 'utf8');
  const fname = path.basename(filePath);
  console.log('Fixed ' + fixes.length + ' in ' + fname);
});
console.log('Total fixed: ' + totalFixed);
