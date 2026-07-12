/**
 * tabs/SecurityPolicyTab.tsx
 *
 * Superadmin "Security Policy" editor — allows a holder of
 * `auth.security.manage_policy` to view and update the organisation-wide
 * security knobs stored in `auth_security_policy`.
 *
 * All fields come from the DB-backed `/api/auth/security/policy` read route.
 * Saves go through `/api/admin/security/policy/update`, which requires step-up.
 * `withStepUp()` intercepts the step_up_required code and retries automatically.
 *
 * Gated: if the user lacks `auth.security.manage_policy`, the tab renders a
 * permission-denied notice (the tab still appears in the nav, consistent with
 * how UserSecurityPanel handles `auth.security.view`).
 */

import { type VNode }       from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useCan }           from '@lib/permissions';
import { useStepUp, withStepUp } from '@/hooks/useStepUp';
import { toast }            from '@store';
import {
  useSecurityPolicy,
  useUpdateSecurityPolicy,
  type SecurityPolicyUpdatePayload,
} from '@api/security';

// ── Local form state (mirrors the DB columns we can edit) ─────────────────────

interface PolicyForm {
  trustedDevicesEnabled:       boolean;
  trustedDeviceDefaultDays:    number;
  trustedDeviceAdminDays:      number;
  trustedDeviceSuperAdminDays: number;
  requireMfaForSuperAdmin:     boolean;
  requireMfaForAdmin:          boolean;
  requireMfaForManager:        boolean;
  allowPasswordlessPasskey:    boolean;
  allowPasskeyAsSecondFactor:  boolean;
  stepUpMaxAgeMinutes:         number;
}

const DEFAULT_FORM: PolicyForm = {
  trustedDevicesEnabled:       true,
  trustedDeviceDefaultDays:    30,
  trustedDeviceAdminDays:      14,
  trustedDeviceSuperAdminDays: 7,
  requireMfaForSuperAdmin:     true,
  requireMfaForAdmin:          true,
  requireMfaForManager:        true,
  allowPasswordlessPasskey:    true,
  allowPasskeyAsSecondFactor:  true,
  stepUpMaxAgeMinutes:         10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  label, checked, onChange, disabled,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}): VNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
      <span style={{ fontSize: '13px', color: 'var(--text-primary, #111)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center',
          width: '40px', height: '22px', borderRadius: '11px', border: 'none',
          padding: 0, cursor: disabled ? 'not-allowed' : 'pointer',
          background: checked ? 'var(--siomac-navy, #1e3a5f)' : '#d1d5db',
          transition: 'background 0.15s',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute',
          left: checked ? '20px' : '2px',
          width: '18px', height: '18px', borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.15s',
        }} />
      </button>
    </div>
  );
}

function NumberInput({
  label, value, min, max, onChange, suffix, disabled,
}: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; suffix?: string; disabled?: boolean;
}): VNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
      <span style={{ fontSize: '13px', color: 'var(--text-primary, #111)', flex: 1 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onInput={(e) => {
            const raw = parseInt((e.target as HTMLInputElement).value, 10);
            if (!isNaN(raw)) onChange(clamp(raw, min, max));
          }}
          style={{
            width: '72px', padding: '5px 8px', textAlign: 'right',
            border: '1px solid var(--border, #d1d5db)', borderRadius: '6px',
            fontSize: '13px', background: disabled ? '#f9fafb' : '#fff',
            color: 'var(--text-primary, #111)',
          }}
        />
        {suffix && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Divider(): VNode {
  return <div style={{ height: '1px', background: 'var(--border, #e5e7eb)', margin: '4px 0' }} />;
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SecurityPolicyTab(): VNode {
  const canManage = useCan('auth.security.manage_policy');
  const { ensureStepUp } = useStepUp();

  const { data: policyRes, isLoading } = useSecurityPolicy(canManage);
  const updateMut = useUpdateSecurityPolicy();

  const [form, setForm] = useState<PolicyForm>(DEFAULT_FORM);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Sync form when the server data loads
  useEffect(() => {
    if (!policyRes?.success || !policyRes.policy) return;
    const p = policyRes.policy;
    setForm({
      trustedDevicesEnabled:       p.trustedDevicesEnabled,
      trustedDeviceDefaultDays:    p.trustedDeviceTtlByRole.employee ?? 30,
      trustedDeviceAdminDays:      p.trustedDeviceTtlByRole.admin ?? 14,
      trustedDeviceSuperAdminDays: p.trustedDeviceTtlByRole.superadmin ?? 7,
      requireMfaForSuperAdmin:     p.requireMfaRoles.includes('superadmin'),
      requireMfaForAdmin:          p.requireMfaRoles.includes('admin'),
      requireMfaForManager:        p.requireMfaRoles.includes('manager'),
      allowPasswordlessPasskey:    p.allowPasswordlessPasskey,
      allowPasskeyAsSecondFactor:  p.allowPasskeyAsSecondFactor,
      stepUpMaxAgeMinutes:         p.stepUpMaxAgeMinutes,
    });
    setDirty(false);
  }, [policyRes]);

  const patch = useCallback(<K extends keyof PolicyForm>(key: K, val: PolicyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    const payload: SecurityPolicyUpdatePayload = {
      trustedDevicesEnabled:       form.trustedDevicesEnabled,
      trustedDeviceDefaultDays:    form.trustedDeviceDefaultDays,
      trustedDeviceAdminDays:      form.trustedDeviceAdminDays,
      trustedDeviceSuperAdminDays: form.trustedDeviceSuperAdminDays,
      requireMfaForSuperAdmin:     form.requireMfaForSuperAdmin,
      requireMfaForAdmin:          form.requireMfaForAdmin,
      requireMfaForManager:        form.requireMfaForManager,
      allowPasswordlessPasskey:    form.allowPasswordlessPasskey,
      allowPasskeyAsSecondFactor:  form.allowPasskeyAsSecondFactor,
      stepUpMaxAgeMinutes:         form.stepUpMaxAgeMinutes,
    };

    try {
      const doUpdate = withStepUp(ensureStepUp, () => updateMut.mutateAsync(payload));
      const res = await doUpdate();
      if (!res.success && res.code === 'step_up_required') return; // user cancelled
      if (!res.success) {
        toast.error(res.message ?? 'Failed to save security policy.');
        return;
      }
      setDirty(false);
      setSavedAt(new Date());
      toast.success('Security policy saved.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save security policy.');
    }
  }, [form, ensureStepUp, updateMut]);

  // ── Not authorized ─────────────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i class="fas fa-lock" style={{ fontSize: '24px', marginBottom: '8px', display: 'block' }} />
        You do not have permission to manage the security policy.
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i class="fas fa-spinner fa-spin" style={{ marginRight: 8 }} />
        Loading security policy…
      </div>
    );
  }

  const busy = updateMut.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px' }}>

      {/* ── Trusted-device settings ──────────────────────────────────────── */}
      <div class="stg-card">
        <div class="stg-card-label">
          <i class="fas fa-laptop-mobile" />
          <span>Trusted Devices</span>
        </div>

        <Toggle
          label="Enable trusted-device bypass (remember this device)"
          checked={form.trustedDevicesEnabled}
          onChange={v => patch('trustedDevicesEnabled', v)}
          disabled={busy}
        />
        <Divider />
        <NumberInput
          label="Employee / default TTL"
          value={form.trustedDeviceDefaultDays}
          min={1} max={365}
          suffix="days"
          onChange={v => patch('trustedDeviceDefaultDays', v)}
          disabled={busy || !form.trustedDevicesEnabled}
        />
        <Divider />
        <NumberInput
          label="Admin / manager TTL"
          value={form.trustedDeviceAdminDays}
          min={1} max={365}
          suffix="days"
          onChange={v => patch('trustedDeviceAdminDays', v)}
          disabled={busy || !form.trustedDevicesEnabled}
        />
        <Divider />
        <NumberInput
          label="Superadmin TTL"
          value={form.trustedDeviceSuperAdminDays}
          min={1} max={365}
          suffix="days"
          onChange={v => patch('trustedDeviceSuperAdminDays', v)}
          disabled={busy || !form.trustedDevicesEnabled}
        />
      </div>

      {/* ── MFA requirements ─────────────────────────────────────────────── */}
      <div class="stg-card">
        <div class="stg-card-label">
          <i class="fas fa-shield-halved" />
          <span>MFA Requirements</span>
        </div>

        <Toggle
          label="Require MFA for super admin role"
          checked={form.requireMfaForSuperAdmin}
          onChange={v => patch('requireMfaForSuperAdmin', v)}
          disabled={busy}
        />
        <Divider />
        <Toggle
          label="Require MFA for admin role"
          checked={form.requireMfaForAdmin}
          onChange={v => patch('requireMfaForAdmin', v)}
          disabled={busy}
        />
        <Divider />
        <Toggle
          label="Require MFA for manager role"
          checked={form.requireMfaForManager}
          onChange={v => patch('requireMfaForManager', v)}
          disabled={busy}
        />
      </div>

      {/* ── Passkey settings ─────────────────────────────────────────────── */}
      <div class="stg-card">
        <div class="stg-card-label">
          <i class="fas fa-fingerprint" />
          <span>Passkey Policy</span>
        </div>

        <Toggle
          label="Allow passwordless passkey login"
          checked={form.allowPasswordlessPasskey}
          onChange={v => patch('allowPasswordlessPasskey', v)}
          disabled={busy}
        />
        <Divider />
        <Toggle
          label="Allow passkey as second factor"
          checked={form.allowPasskeyAsSecondFactor}
          onChange={v => patch('allowPasskeyAsSecondFactor', v)}
          disabled={busy}
        />
      </div>

      {/* ── Step-up settings ─────────────────────────────────────────────── */}
      <div class="stg-card">
        <div class="stg-card-label">
          <i class="fas fa-user-shield" />
          <span>Step-up Authentication</span>
        </div>

        <NumberInput
          label="Step-up verification validity window"
          value={form.stepUpMaxAgeMinutes}
          min={1} max={60}
          suffix="minutes"
          onChange={v => patch('stepUpMaxAgeMinutes', v)}
          disabled={busy}
        />
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          How long a fresh MFA verification remains valid for sensitive actions (1–60 minutes).
        </div>
      </div>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          class="stg-btn-primary"
          onClick={() => void handleSave()}
          disabled={busy || !dirty}
          style={{
            opacity: busy || !dirty ? 0.55 : 1,
            cursor:  busy || !dirty ? 'not-allowed' : 'pointer',
          }}
        >
          {busy
            ? <><i class="fas fa-spinner fa-spin" style={{ marginRight: 6 }} />Saving…</>
            : <><i class="fas fa-floppy-disk" style={{ marginRight: 6 }} />Save policy</>
          }
        </button>

        {!dirty && savedAt && (
          <span style={{ fontSize: '12px', color: '#16a34a' }}>
            <i class="fas fa-circle-check" style={{ marginRight: 5 }} />
            Saved {savedAt.toLocaleTimeString()}
          </span>
        )}

        {dirty && (
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Unsaved changes
          </span>
        )}
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '4px 0 8px' }}>
        <i class="fas fa-circle-info" style={{ marginRight: 5 }} />
        Saving requires a fresh step-up verification. Changes take effect within 30 seconds across all running instances.
      </div>
    </div>
  );
}
