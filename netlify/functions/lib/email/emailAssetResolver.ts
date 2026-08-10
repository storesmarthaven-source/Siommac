/**
 * lib/email/emailAssetResolver.ts — turn authored asset paths into publicly fetchable URLs.
 *
 * A mail client fetches images with NO session: no cookie, no bearer token, no signed URL. So
 * every image an email references must sit at an absolute, anonymously reachable URL. The Studio,
 * correctly, authors against repo-relative paths (`/assets/images/email/logo.png`) — those resolve
 * on the canvas and in a preview iframe, and resolve to nothing in an inbox.
 *
 * ⭐ RESOLUTION HAPPENS SERVER-SIDE, AT SEND TIME. The alternative — making authors paste absolute
 * URLs into the editor — pushes an infrastructure detail into content, bakes today's hostname into
 * every saved template, and breaks silently the day the bucket or CDN changes. Here it is one
 * mapping, applied once, and a template stays portable.
 *
 * Anything that CANNOT be resolved is still refused by the caller. Resolution widens what can be
 * sent; it does not weaken the guarantee that nothing broken goes out.
 */

/** Authored prefix the Studio uses for email artwork. */
const AUTHORED_PREFIX = '/assets/images/email/';

/**
 * Where published email art lives. `branding` is an existing PUBLIC bucket used for exactly this
 * class of asset — see scripts/publish-email-assets.mjs, which must be run for these to exist.
 *
 * `EMAIL_ASSET_BASE_URL` overrides it, so moving to a CDN later is an environment change rather
 * than a code change or a rewrite of every stored template.
 */
export function emailAssetBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = (env.EMAIL_ASSET_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (override) return override;
  const supabase = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!supabase) return null;
  return `${supabase}/storage/v1/object/public/branding/email`;
}

export interface AssetResolution {
  html: string;
  /** Rewritten authored paths → absolute URLs. */
  resolved: string[];
  /** Still not absolute after resolution — the caller must refuse these. */
  unresolved: string[];
}

const isAbsolute = (src: string): boolean => /^https?:\/\//i.test(src) || /^data:/i.test(src);

/**
 * Rewrite authored asset paths to their public URLs and report what could not be resolved.
 *
 * Only `<img src>` is considered: that is what a mail client fetches. CSS background images are
 * deliberately out of scope because most mail clients do not render them at all, so "resolving"
 * one would imply support that does not exist.
 */
export function resolveEmailAssets(html: string, env: NodeJS.ProcessEnv = process.env): AssetResolution {
  const base = emailAssetBaseUrl(env);
  const resolved: string[] = [];
  const unresolved = new Set<string>();

  const out = html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (match, head: string, src: string, tail: string) => {
    const value = src.trim();
    if (!value || isAbsolute(value)) return match;

    // Only the authored email-asset prefix is mapped. A stray relative path from somewhere else is
    // NOT quietly pointed at the email bucket — that would invent a URL that does not exist and
    // turn a visible refusal into a broken image in someone's inbox.
    if (base && value.startsWith(AUTHORED_PREFIX)) {
      const file = value.slice(AUTHORED_PREFIX.length).replace(/^\/+/, '');
      if (file) {
        resolved.push(value);
        return `${head}${base}/${file}${tail}`;
      }
    }
    unresolved.add(value);
    return match;
  });

  return { html: out, resolved, unresolved: [...unresolved].sort() };
}
