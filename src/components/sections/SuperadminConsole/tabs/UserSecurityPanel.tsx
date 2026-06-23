/**
 * tabs/UserSecurityPanel.tsx
 *
 * Admin cross-user security management tab.
 * Shows TOTP, passkey count, trusted device count per user.
 * Allows admins to revoke all passkeys / trusted devices for a user (step-up required).
 *
 * Gated on: auth.security.view (view), auth.passkeys.admin_revoke (passkey revoke),
 *            auth.trusted_devices.admin_revoke (device revoke).
 */

import { type VNode }       from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { useCan }           from '@lib/permissions';
import { useStepUp, withStepUp } from '@/hooks/useStepUp';
import { toast }            from '@store';
import {
  useAdminUserSecurityStatus,
  useAdminRevokeUserPasskeys,
  useAdminRevokeUserTrustedDevices,
} from '@api/security';
import { confirm }          from '@components/shared/ConfirmDialog';
import { useConsoleUsers }  from '../hooks';

export function UserSecurityPanel(): VNode {
  const canView          = useCan('auth.security.view');
  const canRevokeKeys    = useCan('auth.passkeys.admin_revoke');
  const canRevokeDevices = useCan('auth.trusted_devices.admin_revoke');
  const { ensureStepUp } = useStepUp();

  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const { data: users = [], isLoading: usersLoading } = useConsoleUsers(true);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } =
    useAdminUserSecurityStatus(selectedUserId, canView && !!selectedUserId);

  const revokeKeysMut    = useAdminRevokeUserPasskeys();
  const revokeDevicesMut = useAdminRevokeUserTrustedDevices();

  const handleRevokePasskeys = useCallback(async () => {
    if (!selectedUserId) return;
    const ok = await confirm({
      title:        'Revoke all passkeys',
      message:      'This will delete all registered passkeys for this user. They will need to register new passkeys to use passwordless login.',
      variant:      'danger',
      confirmLabel: 'Revoke passkeys',
    });
    if (!ok) return;
    try {
      const doRevoke = withStepUp(ensureStepUp, () =>
        revokeKeysMut.mutateAsync(selectedUserId)
      );
      const res = await doRevoke();
      if (!res.success && res.code === 'step_up_required') return;
      if (!res.success) { toast.error(res.message ?? 'Failed to revoke passkeys.'); return; }
      toast.success('All passkeys revoked for this user.');
      void refetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke passkeys.');
    }
  }, [selectedUserId, ensureStepUp, revokeKeysMut, refetchStatus]);

  const handleRevokeDevices = useCallback(async () => {
    if (!selectedUserId) return;
    const ok = await confirm({
      title:        'Revoke all trusted devices',
      message:      'This will revoke all trusted devices for this user. They will need to re-verify 2FA on next login from every device.',
      variant:      'danger',
      confirmLabel: 'Revoke devices',
    });
    if (!ok) return;
    try {
      const doRevoke = withStepUp(ensureStepUp, () =>
        revokeDevicesMut.mutateAsync(selectedUserId)
      );
      const res = await doRevoke();
      if (!res.success && res.code === 'step_up_required') return;
      if (!res.success) { toast.error(res.message ?? 'Failed to revoke devices.'); return; }
      toast.success('All trusted devices revoked for this user.');
      void refetchStatus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke trusted devices.');
    }
  }, [selectedUserId, ensureStepUp, revokeDevicesMut, refetchStatus]);

  if (!canView) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i class="fas fa-lock" style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }} />
        You do not have permission to view user security status.
      </div>
    );
  }

  const busy = revokeKeysMut.isPending || revokeDevicesMut.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '680px' }}>
      {/* User picker */}
      <div class="stg-card">
        <div class="stg-card-label">
          <i class="fas fa-user-shield" />
          <span>Select user to inspect</span>
        </div>
        <div style={{ marginTop: '12px' }}>
          {usersLoading ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              <i class="fas fa-spinner fa-spin" style={{ marginRight: 6 }} />Loading users…
            </div>
          ) : (
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId((e.target as HTMLSelectElement).value)}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--border, #d1d5db)',
                borderRadius: '6px', fontSize: '14px', background: '#fff',
                color: 'var(--text-primary, #111)',
              }}
            >
              <option value="">— Choose a user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName || u.username} ({u.role})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Security status */}
      {selectedUserId && (
        <div class="totp-card">
          <div class="totp-card-header">
            <div class="totp-card-icon"><i class="fas fa-shield-halved" /></div>
            <div class="totp-card-info">
              <div class="totp-card-title">Security posture</div>
              <div class="totp-card-desc">Current authentication factors for this user.</div>
            </div>
            {status?.mfaMandatory && (
              <div class="totp-badge totp-badge--on" style={{ fontSize: '0.72rem' }}>
                MFA required
              </div>
            )}
          </div>

          {statusLoading && (
            <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>
          )}

          {!statusLoading && status?.success && (
            <>
              <div style={{ display: 'flex', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
                {/* TOTP */}
                <div style={{
                  flex: '1 1 140px', padding: '12px 16px',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Authenticator
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i class={`fas ${status.totpEnabled ? 'fa-circle-check' : 'fa-circle-xmark'}`}
                       style={{ color: status.totpEnabled ? '#16a34a' : '#9ca3af', fontSize: '14px' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {status.totpEnabled ? 'Enabled' : 'Not set up'}
                    </span>
                  </div>
                </div>

                {/* Passkeys */}
                <div style={{
                  flex: '1 1 140px', padding: '12px 16px',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Passkeys
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i class={`fas ${status.passkeyCount > 0 ? 'fa-fingerprint' : 'fa-circle-xmark'}`}
                       style={{ color: status.passkeyCount > 0 ? '#2563eb' : '#9ca3af', fontSize: '14px' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {status.passkeyCount} registered
                    </span>
                  </div>
                </div>

                {/* Trusted devices */}
                <div style={{
                  flex: '1 1 140px', padding: '12px 16px',
                  background: 'var(--bg-secondary, #f9fafb)',
                  borderRadius: '8px', border: '1px solid var(--border, #e5e7eb)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                    Trusted devices
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i class={`fas ${status.trustedDeviceCount > 0 ? 'fa-laptop-mobile' : 'fa-circle-xmark'}`}
                       style={{ color: status.trustedDeviceCount > 0 ? '#d97706' : '#9ca3af', fontSize: '14px' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                      {status.trustedDeviceCount} active
                    </span>
                  </div>
                </div>
              </div>

              {/* Admin actions */}
              {(canRevokeKeys || canRevokeDevices) && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {canRevokeKeys && (
                    <button
                      type="button"
                      class="stg-btn-outline"
                      style={{ color: 'var(--danger, #ef4444)', borderColor: 'var(--danger, #ef4444)', fontSize: '13px' }}
                      onClick={() => void handleRevokePasskeys()}
                      disabled={busy || status.passkeyCount === 0}
                      title={status.passkeyCount === 0 ? 'No passkeys to revoke' : undefined}
                    >
                      {revokeKeysMut.isPending
                        ? <><i class="fas fa-spinner fa-spin" /> Revoking…</>
                        : <><i class="fas fa-trash-can" /> Revoke all passkeys</>
                      }
                    </button>
                  )}
                  {canRevokeDevices && (
                    <button
                      type="button"
                      class="stg-btn-outline"
                      style={{ color: 'var(--danger, #ef4444)', borderColor: 'var(--danger, #ef4444)', fontSize: '13px' }}
                      onClick={() => void handleRevokeDevices()}
                      disabled={busy || status.trustedDeviceCount === 0}
                      title={status.trustedDeviceCount === 0 ? 'No trusted devices to revoke' : undefined}
                    >
                      {revokeDevicesMut.isPending
                        ? <><i class="fas fa-spinner fa-spin" /> Revoking…</>
                        : <><i class="fas fa-ban" /> Revoke all trusted devices</>
                      }
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {!statusLoading && status && !status.success && (
            <div style={{ marginTop: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              <i class="fas fa-circle-exclamation" style={{ marginRight: 6, color: '#dc2626' }} />
              {status.message ?? 'Failed to load security status.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
