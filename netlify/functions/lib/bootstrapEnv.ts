// ── Local-dev env bootstrap ───────────────────────────────────────────────────
// Import this FIRST in every function entrypoint.
//
// Why: when a Netlify project env var is marked "secret" (e.g. OPENAI_API_KEY),
// `netlify dev` injects a masked placeholder into the local function process —
// NOT the real value, and NOT the value from .env (a pre-existing process.env
// key wins over .env in both netlify-cli's merge and dotenv's default).
// Result: the route sees a 414-char non-"sk-" blob and reports "not configured"
// even though .env has a valid key.
//
// `override: true` makes the local .env the source of truth in dev — matching
// netlify-cli's own documented precedence ("Ignored project settings env var …
// defined in .env file"). In production no .env file is deployed, so this
// no-ops and the real Netlify-injected secrets apply untouched.
import dotenv from 'dotenv';

dotenv.config({ override: true, quiet: true });
