/**
 * tabs/SecurityPolicyTab.tsx
 *
 * Superadmin "Security Policy" editor — a holder of `auth.security.manage_policy`
 * views/updates the organisation-wide security knobs in `auth_security_policy`.
 * Reads from `/api/auth/security/policy`; saves via `/api/admin/security/policy/update`
 * (requires step-up; withStepUp retries). Restyled to the v2 Settings design (.swz).
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

// ── Local form state (mirrors the editable DB columns) ────────────────────────

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

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

// ── v2 row controls ───────────────────────────────────────────────────────────

function ToggleRow({ label, desc, checked, onChange, disabled }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}): VNode {
  return (
    <div class="swz-prow">
      <div class="swz-prow-main">
        <div class="swz-prow-label">{label}</div>
        {desc && <div class="swz-prow-desc">{desc}</div>}
      </div>
      <div class="swz-prow-ctrl">
        <button type="button" role="switch" aria-checked={checked} disabled={disabled}
          class={`switch${checked ? '' : ' off'}`} onClick={() => onChange(!checked)}><span /></button>
      </div>
    </div>
  );
}

function NumberRow({ label, desc, value, min, max, onChange, suffix, disabled }: {
  label: string; desc?: string; value: number; min: number; max: number;
  onChange: (v: number) => void; suffix?: string; disabled?: boolean;
}): VNode {
  return (
    <div class="swz-prow">
      <div class="swz-prow-main">
        <div class="swz-prow-label">{label}</div>
        {desc && <div class="swz-prow-desc">{desc}</div>}
      </div>
      <div class="swz-prow-ctrl">
        <input
          class="input-number" type="number" min={min} max={max} value={value} disabled={disabled}
          onInput={(e) => { const raw = parseInt((e.target as HTMLInputElement).value, 10); if (!isNaN(raw)) onChange(clamp(raw, min, max)); }}
        />
        {suffix && <span class="swz-prow-suffix">{suffix}</span>}
      </div>
    </div>
  );
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

  useEffect(() => {
    if (!policyRes?.success || !policyRes.policy) return;
    const p = policyRes.policy;
    setForm({
      trustedDevicesEnabled:       p.trustedDevicesEnabled,
      trustedDeviceDefaultDays:    p.trustedDeviceTtlByRole['employee'] ?? 30,
      trustedDeviceAdminDays:      p.trustedDeviceTtlByRole['admin'] ?? 14,
      trustedDeviceSuperAdminDays: p.trustedDeviceTtlByRole['superadmin'] ?? 7,
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
      if (!res.success) { toast.error(res.message ?? 'Failed to save security policy.'); return; }
      setDirty(false);
      setSavedAt(new Date());
      toast.success('Security policy saved.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save security policy.');
    }
  }, [form, ensureStepUp, updateMut]);

  if (!canManage) {
    return <div class="swz-empty"><i class="fas fa-lock" /> You don't have permission to manage the security policy.</div>;
  }
  if (isLoading) {
    return <div class="swz-loading"><i class="fas fa-spinner fa-spin" /> Loading security policy…</div>;
  }

  const busy = updateMut.isPending;

  return (
    <div class="swz-form" style={{ maxWidth: '760px' }}>
      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-laptop-mobile" /> Trusted Devices</h3>
        <ToggleRow label="Enable trusted-device bypass" desc="Let users mark a device as trusted to skip 2FA for a limited time."
          checked={form.trustedDevicesEnabled} onChange={v => patch('trustedDevicesEnabled', v)} disabled={busy} />
        <NumberRow label="Employee / default TTL" value={form.trustedDeviceDefaultDays} min={1} max={365} suffix="days"
          onChange={v => patch('trustedDeviceDefaultDays', v)} disabled={busy || !form.trustedDevicesEnabled} />
        <NumberRow label="Admin / manager TTL" value={form.trustedDeviceAdminDays} min={1} max={365} suffix="days"
          onChange={v => patch('trustedDeviceAdminDays', v)} disabled={busy || !form.trustedDevicesEnabled} />
        <NumberRow label="Superadmin TTL" value={form.trustedDeviceSuperAdminDays} min={1} max={365} suffix="days"
          onChange={v => patch('trustedDeviceSuperAdminDays', v)} disabled={busy || !form.trustedDevicesEnabled} />
      </div>

      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-shield-halved" /> MFA Requirements</h3>
        <ToggleRow label="Require MFA for super admin role" checked={form.requireMfaForSuperAdmin} onChange={v => patch('requireMfaForSuperAdmin', v)} disabled={busy} />
        <ToggleRow label="Require MFA for admin role" checked={form.requireMfaForAdmin} onChange={v => patch('requireMfaForAdmin', v)} disabled={busy} />
        <ToggleRow label="Require MFA for manager role" checked={form.requireMfaForManager} onChange={v => patch('requireMfaForManager', v)} disabled={busy} />
      </div>

      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-fingerprint" /> Passkey Policy</h3>
        <ToggleRow label="Allow passwordless passkey login" checked={form.allowPasswordlessPasskey} onChange={v => patch('allowPasswordlessPasskey', v)} disabled={busy} />
        <ToggleRow label="Allow passkey as second factor" checked={form.allowPasskeyAsSecondFactor} onChange={v => patch('allowPasskeyAsSecondFactor', v)} disabled={busy} />
      </div>

      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-user-shield" /> Step-up Authentication</h3>
        <NumberRow label="Step-up verification validity window"
          desc="How long a fresh MFA verification stays valid for sensitive actions (1–60 minutes)."
          value={form.stepUpMaxAgeMinutes} min={1} max={60} suffix="minutes"
          onChange={v => patch('stepUpMaxAgeMinutes', v)} disabled={busy} />
      </div>

      <div class="swz-savebar">
        <button type="button" class="action-btn save" onClick={() => void handleSave()} disabled={busy || !dirty}>
          {busy ? <><i class="fas fa-spinner fa-spin" /> Saving…</> : <><i class="fas fa-floppy-disk" /> Save policy</>}
        </button>
        {!dirty && savedAt && <span class="swz-saved"><i class="fas fa-circle-check" /> Saved {savedAt.toLocaleTimeString()}</span>}
        {dirty && <span class="swz-dirty">Unsaved changes</span>}
      </div>

      <div class="swz-policy-note">
        <i class="fas fa-circle-info" />
        Saving requires a fresh step-up verification. Changes take effect within 30 seconds across all running instances.
      </div>
    </div>
  );
}
