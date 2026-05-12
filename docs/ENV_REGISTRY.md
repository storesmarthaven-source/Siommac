# ENV_REGISTRY.md — Environment Variable Registry

> **Machine-executable reference.**  
> Every environment variable the system reads is listed here. "Required" means the app will log a warning and partially fail at runtime without it. "Optional" means a safe default is used.

---

## 1. Where Variables Are Set

| Environment | How to set |
|-------------|-----------|
| **Production (Netlify)** | Netlify dashboard → Site → Environment variables |
| **Local dev** | `.env` file in project root (gitignored) — loaded automatically by `netlify dev` |
| **CI / Preview deploys** | Netlify dashboard → same variables, or branch-specific overrides |

**Never** commit `.env` to git. **Never** expose `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` in any frontend file.

---

## 2. Core Variables

### `SUPABASE_URL`

| Field | Value |
|-------|-------|
| **Type** | String — URL |
| **Required** | Yes |
| **Example** | `https://xyzcompany.supabase.co` |
| **Used in** | `netlify/functions/api.js`, `netlify/functions/auto-checkout.js` |
| **Phase introduced** | Phase 0 — initial setup |

The base URL of your Supabase project. Found in Supabase dashboard → Project Settings → API → Project URL.

---

### `SUPABASE_SERVICE_ROLE_KEY`

| Field | Value |
|-------|-------|
| **Type** | String — JWT (long) |
| **Required** | Yes |
| **Example** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (≈ 200 chars) |
| **Used in** | `netlify/functions/api.js`, `netlify/functions/auto-checkout.js` |
| **Phase introduced** | Phase 0 — initial setup |

The service role key grants full database access, bypassing Row Level Security. **Must never appear in browser code.** Found in Supabase dashboard → Project Settings → API → `service_role` key (secret).

Rotate by:
1. Generating a new key in Supabase dashboard
2. Updating Netlify env var
3. Triggering a redeploy

---

### `JWT_SECRET`

| Field | Value |
|-------|-------|
| **Type** | String — arbitrary secret |
| **Required** | Yes |
| **Minimum length** | 32 characters |
| **Example** | `s3cur3-rand0m-str1ng-at-least-32-chars` |
| **Used in** | `netlify/functions/api.js` only |
| **Phase introduced** | Phase 0 — initial setup |

Used to sign and verify HS256 JWTs issued at login. Changing this value immediately invalidates all existing sessions — all users are logged out.

Generate a safe value:
```powershell
[System.Web.Security.Membership]::GeneratePassword(48, 8)
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Planned change (ADR-002):** Replace with `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` (RS256) to eliminate shared-secret risk.

---

### `APP_TZ`

| Field | Value |
|-------|-------|
| **Type** | String — IANA timezone identifier |
| **Required** | No |
| **Default** | `America/Port_of_Spain` |
| **Example** | `America/Port_of_Spain`, `Asia/Karachi`, `Europe/London` |
| **Used in** | `netlify/functions/api.js`, `netlify/functions/auto-checkout.js` |
| **Phase introduced** | Phase 0 — initial setup |

Controls the timezone used for:
- `today()` — the current work date (`YYYY-MM-DD`)
- `hhmm()` / `hhmm24()` — formatting check-in/out times
- Auto-checkout comparison against `workHours.end`
- Payslip pay period dates

If not set, defaults to `America/Port_of_Spain` (UTC−4, Trinidad & Tobago Standard Time).

**Important:** Changing this after data exists will cause historical records to appear to belong to different dates.

---

## 3. Planned Variables (Not Yet Active)

These variables are defined in `IMPLEMENTATION_PLAN.md` and `ARCHITECTURE.md` but are not read by the current codebase. They are listed here so Netlify is pre-configured before the code is deployed.

### `JWT_PRIVATE_KEY`

| Field | Value |
|-------|-------|
| **Type** | String — RSA private key in PEM format |
| **Required** | No (future — replaces `JWT_SECRET` when ADR-002 is implemented) |
| **Example** | `-----BEGIN RSA PRIVATE KEY-----\nMIIE...` |
| **Used in** | `netlify/functions/api.js` (future) |
| **Phase introduced** | Phase 1 — auth hardening |

Signs JWTs. Keep in Netlify env, never in code. Generate with:
```bash
openssl genrsa -out private.pem 2048
cat private.pem   # paste value into Netlify, replacing \n with literal newlines
```

---

### `JWT_PUBLIC_KEY`

| Field | Value |
|-------|-------|
| **Type** | String — RSA public key in PEM format |
| **Required** | No (future — replaces `JWT_SECRET` when ADR-002 is implemented) |
| **Example** | `-----BEGIN PUBLIC KEY-----\nMIIB...` |
| **Used in** | `netlify/functions/api.js` (future) |
| **Phase introduced** | Phase 1 — auth hardening |

Verifies JWTs. Derived from `JWT_PRIVATE_KEY`:
```bash
openssl rsa -in private.pem -pubout -out public.pem
cat public.pem
```

---

### `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`

| Field | Value |
|-------|-------|
| **Type** | Integer |
| **Required** | No (future) |
| **Default (planned)** | `60000` / `60` |
| **Used in** | `netlify/functions/api.js` (future — login rate limiting) |
| **Phase introduced** | Phase 1 — auth hardening |

Controls brute-force protection on the `login` route. Window in milliseconds; max attempts per window per IP.

---

## 4. Variable Summary Table

| Variable | Required | Has Default | Rotatable | Secret |
|----------|----------|-------------|-----------|--------|
| `SUPABASE_URL` | Yes | No | No | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | Yes — logs out no one | **Yes** |
| `JWT_SECRET` | Yes | No | Yes — logs out all users | **Yes** |
| `APP_TZ` | No | `America/Port_of_Spain` | Not recommended | No |
| `JWT_PRIVATE_KEY` *(future)* | — | — | Yes — logs out no one | **Yes** |
| `JWT_PUBLIC_KEY` *(future)* | — | — | With private key | No |
| `RATE_LIMIT_WINDOW_MS` *(future)* | — | `60000` | Yes | No |
| `RATE_LIMIT_MAX` *(future)* | — | `60` | Yes | No |

---

## 5. Local Development `.env` Template

Create this file at the project root. It is already listed in `.gitignore`.

```env
# .env — local development only, never commit this file

SUPABASE_URL=https://your-test-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=local-dev-secret-change-before-production-32chars
APP_TZ=America/Port_of_Spain
```

Use a **separate Supabase project** for local dev — never point local dev at the production database.

---

## 6. Netlify-Specific Notes

- Variables set in the Netlify dashboard are available to all functions in `netlify/functions/`
- They are **not** available to frontend JavaScript (anything in the `assets/` or root HTML files)
- Preview deploy branches inherit production variables unless overridden in the Netlify dashboard under **Branch deploys**
- After changing any variable, trigger a manual redeploy: Netlify dashboard → Deploys → Trigger deploy
