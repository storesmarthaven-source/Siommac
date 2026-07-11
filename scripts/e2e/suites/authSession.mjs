// E2E — Auth session lifecycle (httpOnly refresh-token cookie).
// Verifies the Phase-2b cookie model end-to-end against the live server:
//   • /refreshToken accepts the token ONLY via the httpOnly cookie — the legacy
//     body channel is dead, and the JSON response never contains a refresh token.
//   • Rotation: old token invalidated (replay → 401), new hashed row in
//     refresh_tokens with device metadata carried over + last_seen_at bumped.
//   • The rotated access token actually authenticates.
//   • Expired tokens are rejected AND their row is cleaned up.
//   • /logout revokes the user's refresh tokens and expires the cookie.
// Uses a synthetic app_user + directly-seeded refresh_tokens rows (sha256, same
// scheme as lib/auth.ts) so no real user's single-session tokens are disturbed.

import crypto from 'node:crypto';

export const title = 'Auth Session (refresh cookie)';

const RT_COOKIE = 'siomac_rt';

/** Collect Set-Cookie headers across Node versions. */
function setCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}
/** The Set-Cookie entry for the refresh cookie, or null. */
function rtCookie(res) {
  return setCookies(res).find(c => c.startsWith(`${RT_COOKIE}=`)) ?? null;
}
/** Extract the raw cookie value from a Set-Cookie line. */
function cookieValue(line) {
  return line.split(';')[0].split('=').slice(1).join('=');
}

export default async function run(h) {
  const { test, expect, sb, TAG } = h;
  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  // ── Synthetic user (never a real account — /logout nukes all user tokens) ──
  const userId = `${TAG}-authsess`;
  {
    const { error } = await sb.from('app_users').insert({
      id: userId, username: `${TAG}_authsess`, full_name: 'Auth Session E2E',
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    if (error) { h.log?.(`authSession: could not create synthetic user — ${error.message}`); return; }
  }
  h.onCleanup(async () => {
    await sb.from('refresh_tokens').delete().eq('user_id', userId);
    await sb.from('app_users').delete().eq('id', userId);
  });

  /** Seed a refresh token row directly (same hashing scheme as the backend). */
  const seedToken = async ({ expiresInMs = 24 * 3600 * 1000, ua = 'E2E-Device/1.0', ip = '203.0.113.7' } = {}) => {
    const plain = crypto.randomBytes(32).toString('hex');
    const { error } = await sb.from('refresh_tokens').insert({
      user_id: userId, token_hash: sha256(plain),
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      user_agent: ua, ip_address: ip, last_seen_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    if (error) throw new Error(`seed refresh token: ${error.message}`);
    return plain;
  };

  /** Raw POST with optional Cookie header (harness.api has no cookie support). */
  const post = async (path, { cookie, token, args = {} } = {}) => {
    const res = await fetch(`${h.base}/api/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: `${RT_COOKIE}=${cookie}` } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ args }),
    });
    let body; try { body = await res.json(); } catch { body = {}; }
    return { status: res.status, body, res };
  };

  // ── Refresh: cookie is the ONLY channel ───────────────────────────────────
  h.section('Auth Session › Refresh channel');

  await test('no cookie → 401', async () => {
    const r = await post('refreshToken');
    expect(r.status === 401 && r.body.success === false, `expected 401, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  });

  await test('legacy body-supplied refreshToken (old protocol) → 401', async () => {
    const plain = await seedToken();
    const r = await post('refreshToken', { args: { refreshToken: plain } });
    expect(r.status === 401, `body channel must be dead — got ${r.status}`);
    await sb.from('refresh_tokens').delete().eq('token_hash', sha256(plain)); // tidy
  });

  // ── Rotation ───────────────────────────────────────────────────────────────
  h.section('Auth Session › Rotation');

  let rotatedPlain = null;
  await test('valid cookie → 200, access token + expiresAt, NO refreshToken in JSON', async () => {
    const plain = await seedToken();
    const r = await post('refreshToken', { cookie: plain });
    expect(r.status === 200 && r.body.success === true, `expected 200 ok, got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    expect(typeof r.body.token === 'string' && r.body.token.length > 20, 'access token missing');
    expect(typeof r.body.expiresAt === 'number' && r.body.expiresAt > Date.now(), 'expiresAt missing/past');
    expect(!('refreshToken' in r.body), 'refresh token MUST NOT appear in the JSON body');

    const sc = rtCookie(r.res);
    expect(sc, 'rotated Set-Cookie missing');
    expect(/httponly/i.test(sc), 'cookie must be HttpOnly');
    expect(/path=\/api/i.test(sc), 'cookie must be path-scoped to /api');
    rotatedPlain = cookieValue(sc);
    expect(rotatedPlain && rotatedPlain !== plain, 'cookie value must be a NEW token');

    // DB: old hash gone, new hash present with carried device metadata
    const { data: oldRow } = await sb.from('refresh_tokens').select('token_hash').eq('token_hash', sha256(plain)).maybeSingle();
    expect(!oldRow, 'old token row must be deleted on rotation');
    const { data: newRow } = await sb.from('refresh_tokens')
      .select('user_agent, ip_address, last_seen_at').eq('token_hash', sha256(rotatedPlain)).maybeSingle();
    expect(newRow, 'rotated token row missing');
    expect(newRow.user_agent === 'E2E-Device/1.0' && newRow.ip_address === '203.0.113.7',
      'device metadata must carry over on rotation (Sessions page)');
    expect(new Date(newRow.last_seen_at).getTime() > Date.now() - 60_000, 'last_seen_at must be bumped');

    // Old-cookie replay after rotation → 401 (and the failed replay clears the cookie)
    const replay = await post('refreshToken', { cookie: plain });
    expect(replay.status === 401, `replayed rotated-away cookie must 401, got ${replay.status}`);
    const cleared = rtCookie(replay.res);
    expect(cleared && (/max-age=0/i.test(cleared) || /expires=/i.test(cleared)), 'failed refresh must clear the cookie');
  });

  await test('rotated access token authenticates against a protected route', async () => {
    expect(rotatedPlain, 'depends on rotation test');
    const r1 = await post('refreshToken', { cookie: rotatedPlain });
    expect(r1.status === 200, 'second rotation should succeed');
    rotatedPlain = cookieValue(rtCookie(r1.res));
    const r2 = await post('auth/security/policy', { token: r1.body.token });
    expect(r2.status === 200 && r2.body.success === true, `rotated token rejected: ${r2.status} ${JSON.stringify(r2.body).slice(0, 120)}`);
  });

  await test('expired refresh token → 401 and its row is cleaned up', async () => {
    const plain = await seedToken({ expiresInMs: -60_000 });
    const r = await post('refreshToken', { cookie: plain });
    expect(r.status === 401, `expired token must 401, got ${r.status}`);
    const { data } = await sb.from('refresh_tokens').select('token_hash').eq('token_hash', sha256(plain)).maybeSingle();
    expect(!data, 'expired row must be deleted');
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  h.section('Auth Session › Logout');

  await test('logout revokes refresh tokens and expires the cookie', async () => {
    expect(rotatedPlain, 'depends on rotation test');
    const { data: u } = await sb.from('app_users').select('id, username, role, department_id').eq('id', userId).single();
    const r = await post('logout', { token: h.mint(u), cookie: rotatedPlain });
    expect(r.status === 200 && r.body.success === true, `logout failed: ${r.status}`);
    const sc = rtCookie(r.res);
    expect(sc && (/max-age=0/i.test(sc) || /expires=/i.test(sc)), 'logout must expire the refresh cookie');
    const { data: rows } = await sb.from('refresh_tokens').select('token_hash').eq('user_id', userId);
    expect((rows ?? []).length === 0, 'all refresh tokens for the user must be revoked');
    // And the revoked cookie can no longer mint tokens
    const after = await post('refreshToken', { cookie: rotatedPlain });
    expect(after.status === 401, 'post-logout refresh must 401');
  });
}
