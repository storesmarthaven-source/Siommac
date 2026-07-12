/**
 * apply_line_col.js
 *
 * Applies ESLint suggestion fixes using line/column positions
 * instead of byte/character offsets.
 *
 * This avoids the CRLF issue: ESLint reports 1-based line/column positions
 * which are unaffected by \r characters (they appear at line-ends only).
 *
 * For each suggestion, we:
 * 1. Go to the reported line
 * 2. Within that line, apply the column-range replacement
 *
 * IMPORTANT: This only works for SINGLE-LINE suggestions (fix.range within one line).
 * Multi-line suggestions must fall back to the offset approach.
 *
 * Usage: node apply_line_col.js [lintJsonPath] [ruleName]
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

const ruleName = process.argv[2] || '@typescript-eslint/no-unnecessary-type-conversion';

// Run eslint fresh on current state
console.log('Running ESLint to get fresh violations...');
let rawJson;
try {
  rawJson = execSync(
    `npx eslint src/ --rule "{\\"${ruleName}\\":\\"error\\"}" --format json`,
    { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }
  );
} catch (err) {
  // eslint exits with non-zero when there are violations, stdout still has JSON
  rawJson = err.stdout;
}

const d = JSON.parse(rawJson);

// Collect violations per file
const byFile = {};
d.forEach(function(f) {
  f.messages.forEach(function(m) {
    if (m.ruleId !== ruleName) return;
    if (!m.suggestions || !m.suggestions.length) return;
    if (!byFile[f.filePath]) byFile[f.filePath] = [];
    byFile[f.filePath].push({
      line: m.line,   // 1-based
      col: m.column,  // 1-based
      fix: m.suggestions[0].fix,
      fixRange: m.suggestions[0].fix.range,
      fixText: m.suggestions[0].fix.text,
    });
  });
});

let totalFixed = 0;
Object.keys(byFile).forEach(function(filePath) {
  const violations = byFile[filePath];

  // Read file preserving CRLF
  const raw = fs.readFileSync(filePath, 'utf8');
  // Split into lines (keep \r in each line if CRLF, remove at line boundary)
  const hasCRLF = raw.includes('\r\n');
  const lineEnding = hasCRLF ? '\r\n' : '\n';
  const lines = raw.split(lineEnding);

  // Convert fix.range (LF-offset based) to line/col for reliable application.
  // Compute line starts in LF-normalized string.
  const lf = raw.replace(/\r\n/g, '\n');

  // Sort by line DESC then column DESC to apply from end to start
  violations.sort(function(a, b) {
    if (a.fixRange[0] !== b.fixRange[0]) return b.fixRange[0] - a.fixRange[0];
    return 0;
  });

  // Apply each fix: find the line/column in the LF string, determine which
  // line it's on, then apply the character-level change to that line in the
  // lines[] array.
  violations.forEach(function(v) {
    const startOffset = v.fixRange[0];
    const endOffset = v.fixRange[1];

    // Find which line startOffset falls on
    let lineIdx = 0;
    let charCount = 0;
    for (let i = 0; i < lf.length; i++) {
      if (charCount === startOffset) break;
      if (lf[i] === '\n') lineIdx++;
      charCount++;
    }

    // Column within the line (0-based)
    let lineStart = lf.lastIndexOf('\n', startOffset - 1) + 1;
    const colStart = startOffset - lineStart;
    const colEnd = colStart + (endOffset - startOffset);

    // Sanity check: is the segment we're replacing what we expect?
    const lineContent = lines[lineIdx];
    if (!lineContent) {
      console.warn('  SKIP: line ' + (lineIdx+1) + ' not found');
      return;
    }

    // Apply replacement
    const newLine = lineContent.slice(0, colStart) + v.fixText + lineContent.slice(colEnd);
    lines[lineIdx] = newLine;
    totalFixed++;
  });

  // Write back with original line endings
  fs.writeFileSync(filePath, lines.join(lineEnding), 'utf8');
  const fname = filePath.replace(/.*[\/\\]/g, '');
  console.log('Fixed ' + violations.length + ' in ' + fname);
});
console.log('Total fixed: ' + totalFixed);
