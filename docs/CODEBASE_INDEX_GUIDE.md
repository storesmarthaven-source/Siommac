# SIOMAC Codebase Index Guide

The deterministic codebase index gives Claude and reviewers a fast, current lookup layer without
making generated documentation the source of truth.

## Start Here

For implementation work, read in this order:

1. `CLAUDE.md` for repository rules and required gates.
2. `docs/REPO_MAP.md` for curated architecture and ownership boundaries.
3. `docs/generated/CODEBASE_INDEX.md` for current inventory and module counts.
4. `docs/generated/modules/<module>.md` for the target module.
5. The TSV or JSON indexes for exact lookup.
6. The current source file immediately before editing it.

## Generated Files

| File | Purpose |
|---|---|
| `docs/generated/CODEBASE_INDEX.md` | Human-readable repository summary. |
| `docs/generated/modules/<module>.md` | Module pages, hooks, routes, permissions, widgets, database objects, and E2E suites. |
| `docs/generated/SYMBOL_INDEX.tsv` | Exact named-symbol lookup with file and line. |
| `docs/generated/ROUTE_INDEX.tsv` | Mounted and unmounted routes, permissions, guards, schemas, file, and line. |
| `docs/generated/WIDGET_INDEX.tsv` | Registry and page-local widget definitions. |
| `docs/generated/CODEBASE_INDEX.json` | Complete machine-readable index for tools and agents. |

## Commands

```bash
# Refresh after structural code, routes, SQL, widgets, or E2E changes.
npm run repo:index

# Verify generated files match the current source.
npm run repo:index:check

# Verify every mounted route is tested or explicitly tracked as debt/deferred.
npm run test:e2e:coverage
```

The pre-commit hook runs `repo:index:check`. The E2E coverage gate also refuses to run from a stale
route index, preventing an incomplete route scan from producing a false green result.

## Claude Operating Rule

Use generated maps to locate likely files and relationships. Do not edit generated files and do not
assume a relationship is absent only because static analysis did not derive it. Re-read the source,
verify live schemas and behavior when relevant, implement the change, regenerate the index, and run
the required module and regression gates.

## Static-Analysis Boundary

The generator resolves normal imports, named/default router exports, static constants, template
expressions, finite route-registration loops, symbols, widgets, SQL definitions, and E2E calls.
Runtime-loaded widget packages, reflection, arbitrary dynamic paths, and indirect database access
may still require targeted source inspection. Source and live behavior remain authoritative.
