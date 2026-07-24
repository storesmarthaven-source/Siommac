#!/usr/bin/env bash
#
# safe-worktree-remove.sh — remove a git worktree on Windows WITHOUT letting the
# removal traverse a directory JUNCTION (reparse point) into another checkout.
#
# WHY THIS EXISTS
#   Our worktrees share the main checkout's dependency install through a
#   `node_modules` JUNCTION that points at:
#       \??\C:\Users\MSI Laptop\Desktop\Siomac\node_modules
#   Both `git worktree remove --force` and `rm -rf` recurse THROUGH such a
#   junction and delete the TARGET's contents — i.e. they silently wipe
#   main/node_modules (this is exactly what partially deleted main's install
#   and blocked F-01). `rmdir` on a junction, by contrast, removes ONLY the
#   link and leaves the target intact.
#
#   This script unlinks EVERY top-level reparse point in the worktree with
#   `rmdir` first, and only then calls `git worktree remove`. It never runs
#   `rm -rf` against a junction.
#
# USAGE
#   scripts/win/safe-worktree-remove.sh <worktree-path> [--force]
#
set -euo pipefail

wt="${1:-}"
force="${2:-}"

if [[ -z "$wt" ]]; then
  echo "usage: $0 <worktree-path> [--force]" >&2
  exit 2
fi

if [[ -n "$force" && "$force" != "--force" ]]; then
  echo "[safe-rm] second argument, if given, must be --force (got: $force)" >&2
  exit 2
fi

if [[ ! -d "$wt" ]]; then
  echo "[safe-rm] '$wt' is not a directory — pruning stale worktree metadata only." >&2
  git worktree prune -v
  exit 0
fi

# Unlink every top-level reparse point (junction/symlink) in the worktree BEFORE
# removal, so the subsequent delete cannot follow one into another checkout.
unlinked=0
shopt -s nullglob dotglob
for entry in "$wt"/*; do
  [[ -d "$entry" ]] || continue
  win="$(cygpath -w "$entry")"
  if fsutil reparsepoint query "$win" >/dev/null 2>&1; then
    echo "[safe-rm] unlinking junction (target preserved): $win"
    cmd //c rmdir "$win"
    unlinked=$((unlinked + 1))
  fi
done
shopt -u nullglob dotglob
echo "[safe-rm] unlinked $unlinked junction(s) before removal."

echo "[safe-rm] git worktree remove ${force:-} $wt"
if [[ -n "$force" ]]; then
  git worktree remove "$force" "$wt"
else
  git worktree remove "$wt"
fi

echo "[safe-rm] done — shared target installs (e.g. main/node_modules) left intact."
