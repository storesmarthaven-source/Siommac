/**
 * tests/unit/realtimeAuth.test.ts
 *
 * mintRealtimeToken (lib/realtimeAuth.ts) — ES256, SIOMAC-controlled key.
 * Covers: missing/invalid key config → null (polling fallback), and for a
 * valid key: ES256 alg, kid header, claims contract (sub/role/aud/iss) and
 * 55-minute expiry — verified against the matching PUBLIC key, which is
 * exactly what Supabase does with the imported JWK.
 */
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';

const KID = '11111111-2222-4333-8444-555555555555';

function freshImport() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../netlify/functions/lib/realtimeAuth') as
    typeof import('../../netlify/functions/lib/realtimeAuth');
}

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicPem:  publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateB64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
  };
}

describe('mintRealtimeToken (ES256)', () => {
  const OLD_ENV = process.env;
  afterEach(() => { process.env = OLD_ENV; });
  beforeEach(() => { process.env = { ...OLD_ENV }; });

  test('returns null when the private key env is absent', () => {
    delete process.env.SUPABASE_JWT_ES256_PRIVATE_KEY;
    process.env.SUPABASE_JWT_ES256_KID = KID;
    expect(freshImport().mintRealtimeToken('USR-001')).toBeNull();
  });

  test('returns null when the kid env is absent', () => {
    process.env.SUPABASE_JWT_ES256_PRIVATE_KEY = makeKeypair().privateB64;
    delete process.env.SUPABASE_JWT_ES256_KID;
    expect(freshImport().mintRealtimeToken('USR-001')).toBeNull();
  });

  test('returns null when the key is not base64 PKCS8 PEM (no fabricated token)', () => {
    process.env.SUPABASE_JWT_ES256_PRIVATE_KEY = Buffer.from('not a pem at all').toString('base64');
    process.env.SUPABASE_JWT_ES256_KID = KID;
    expect(freshImport().mintRealtimeToken('USR-001')).toBeNull();
  });

  test('returns null for an empty userId', () => {
    process.env.SUPABASE_JWT_ES256_PRIVATE_KEY = makeKeypair().privateB64;
    process.env.SUPABASE_JWT_ES256_KID = KID;
    expect(freshImport().mintRealtimeToken('')).toBeNull();
  });

  test('mints an ES256 token with the kid header that verifies against the PUBLIC key', () => {
    const { publicPem, privateB64 } = makeKeypair();
    process.env.SUPABASE_JWT_ES256_PRIVATE_KEY = privateB64;
    process.env.SUPABASE_JWT_ES256_KID = KID;

    const minted = freshImport().mintRealtimeToken('USR-001');
    expect(minted).not.toBeNull();

    const decoded = jwt.verify(minted!.token, publicPem, { algorithms: ['ES256'] }) as jwt.JwtPayload;
    const header  = jwt.decode(minted!.token, { complete: true })!.header;

    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(KID);
    expect(decoded.sub).toBe('USR-001');          // TEXT app user id, not a UUID
    expect(decoded.role).toBe('authenticated');   // postgres role Realtime adopts
    expect(decoded.aud).toBe('authenticated');
    expect(decoded.iss).toBe('siomac-realtime');
    // 55-minute TTL, matching expiresAt
    expect(decoded.exp! - decoded.iat!).toBe(55 * 60);
    expect(new Date(minted!.expiresAt).getTime()).toBe(decoded.exp! * 1000);
  });

  test('a token signed with a DIFFERENT key fails verification (kid pinning matters)', () => {
    const pairA = makeKeypair();
    const pairB = makeKeypair();
    process.env.SUPABASE_JWT_ES256_PRIVATE_KEY = pairA.privateB64;
    process.env.SUPABASE_JWT_ES256_KID = KID;

    const minted = freshImport().mintRealtimeToken('USR-001');
    expect(minted).not.toBeNull();
    expect(() => jwt.verify(minted!.token, pairB.publicPem, { algorithms: ['ES256'] }))
      .toThrow(/invalid signature/i);
  });
});
