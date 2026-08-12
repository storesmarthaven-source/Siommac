/**
 * src/ui/theme/cssTokenGraph.ts — read the app's custom-property graph from the
 * CSS SOURCE FILES.
 *
 * Why this exists: jsdom does not implement the custom-property cascade, so a
 * component test can never prove that editing `--ui-color-action-primary`
 * actually reaches `.ui-btn--primary`'s background. Asserting it in a browser
 * covers one path at a time; asserting it against the source covers every path
 * at once and fails the moment a recipe is written back onto a raw palette
 * variable.
 *
 * This is deliberately a *declaration* graph, not a CSS engine. It reads
 * top-level `--x: value;` declarations, so it models exactly what the token
 * layers are: `:root` defaults chained through `var()`. Selector specificity,
 * media queries and scoped blocks are out of scope — token layering does not
 * use them, and pretending otherwise would make the model less trustworthy,
 * not more.
 *
 * Used by the theme tests; not shipped behaviour. It lives beside the theme
 * code rather than in a test folder so the recipe-drift guard can import it
 * from anywhere without a fragile relative path.
 */

/** `--name: value;` — one declaration, wherever it appeared in the file. */
const DECL = /(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)[;}]/g;

/** `var(--name, fallback)` — captures the name and everything after the comma. */
const VAR_REF = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,([^)]*(?:\([^)]*\)[^)]*)*))?\)/;

export type DeclMap = Map<string, string>;

/**
 * A token block: any rule whose SELECTOR LIST mentions `:root`.
 *
 * Matching the selector list rather than a bare `:root` matters — every token
 * block is `:root, [data-ui-preview-scope] { … }` so that scoped drafts can
 * re-resolve derived tokens (see the note in semantic.css). A regex anchored on
 * `:root {` silently matched nothing after that change and every resolution
 * returned null.
 */
const ROOT_BLOCK = /[^{}]*:root[^{}]*\{([^{}]*)\}/g;

/**
 * Collect the DEFAULT custom-property declarations from the given CSS sources.
 *
 * Only `:root` blocks are read. That is not a simplification, it is the model:
 * the token layers are all `:root` defaults chained through `var()`, while a
 * declaration inside a component block (`.ui-dialog--danger { --ui-dialog-
 * accent-color: … }`) is a SCOPED override that applies to one variant. Folding
 * those into the same flat map produced a genuinely wrong answer — the danger
 * variant's red became "the" dialog accent colour — so they are excluded and
 * the model stays honest about what it covers.
 *
 * Later sources win, mirroring the app's own load order; within one source the
 * last declaration wins, which is what the cascade does for equal-specificity
 * `:root` rules.
 */
export function collectDecls(sources: string[]): DeclMap {
  const out: DeclMap = new Map();
  for (const css of sources) {
    // Strip comments first: a commented-out declaration is not a declaration,
    // and these files are heavily commented with example values.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of stripped.matchAll(ROOT_BLOCK)) {
      for (const m of block[1]!.matchAll(DECL)) out.set(m[1]!, m[2]!.trim());
    }
  }
  return out;
}

export interface ResolveResult {
  /** The fully-substituted value, or null if a referenced token is undefined. */
  value: string | null;
  /** Every custom property visited, in order, starting with the requested one. */
  chain: string[];
}

/**
 * Resolve a custom property to its literal value by substituting `var()`
 * references depth-first.
 *
 * `overrides` models the draft/publish layer: values set on `:root` (or on the
 * preview scope) that out-rank the file declarations. That is precisely what
 * `applyThemeOverrides` / `applyScopedOverrides` do at runtime, so a test can
 * ask "if the Brand Theme engine publishes THIS map, what colour does the
 * primary button end up?" and get the real answer.
 */
export function resolveToken(
  name: string,
  decls: DeclMap,
  overrides: Record<string, string> = {},
  seen = new Set<string>(),
): ResolveResult {
  const chain: string[] = [name];
  if (seen.has(name)) return { value: null, chain };   // cycle — report, don't hang
  seen.add(name);

  const raw = overrides[name] ?? decls.get(name);
  if (raw === undefined) return { value: null, chain };

  let value = raw;
  let guard = 0;
  for (;;) {
    const m = VAR_REF.exec(value);
    if (!m) break;
    if (++guard > 64) return { value: null, chain };

    const inner = resolveToken(m[1]!, decls, overrides, seen);
    chain.push(...inner.chain.slice(1));
    const fallback = m[2]?.trim();
    const substitution = inner.value ?? (fallback ? resolveLiteral(fallback, decls, overrides, chain) : null);
    if (substitution === null) return { value: null, chain };

    value = value.slice(0, m.index) + substitution + value.slice(m.index + m[0].length);
  }
  return { value: value.trim(), chain };
}

/** Resolve a `var()` fallback expression, which may itself contain `var()`. */
function resolveLiteral(
  expr: string,
  decls: DeclMap,
  overrides: Record<string, string>,
  chain: string[],
): string | null {
  let value = expr;
  let guard = 0;
  for (;;) {
    const m = VAR_REF.exec(value);
    if (!m) return value.trim();
    if (++guard > 64) return null;
    const inner = resolveToken(m[1]!, decls, overrides, new Set());
    chain.push(...inner.chain);
    const nested = m[2]?.trim();
    const substitution = inner.value ?? (nested ? resolveLiteral(nested, decls, overrides, chain) : null);
    if (substitution === null) return null;
    value = value.slice(0, m.index) + substitution + value.slice(m.index + m[0].length);
  }
}

/** Every custom property a CSS source REFERENCES via `var()`. */
export function collectVarRefs(css: string): Set<string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set<string>();
  for (const m of stripped.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) out.add(m[1]!);
  return out;
}
