// apply_suggestions.js — apply no-unnecessary-type-conversion suggestions
// Uses LF-normalized strings to match ESLint's offset computation
'use strict';
const fs = require('fs');
const path = require('path');

const jsonPath = process.argv[2] || '/tmp/lint_suggestions.json';
const ruleName = process.argv[3] || '@typescript-eslint/no-unnecessary-type-conversion';

const d = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const byFile = {};
d.forEach(function(f) {
  f.messages.forEach(function(m) {
    if (m.ruleId !== ruleName) return;
    if (!m.suggestions || !m.suggestions.length) return;
    var fix = m.suggestions[0].fix;
    if (!byFile[f.filePath]) byFile[f.filePath] = [];
    byFile[f.filePath].push(fix);
  });
});

var totalFixed = 0;
Object.keys(byFile).forEach(function(filePath) {
  var fixes = byFile[filePath];
  var raw = fs.readFileSync(filePath, 'utf8');
  // ESLint normalizes CRLF to LF before computing character offsets
  var lf = raw.replace(/\r\n/g, '\n');

  // Apply from highest offset to lowest so earlier offsets aren't shifted
  fixes.sort(function(a, b) { return b.range[0] - a.range[0]; });

  var result = lf;
  fixes.forEach(function(fix) {
    var start = fix.range[0];
    var end = fix.range[1];
    result = result.slice(0, start) + fix.text + result.slice(end);
    totalFixed++;
  });

  fs.writeFileSync(filePath, result, 'utf8');
  var fname = filePath.replace(/.*[\/\\]/g, '');
  console.log('Fixed ' + fixes.length + ' in ' + fname);
});
console.log('Total fixed: ' + totalFixed);
