import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoVariables } from '../../../types/api';

vi.mock('../lib/db', () => ({ sb: { from: vi.fn() } }));
vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(), requirePermission: vi.fn(), log_: vi.fn(),
  requireRole: vi.fn(() => Promise.resolve({ id: 'USR-ADMIN', username: 'admin', role: 'admin' })),
}));
vi.mock('../lib/appEvents', () => ({ emitAppEvent: vi.fn(), writePlatformAudit: vi.fn() }));

import router from './uiPrefs';

const app = new Hono<{ Variables: HonoVariables }>();
app.use('*', async (c, next) => { c.set('body', await c.req.json()); await next(); });
app.route('/', router);

function request(configuration: unknown): Request {
  return new Request('http://local/theme/studio/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: { configuration } }),
  });
}

describe('Design System Studio route validation', () => {
  it('validates a governed versioned payload through the authenticated route', async () => {
    const response = await app.request(request({
      schemaVersion: 1,
      theme: { tokens: { '--ui-tab-indicator': '#315d8c' }, savedColors: ['#123456', '#ABCDEF'] },
      recipes: { button: { overrides: { '--ui-button-primary-bg': '#173f6f' } } },
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { validation: { valid: boolean } } };
    expect(body.data.validation.valid).toBe(true);
  });

  it('rejects invalid or oversized custom saved-color palettes', async () => {
    const response = await app.request(request({
      schemaVersion: 1,
      theme: { tokens: {}, savedColors: ['red', ...Array.from({ length: 33 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`)] },
      recipes: { button: { overrides: {} } },
    }));
    const body = await response.json() as { data: { validation: { valid: boolean; errors: string[] } } };
    expect(body.data.validation.valid).toBe(false);
    expect(body.data.validation.errors.join(' ')).toContain('at most 32');
    expect(body.data.validation.errors.join(' ')).toContain('six-digit hex');
  });

  it('returns validation errors for arbitrary CSS without accepting it', async () => {
    const response = await app.request(request({
      schemaVersion: 1,
      theme: { tokens: { '--ui-brand': 'red; position:fixed' } },
      recipes: { button: { overrides: {} } },
    }));
    const body = await response.json() as { data: { validation: { valid: boolean; errors: string[] } } };
    expect(body.data.validation.valid).toBe(false);
    expect(body.data.validation.errors[0]).toContain('invalid token value');
  });
});
