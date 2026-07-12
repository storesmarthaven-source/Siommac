"""
fix_unused.py
Apply no-unused-vars fixes by prefixing unused vars/args with _.
Reads pre-generated ESLint JSON from a file argument.
Only processes violations that have NO existing ESLint suggestion (those are already handled).
"""
import json, re, os, sys

RULE = "@typescript-eslint/no-unused-vars"
json_path = sys.argv[1]

with open(json_path, encoding="utf-8") as fh:
    data = json.load(fh)

# Collect violations with no fix/suggestion
violations = []
for f in data:
    for m in f["messages"]:
        if m.get("ruleId") != RULE:
            continue
        if m.get("fix") or m.get("suggestions"):
            continue  # already handled by fix_suggestions.js
        name_match = re.search(r"'([^']+)' is (?:assigned a value|defined) but never used", m["message"])
        if not name_match:
            continue
        var_name = name_match.group(1)
        violations.append({
            "file": f["filePath"],
            "line": m["line"],
            "col": m["column"],
            "name": var_name,
        })

print(f"Found {len(violations)} violations without suggestions")

# Group by file
by_file = {}
for v in violations:
    by_file.setdefault(v["file"], []).append(v)

def find_and_prefix(line_content, col_1, var_name):
    """Add _ prefix to var_name at or near the given 1-based column in the line."""
    pos = max(0, col_1 - 1)

    def is_word_char(c):
        return c.isalnum() or c == '_'

    def check_boundary(p):
        before = line_content[p-1] if p > 0 else ' '
        after = line_content[p+len(var_name)] if p+len(var_name) < len(line_content) else ' '
        return not is_word_char(before) and not is_word_char(after)

    # Try exact position first
    if line_content[pos:pos+len(var_name)] == var_name and check_boundary(pos):
        return line_content[:pos] + "_" + line_content[pos:]

    # Search near the column (within window)
    for offset in range(-5, 20):
        p = pos + offset
        if p < 0 or p + len(var_name) > len(line_content):
            continue
        if line_content[p:p+len(var_name)] == var_name and check_boundary(p):
            return line_content[:p] + "_" + line_content[p:]

    # Fallback: search anywhere in the line with word boundary
    pattern = r'\b' + re.escape(var_name) + r'\b'
    match = re.search(pattern, line_content)
    if match:
        return line_content[:match.start()] + "_" + line_content[match.start():]

    return None

total_fixed = 0
total_skipped = 0

for file_path, vs in sorted(by_file.items()):
    with open(file_path, encoding="utf-8") as fh:
        content = fh.read()

    has_crlf = "\r\n" in content
    sep = "\r\n" if has_crlf else "\n"
    lines = content.split(sep)

    # Sort violations by line DESC then col DESC
    vs_sorted = sorted(vs, key=lambda v: (v["line"], v["col"]), reverse=True)

    fixed_in_file = 0
    for v in vs_sorted:
        line_idx = v["line"] - 1
        if line_idx >= len(lines):
            print(f"  SKIP (out-of-range): {v['name']} @ {os.path.basename(file_path)}:{v['line']}")
            total_skipped += 1
            continue

        original_line = lines[line_idx]
        new_line = find_and_prefix(original_line, v["col"], v["name"])

        if new_line is None:
            print(f"  SKIP (not found): '{v['name']}' @ {os.path.basename(file_path)}:{v['line']}")
            total_skipped += 1
            continue

        if new_line == original_line:
            print(f"  SKIP (no change): '{v['name']}' @ {os.path.basename(file_path)}:{v['line']}")
            total_skipped += 1
            continue

        lines[line_idx] = new_line
        fixed_in_file += 1
        total_fixed += 1

    if fixed_in_file > 0:
        new_content = sep.join(lines)
        with open(file_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_content)
        print(f"Fixed {fixed_in_file} in {os.path.basename(file_path)}")

print(f"\nTotal fixed: {total_fixed}, skipped: {total_skipped}")
