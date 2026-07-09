/**
 * src/components/auth/SetPasswordPage.tsx
 *
 * Public (pre-auth) invite-accept page for HR Onboarding account provisioning
 * (Phase 6). Opened from the emailed link `/set-password?token=…`. The invitee sets
 * their own password; on success they're sent to the login screen. Rendered standalone
 * by main.tsx BEFORE the app shell/auth flow, so it needs no session.
 *
 * The accept-invite endpoint is PUBLIC — we call it with a plain fetch (no JWT). The
 * request envelope matches apiPost: `{ args: { token, password } }`.
 */

import { useState } from 'preact/hooks';
import type { JSX, VNode } from 'preact';

const wrap: JSX.CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0e2f5d',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif', padding: '24px',
};
const card: JSX.CSSProperties = {
  width: '100%', maxWidth: '420px', background: '#fff', borderRadius: '16px',
  boxShadow: '0 18px 40px rgba(8,24,50,.35)', padding: '32px 28px',
};
const label: JSX.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: '600', color: '#33425f', margin: '14px 0 6px' };
const input: JSX.CSSProperties = {
  width: '100%', height: '44px', border: '1px solid #d9e2ee', borderRadius: '10px',
  padding: '0 13px', fontSize: '14px', color: '#11203b', boxSizing: 'border-box',
};
const btn: JSX.CSSProperties = {
  width: '100%', height: '46px', marginTop: '20px', border: '0', borderRadius: '11px',
  background: '#075fe8', color: '#fff', fontSize: '15px', fontWeight: 500, cursor: 'pointer',
};

export function SetPasswordPage(): VNode {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!token) { setError('This link is missing its token. Ask HR for a new invite.'); return; }
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/hr/onboarding/accept-invite', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: { token, password: pw } }),
      });
      const body = await res.json().catch(() => ({} as { success?: boolean; message?: string }));
      if (!res.ok || !body?.success) {
        setError(body?.message || 'Could not set your password. This link may have expired or already been used.');
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: '20px', fontWeight: '780', color: '#0e2f5d', marginBottom: '4px' }}>Set your password</div>
        {done ? (
          <>
            <p style={{ color: '#33425f', fontSize: '14px', lineHeight: '1.5' }}>
              Your password is set and your account is active. You can now sign in with your work email.
            </p>
            <a href="/" style={{ ...btn, display: 'grid', placeItems: 'center', textDecoration: 'none' }}>Go to sign in</a>
          </>
        ) : !token ? (
          <p style={{ color: '#b42318', fontSize: '14px', lineHeight: '1.5' }}>
            This invite link is invalid or incomplete. Please ask HR to resend your account invite.
          </p>
        ) : (
          <form onSubmit={submit}>
            <p style={{ color: '#52668a', fontSize: '14px', lineHeight: '1.5', margin: '0 0 6px' }}>
              Choose a password to finish setting up your work account.
            </p>
            <label style={label}>New password</label>
            <input style={input} type="password" autocomplete="new-password" value={pw}
              onInput={e => setPw((e.target as HTMLInputElement).value)} placeholder="At least 8 characters" />
            <label style={label}>Confirm password</label>
            <input style={input} type="password" autocomplete="new-password" value={confirm}
              onInput={e => setConfirm((e.target as HTMLInputElement).value)} placeholder="Re-enter your password" />
            {error && <div style={{ color: '#b42318', fontSize: '13px', marginTop: '12px' }}>{error}</div>}
            <button style={{ ...btn, opacity: busy ? '0.7' : '1' }} type="submit" disabled={busy}>
              {busy ? 'Setting password…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
