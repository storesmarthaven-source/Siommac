/**
 * src/components/sections/Settings/SettingsSection.tsx
 *
 * Admin branding + payroll-rule settings, plus per-user appearance/layout prefs.
 * Section id: s-settings
 * Replaces settings-view.js.
 *
 * Admin-only panels: Company & Branding, Attendance Rules.
 * All-roles panels: Appearance, Layout & Navigation, Notifications, Security.
 *
 * Reskinned to use the branded `.stg-*` design-system classes defined in
 * assets/styles/settings.css instead of ad-hoc inline styles. All logic,
 * state, mutations, validation, handlers and conditional rendering are
 * unchanged — only presentation moved to branded classes.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode, type ComponentType } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { toast }           from '@store';
import { dialog }          from '@lib/dialog';
import { openActionModal, toActionRecord } from '@/components/common/actions';
import {
  fetchSettings,
  updateSetting,
  uploadLogoApi,
  fetchSessionTimeouts,
  setSessionTimeout,
  SESSION_TIMEOUT_DEFAULTS,
  type AppSettings,
  type TimeoutRole,
} from './api';
import { applyCompanyNameToDom, applyCompanyLogoToDom } from './domSync';
import { ManifestReviewPanel } from './ManifestReviewPanel';
import { SwzCatalogPage } from './SwzCatalogPage';
import { SwzIcon } from './swzIcons';
import { getSwzPage, buildSettingsMenuHtml, type SwzPage } from './settingsNav';
import { showSection, buildSidebar } from '@/components/nav/navCore';
// RBAC tabs (Roles / Modules / Permissions / Approvals / Sessions / Audit Log) moved
// to the top-level Access Control section. Only the non-RBAC security tools remain here.
import { UserSecurityPanel } from '@/components/sections/SuperadminConsole/tabs/UserSecurityPanel';
import { SecurityPolicyTab } from '@/components/sections/SuperadminConsole/tabs/SecurityPolicyTab';
import { UIKitPage }         from '@ui/examples/UIKitPage';
import { useStepUp, withStepUp } from '@/hooks/useStepUp';
import {
  useTotpStatus,
  useStartTotpSetup,
  useConfirmTotp,
  useDisableTotp,
  useRegenerateBackupCodes,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
  useDeletePasskey,
  useTrustedDevices,
  useRevokeTrustedDevice,
  useRevokeAllTrustedDevices,
  type PasskeyCredential,
  type TrustedDevice,
} from '@api/security';

// Settings navigation model lives in ./settingsNav.ts (consumed by the shell).

// ── Shared presentational helpers ──────────────────────────────────────────────

function CardLabel({ icon, text }: { icon: string; text: string }): VNode {
  return (
    <div class="stg-card-label">
      <i class={`fas ${icon}`} />
      {text}
    </div>
  );
}

// (Colour-theme + layout-mode pickers removed — Appearance lives in My Preferences;
//  Layout & Navigation and Attendance Rules are placeholders pending reimplementation.)

// ── Company & Branding panel ──────────────────────────────────────────────────

interface BrandingPanelProps {
  settings:    AppSettings;
  onSaved:     (name: string, logoUrl: string) => void;
}

function BrandingPanel({ settings, onSaved }: BrandingPanelProps): VNode {
  const [name,  setName]  = useState(settings.companyName);
  const [addr,  setAddr]  = useState(settings.companyAddress);
  const [phone, setPhone] = useState(settings.companyPhone);
  const [email, setEmail] = useState(settings.companyEmail);
  const [nis,   setNis]   = useState(settings.companyNIS);
  const [bir,   setBir]   = useState(settings.companyBIR);
  const [saving, setSaving] = useState(false);

  const [logoB64,       setLogoB64]       = useState('');
  const [logoFileName,  setLogoFileName]  = useState('');
  const [logoPreview,   setLogoPreview]   = useState(settings.companyLogoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(settings.companyName); setAddr(settings.companyAddress); setPhone(settings.companyPhone);
    setEmail(settings.companyEmail); setNis(settings.companyNIS); setBir(settings.companyBIR);
    setLogoPreview(settings.companyLogoUrl);
  }, [settings]);

  const handleLogoFile = useCallback((e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const b64 = ev.target?.result as string; setLogoB64(b64); setLogoPreview(b64); setLogoFileName(file.name); };
    reader.readAsDataURL(file);
  }, []);

  const handleSaveLogo = useCallback(async () => {
    if (!logoB64) return;
    setUploadingLogo(true);
    try {
      const url = await uploadLogoApi(logoB64);
      setLogoPreview(url); setLogoB64(''); setLogoFileName('');
      applyCompanyLogoToDom(url); onSaved(name, url);
      toast.success('Logo updated — login screen and sidebar now show the new logo.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploadingLogo(false); }
  }, [logoB64, name, onSaved]);

  const handleSaveInfo = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateSetting('companyName',    name.trim() || 'My Company'),
        updateSetting('companyAddress', addr),
        updateSetting('companyPhone',   phone),
        updateSetting('companyEmail',   email),
        updateSetting('companyNIS',     nis),
        updateSetting('companyBIR',     bir),
      ]);
      applyCompanyNameToDom(name.trim() || 'My Company');
      onSaved(name.trim() || 'My Company', logoPreview);
      toast.success('Company settings saved.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }, [name, addr, phone, email, nis, bir, logoPreview, onSaved]);

  const field = (label: string, value: string, set: (v: string) => void, type = 'text', max = 80, ph = '', hint = '') => (
    <div class="swz-field">
      <label>{label}</label>
      <input type={type} value={value} maxLength={max} placeholder={ph} onInput={e => set((e.target as HTMLInputElement).value)} />
      {hint && <small>{hint}</small>}
    </div>
  );

  return (
    <div class="swz-form">
      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-id-card" /> Company Information</h3>
        <div class="swz-grid2">
          {field('Company Name', name, setName, 'text', 80, 'My Company', 'Shown in the sidebar, About, payroll documents and leave applications')}
          {field('Address', addr, setAddr, 'text', 160, 'e.g. #64-70 Lady Hailes Avenue, San Fernando')}
          {field('Phone', phone, setPhone, 'text', 40, 'e.g. 657-2457')}
          {field('Email', email, setEmail, 'email', 100, 'e.g. info@company.tt')}
          {field('NIS Registration No.', nis, setNis, 'text', 40, 'e.g. 1234567')}
          {field('BIR File No.', bir, setBir, 'text', 40, 'e.g. 100123456')}
        </div>
        <div class="swz-form-actions">
          <button type="button" class="action-btn save" disabled={saving} onClick={() => void handleSaveInfo()}>
            <i class={saving ? 'fas fa-spinner fa-spin' : 'fas fa-check'} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" class="action-btn" disabled={saving}
            onClick={() => { setName('My Company'); setAddr(''); setPhone(''); setEmail(''); setNis(''); setBir(''); toast.info('Fields reset — click Save changes to apply.'); }}>
            <i class="fas fa-rotate-left" /> Reset
          </button>
        </div>
      </div>

      <div class="swz-card">
        <h3 class="swz-card-title"><i class="fas fa-image" /> Logo &amp; Branding</h3>
        <div class="swz-logo-row">
          <div class="swz-logo-preview">
            {logoPreview ? <img src={logoPreview} alt="Company logo" /> : <i class="fas fa-image" />}
          </div>
          <div class="swz-logo-ctrls">
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} />
            <div class="swz-form-actions" style={{ marginTop: 0 }}>
              <button type="button" class="action-btn" onClick={() => fileRef.current?.click()}><i class="fas fa-upload" /> Choose logo</button>
              <button type="button" class="action-btn save" disabled={!logoB64 || uploadingLogo} onClick={() => void handleSaveLogo()}>
                <i class={uploadingLogo ? 'fas fa-spinner fa-spin' : 'fas fa-check'} /> {uploadingLogo ? 'Uploading…' : 'Save logo'}
              </button>
            </div>
            {logoFileName && <p class="swz-logo-file">{logoFileName}</p>}
            <p class="swz-logo-hint">PNG or JPG, up to 2 MB. Applies to the login screen, sidebar, and About page. Currency (TT) and timezone are managed under <b>System</b> settings.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Attendance Rules + Appearance + Layout panels removed — Layout & Navigation and
// Attendance Rules are placeholders pending reimplementation (see settingsNav.ts).

// (Per-type in-app Notification Preferences are folded into My Preferences in the
//  v2 design; the standalone NotificationsPanel was removed with the old shell.)

// ── Trusted Devices card ──────────────────────────────────────────────────────

function TrustedDevicesCard(): VNode {
  const { data: devices = [], isLoading, refetch } = useTrustedDevices();
  const revokeMut    = useRevokeTrustedDevice();
  const revokeAllMut = useRevokeAllTrustedDevices();
  const { ensureStepUp } = useStepUp();

  const handleRevoke = useCallback(async (device: TrustedDevice) => {
    const name = device.label || `${device.browserName ?? 'Device'} on ${device.osName ?? 'Unknown OS'}`;
    const res = await openActionModal({
      title: 'Remove trusted device', subtitle: name, icon: 'fa-laptop-mobile', tone: 'danger',
      record: toActionRecord({
        title: name, subtitle: 'Trusted device', icon: 'fa-laptop-mobile',
        fields: [
          device.browserName ? { label: 'Browser', value: device.browserName } : null,
          device.osName ? { label: 'OS', value: device.osName } : null,
        ],
      }),
      warning: 'This device will lose its trusted status.',
      whatNext: ['Two-factor verification will be required again the next time you sign in from that device.'],
      confirmLabel: 'Remove device',
    });
    if (!res.confirmed) return;
    try {
      await revokeMut.mutateAsync(device.id);
      toast.success('Trusted device removed.');
      void refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove device.');
    }
  }, [revokeMut, refetch]);

  const handleRevokeAll = useCallback(async () => {
    const res = await openActionModal({
      title: 'Revoke all trusted devices', icon: 'fa-laptop-mobile', tone: 'danger',
      warning: 'Every trusted device — including this one — will lose its trusted status.',
      whatNext: ['Two-factor verification will be required on the next sign-in from all devices.'],
      confirmLabel: 'Revoke all',
    });
    if (!res.confirmed) return;
    try {
      const doRevoke = withStepUp(ensureStepUp, () => revokeAllMut.mutateAsync());
      const res = await doRevoke();
      if (!res.success && res.code === 'step_up_required') return; // user cancelled
      toast.success('All trusted devices revoked.');
      void refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke all devices.');
    }
  }, [revokeAllMut, ensureStepUp, refetch]);

  return (
    <div class="totp-card">
      <div class="totp-card-header">
        <div class="totp-card-icon"><i class="fas fa-laptop-mobile" /></div>
        <div class="totp-card-info">
          <div class="totp-card-title">Trusted Devices</div>
          <div class="totp-card-desc">
            Devices that can skip two-factor verification for a limited time.
          </div>
        </div>
        {!isLoading && (
          <div class={`totp-badge ${devices.length > 0 ? 'totp-badge--on' : 'totp-badge--off'}`}>
            {devices.length > 0 ? `${devices.length} trusted` : 'None'}
          </div>
        )}
      </div>

      {isLoading && (
        <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>
      )}

      {!isLoading && devices.length === 0 && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '10px', fontStyle: 'italic' }}>
          No trusted devices. Check "Trust this device" after 2FA to add one.
        </div>
      )}

      {!isLoading && devices.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {devices.map((device) => {
            const untilDate    = new Date(device.trustedUntil).toLocaleDateString();
            const lastUsed     = device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleDateString() : null;
            const displayLabel = device.label || [device.browserName, device.osName].filter(Boolean).join(' on ') || 'Unknown device';
            const subLine      = [device.browserName, device.osName].filter(Boolean).join(' · ');
            return (
              <div
                key={device.id}
                class="totp-enrolled-meta"
                style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{displayLabel}</span>
                    {device.currentDevice && (
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 'var(--font-weight-bold)', padding: '1px 7px',
                        background: 'var(--accent,#2563eb)', color: '#fff',
                        borderRadius: '20px', letterSpacing: '0.02em',
                      }}>
                        This device
                      </span>
                    )}
                  </div>
                  {subLine && (
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                      {subLine}
                    </div>
                  )}
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span><i class="fas fa-calendar-check" style={{ marginRight: 3 }} />Trusted until {untilDate}</span>
                    {lastUsed && <span><i class="fas fa-clock" style={{ marginRight: 3 }} />Last used {lastUsed}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  class="stg-btn-outline"
                  style={{ padding: '3px 10px', fontSize: '0.78rem', flexShrink: 0, color: 'var(--danger,#ef4444)', borderColor: 'var(--danger,#ef4444)' }}
                  onClick={() => void handleRevoke(device)}
                  disabled={revokeMut.isPending || revokeAllMut.isPending}
                >
                  <i class="fas fa-trash-can" /> Revoke
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && devices.length > 0 && (
        <div class="totp-card-actions" style={{ marginTop: '14px' }}>
          <button
            type="button"
            class="stg-btn-outline"
            style={{ color: 'var(--danger,#ef4444)', borderColor: 'var(--danger,#ef4444)' }}
            onClick={() => void handleRevokeAll()}
            disabled={revokeAllMut.isPending || revokeMut.isPending}
          >
            {revokeAllMut.isPending
              ? <><i class="fas fa-spinner fa-spin" /> Revoking…</>
              : <><i class="fas fa-ban" /> Revoke all trusted devices</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ── Security panel ────────────────────────────────────────────────────────────

// Idle-timeout options offered in the dropdowns (minutes).
const TIMEOUT_OPTIONS: { value: number; label: string }[] = [
  { value: 15,   label: '15 minutes' },
  { value: 30,   label: '30 minutes' },
  { value: 60,   label: '1 hour' },
  { value: 120,  label: '2 hours' },
  { value: 240,  label: '4 hours' },
  { value: 480,  label: '8 hours' },
  { value: 720,  label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

const TIMEOUT_ROLE_LABEL: Record<TimeoutRole, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

/** Per-role idle-timeout configuration. Superadmin can edit; others see read-only. */
function SessionTimeoutCard({ canEdit }: { canEdit: boolean }): VNode {
  const [timeouts, setTimeouts] = useState<Record<TimeoutRole, number> | null>(null);
  const [saving, setSaving]     = useState<TimeoutRole | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSessionTimeouts()
      .then(t => { if (alive) setTimeouts(t); })
      .catch(() => { if (alive) setTimeouts(SESSION_TIMEOUT_DEFAULTS); });
    return () => { alive = false; };
  }, []);

  const handleChange = useCallback(async (role: TimeoutRole, minutes: number) => {
    setTimeouts(prev => prev ? { ...prev, [role]: minutes } : prev);
    setSaving(role);
    try {
      await setSessionTimeout(role, minutes);
      toast.success(`${TIMEOUT_ROLE_LABEL[role]} session timeout set to ${minutes} min.`);
    } catch {
      toast.error('Failed to save timeout. Try again.');
    } finally {
      setSaving(null);
    }
  }, []);

  return (
    <div class="stg-card">
      <CardLabel icon="fa-clock" text="Session Timeout (by role)" />
      <p class="stg-switch-desc" style={{ marginBottom: '14px' }}>
        Users are signed out after this much inactivity. Higher-privilege roles should
        use shorter windows. {canEdit ? 'Changes apply at each user’s next login.' : 'Only a superadmin can change these.'}
      </p>
      {!timeouts ? (
        <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>
      ) : (
        (Object.keys(TIMEOUT_ROLE_LABEL) as TimeoutRole[]).map(role => (
          <div key={role} class="stg-form-row">
            <div class="stg-form-group">
              <label>{TIMEOUT_ROLE_LABEL[role]}</label>
              <select
                value={String(timeouts[role])}
                disabled={!canEdit || saving === role}
                class={canEdit ? '' : 'stg-readonly'}
                onChange={e => void handleChange(role, Number((e.target as HTMLSelectElement).value))}
              >
                {/* Ensure the current value is selectable even if non-standard. */}
                {!TIMEOUT_OPTIONS.some(o => o.value === timeouts[role]) && (
                  <option value={String(timeouts[role])}>{timeouts[role]} minutes</option>
                )}
                {TIMEOUT_OPTIONS.map(o => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
              </select>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── TOTP setup modal ──────────────────────────────────────────────────────────

/** Step 1 → 2 → 3 flow within the setup modal */
type SetupStep = 'qr' | 'confirm' | 'codes';

interface TotpSetupModalProps {
  onClose:   () => void;
  onEnabled: () => void;
}

export function TotpSetupModal({ onClose, onEnabled }: TotpSetupModalProps): VNode {
  const [step,        setStep]        = useState<SetupStep>('qr');
  const [qrDataUrl,   setQrDataUrl]   = useState('');
  const [secret,      setSecret]      = useState('');
  const [otpauthUrl,  setOtpauthUrl]  = useState('');
  const [code,        setCode]        = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied,      setCopied]      = useState(false);
  const [error,       setError]       = useState('');

  const startSetup  = useStartTotpSetup();
  const confirmTotp = useConfirmTotp();

  // Kick off secret generation on mount
  useEffect(() => {
    startSetup.mutate(undefined, {
      onSuccess: res => {
        if (res.success) {
          setQrDataUrl(res.qrDataUrl);
          setSecret(res.secret);
          setOtpauthUrl(res.otpauthUrl);
        } else {
          setError('Failed to start setup. Please try again.');
        }
      },
      onError: () => setError('Network error. Please try again.'),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = useCallback(() => {
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    confirmTotp.mutate(code, {
      onSuccess: res => {
        if (res.success) {
          setBackupCodes(res.backupCodes);
          setStep('codes');
          onEnabled();
        } else {
          setError('Invalid code. Make sure your authenticator app is synced.');
        }
      },
      onError: () => setError('Verification failed. Please try again.'),
    });
  }, [code, confirmTotp, onEnabled]);

  const handleCopyCodes = useCallback(() => {
    void navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [backupCodes]);

  const handleDownloadCodes = useCallback(() => {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'siomac-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [backupCodes]);

  return (
    <div class="totp-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="totp-modal">
        <div class="totp-modal-header">
          <div class="totp-modal-title">
            <i class="fas fa-shield-halved" style={{ color: 'var(--siomac-navy, #1B2D55)', marginRight: 8 }} />
            Set Up Authenticator App
          </div>
          <button type="button" class="totp-modal-close" onClick={onClose} aria-label="Close">
            <i class="fas fa-xmark" />
          </button>
        </div>

        {/* Step: QR code */}
        {step === 'qr' && (
          <div class="totp-modal-body">
            {startSetup.isPending ? (
              <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Generating secret…</div>
            ) : error ? (
              <div class="totp-error"><i class="fas fa-circle-exclamation" /> {error}</div>
            ) : (
              <>
                <p class="totp-step-desc">
                  Scan this QR code with your authenticator app (Google Authenticator,
                  Authy, 1Password, etc.) or enter the key manually.
                </p>
                {qrDataUrl && (
                  <div class="totp-qr-wrap">
                    <img src={qrDataUrl} alt="TOTP QR code" class="totp-qr-img" />
                  </div>
                )}
                <div class="totp-manual-wrap">
                  <div class="totp-manual-label">Manual entry key</div>
                  <div class="totp-manual-code">{secret}</div>
                  <div class="totp-manual-hint">
                    Can't scan? Open your app, choose "Enter a setup key", and type the key above.
                  </div>
                </div>
              </>
            )}
            <div class="totp-modal-footer">
              <button type="button" class="stg-btn-outline" onClick={onClose}>Cancel</button>
              <button
                type="button"
                class="stg-btn-save"
                disabled={!qrDataUrl || startSetup.isPending}
                onClick={() => { setStep('confirm'); setCode(''); setError(''); }}
              >
                Next — Enter Code <i class="fas fa-arrow-right" />
              </button>
            </div>
          </div>
        )}

        {/* Step: confirm code */}
        {step === 'confirm' && (
          <div class="totp-modal-body">
            <p class="totp-step-desc">
              Open your authenticator app and enter the 6-digit code for Siomac.
            </p>
            <div class="stg-form-group" style={{ maxWidth: 220 }}>
              <label>Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onInput={e => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                class="totp-code-input"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              />
            </div>
            {error && <div class="totp-error"><i class="fas fa-circle-exclamation" /> {error}</div>}
            <div class="totp-modal-footer">
              <button type="button" class="stg-btn-outline" onClick={() => { setStep('qr'); setError(''); }}>Back</button>
              <button
                type="button"
                class="stg-btn-save"
                disabled={code.length !== 6 || confirmTotp.isPending}
                onClick={handleConfirm}
              >
                {confirmTotp.isPending ? <><i class="fas fa-spinner fa-spin" /> Verifying…</> : 'Enable 2FA'}
              </button>
            </div>
          </div>
        )}

        {/* Step: backup codes */}
        {step === 'codes' && (
          <div class="totp-modal-body">
            <div class="totp-success-banner">
              <i class="fas fa-circle-check" /> Authenticator app enabled successfully!
            </div>
            <p class="totp-step-desc" style={{ marginTop: 16 }}>
              <strong>Save these backup codes now.</strong> Each code can be used once to sign
              in if you lose access to your authenticator app. They will not be shown again.
            </p>
            <div class="totp-codes-grid">
              {backupCodes.map((bc, i) => (
                <div key={i} class="totp-backup-code">{bc}</div>
              ))}
            </div>
            <div class="totp-codes-actions">
              <button type="button" class="stg-btn-outline" onClick={handleCopyCodes}>
                <i class={copied ? 'fas fa-check' : 'fas fa-copy'} />
                {copied ? 'Copied!' : 'Copy codes'}
              </button>
              <button type="button" class="stg-btn-outline" onClick={handleDownloadCodes}>
                <i class="fas fa-download" /> Download
              </button>
            </div>
            <div class="totp-modal-footer">
              <button type="button" class="stg-btn-save" onClick={onClose}>
                Done — I have saved my codes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TOTP disable modal ────────────────────────────────────────────────────────

interface TotpDisableModalProps {
  onClose:    () => void;
  onDisabled: () => void;
}

export function TotpDisableModal({ onClose, onDisabled }: TotpDisableModalProps): VNode {
  const [code,  setCode]  = useState('');
  const [error, setError] = useState('');
  const disableTotp = useDisableTotp();

  const handleDisable = useCallback(() => {
    setError('');
    disableTotp.mutate(code, {
      onSuccess: res => {
        if (res.success) {
          toast.success('Two-factor authentication disabled.');
          onDisabled();
        } else if (res.code === 'last_factor') {
          setError(res.message ?? 'Two-factor is required for your role and cannot be disabled.');
        } else {
          setError(res.message ?? 'Invalid code. Please try again.');
        }
      },
      onError: () => setError('Request failed. Please try again.'),
    });
  }, [code, disableTotp, onDisabled]);

  return (
    <div class="totp-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="totp-modal">
        <div class="totp-modal-header">
          <div class="totp-modal-title">
            <i class="fas fa-lock-open" style={{ color: '#DC2626', marginRight: 8 }} />
            Disable Two-Factor Authentication
          </div>
          <button type="button" class="totp-modal-close" onClick={onClose} aria-label="Close">
            <i class="fas fa-xmark" />
          </button>
        </div>
        <div class="totp-modal-body">
          <p class="totp-step-desc">
            Enter your current authenticator code (or a backup code) to confirm.
          </p>
          <div class="stg-form-group" style={{ maxWidth: 220 }}>
            <label>Code (TOTP or backup)</label>
            <input
              type="text"
              inputMode="text"
              maxLength={8}
              value={code}
              onInput={e => setCode((e.target as HTMLInputElement).value.trim().toUpperCase())}
              placeholder="000000 or XXXXXXXX"
              class="totp-code-input"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleDisable(); }}
            />
          </div>
          {error && <div class="totp-error"><i class="fas fa-circle-exclamation" /> {error}</div>}
          <div class="totp-modal-footer">
            <button type="button" class="stg-btn-outline" onClick={onClose}>Cancel</button>
            <button
              type="button"
              style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 20px', fontWeight: 600, cursor: 'pointer', fontSize: '0.83rem' }}
              disabled={code.length < 6 || disableTotp.isPending}
              onClick={handleDisable}
            >
              {disableTotp.isPending ? <><i class="fas fa-spinner fa-spin" /> Disabling…</> : 'Disable 2FA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TOTP regenerate backup codes modal ────────────────────────────────────────

interface TotpRegenModalProps {
  onClose: () => void;
}

function TotpRegenModal({ onClose }: TotpRegenModalProps): VNode {
  const [code,        setCode]        = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied,      setCopied]      = useState(false);
  const [error,       setError]       = useState('');
  const regenCodes = useRegenerateBackupCodes();

  const handleRegen = useCallback(() => {
    setError('');
    regenCodes.mutate(code, {
      onSuccess: res => {
        if (res.success) {
          setBackupCodes(res.backupCodes);
        } else {
          setError('Invalid code. Please try again.');
        }
      },
      onError: () => setError('Request failed. Please try again.'),
    });
  }, [code, regenCodes]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [backupCodes]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'siomac-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [backupCodes]);

  return (
    <div class="totp-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="totp-modal">
        <div class="totp-modal-header">
          <div class="totp-modal-title">
            <i class="fas fa-rotate" style={{ color: 'var(--siomac-navy, #1B2D55)', marginRight: 8 }} />
            Regenerate Backup Codes
          </div>
          <button type="button" class="totp-modal-close" onClick={onClose} aria-label="Close">
            <i class="fas fa-xmark" />
          </button>
        </div>
        <div class="totp-modal-body">
          {backupCodes.length === 0 ? (
            <>
              <p class="totp-step-desc">
                Generating new codes will immediately invalidate your existing backup codes.
                Enter your current authenticator code to confirm.
              </p>
              <div class="stg-form-group" style={{ maxWidth: 220 }}>
                <label>Current authenticator code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  value={code}
                  onInput={e => setCode((e.target as HTMLInputElement).value.trim())}
                  placeholder="000000"
                  class="totp-code-input"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleRegen(); }}
                />
              </div>
              {error && <div class="totp-error"><i class="fas fa-circle-exclamation" /> {error}</div>}
              <div class="totp-modal-footer">
                <button type="button" class="stg-btn-outline" onClick={onClose}>Cancel</button>
                <button
                  type="button"
                  class="stg-btn-save"
                  disabled={code.length < 6 || regenCodes.isPending}
                  onClick={handleRegen}
                >
                  {regenCodes.isPending ? <><i class="fas fa-spinner fa-spin" /> Generating…</> : 'Generate New Codes'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div class="totp-success-banner">
                <i class="fas fa-circle-check" /> New backup codes generated — old codes are now invalid.
              </div>
              <p class="totp-step-desc" style={{ marginTop: 16 }}>
                Save these codes somewhere safe. They will not be shown again.
              </p>
              <div class="totp-codes-grid">
                {backupCodes.map((bc, i) => (
                  <div key={i} class="totp-backup-code">{bc}</div>
                ))}
              </div>
              <div class="totp-codes-actions">
                <button type="button" class="stg-btn-outline" onClick={handleCopy}>
                  <i class={copied ? 'fas fa-check' : 'fas fa-copy'} />
                  {copied ? 'Copied!' : 'Copy codes'}
                </button>
                <button type="button" class="stg-btn-outline" onClick={handleDownload}>
                  <i class="fas fa-download" /> Download
                </button>
              </div>
              <div class="totp-modal-footer">
                <button type="button" class="stg-btn-save" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Passkeys card ─────────────────────────────────────────────────────────────

/** True if WebAuthn is available in this browser. */
const webauthnAvailable = typeof window !== 'undefined' && !!window.PublicKeyCredential;

function PasskeysCard(): VNode {
  const setPasskeyCount = useSessionStore(s => s.setPasskeyCount);
  const { data: passkeys = [], isLoading, refetch } = usePasskeys(webauthnAvailable);
  const registerMut = useRegisterPasskey();
  const renameMut   = useRenamePasskey();
  const deleteMut   = useDeletePasskey();
  const { ensureStepUp } = useStepUp();

  // Keep session store in sync with count
  useEffect(() => {
    setPasskeyCount(passkeys.length);
  }, [passkeys.length, setPasskeyCount]);

  // ── Register new passkey ───────────────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    const rawLabel = await dialog.prompt({ title: 'Name this passkey', placeholder: 'Optional name', value: '' });
    if (rawLabel === null) return; // user cancelled
    const label = rawLabel.trim() || undefined;
    try {
      await registerMut.mutateAsync(label);
      toast.success('Passkey registered successfully.');
      void refetch();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') return; // user cancelled
      toast.error(err instanceof Error ? err.message : 'Registration failed.');
    }
  }, [registerMut, refetch]);

  // ── Rename passkey ─────────────────────────────────────────────────────────
  const handleRename = useCallback(async (cred: PasskeyCredential) => {
    const newLabel = await dialog.prompt({ title: 'Rename passkey', value: cred.label || '', placeholder: 'New name' });
    if (newLabel === null || newLabel.trim() === '') return;
    try {
      await renameMut.mutateAsync({ credentialId: cred.id, label: newLabel.trim() });
      toast.success('Passkey renamed.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Rename failed.');
    }
  }, [renameMut]);

  // ── Delete passkey ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (cred: PasskeyCredential) => {
    const label = cred.label || cred.id.slice(0, 8) + '…';
    const res = await openActionModal({
      title: 'Remove passkey', subtitle: label, icon: 'fa-key', tone: 'danger',
      record: toActionRecord({ title: label, subtitle: 'Passkey', icon: 'fa-key' }),
      warning: 'Removing a passkey means it can no longer be used to sign in.',
      whatNext: ['If this is your last strong factor, removal is blocked to keep your account recoverable.'],
      confirmLabel: 'Remove passkey',
    });
    if (!res.confirmed) return;
    try {
      const doDelete = withStepUp(ensureStepUp, () =>
        deleteMut.mutateAsync(cred.id)
      );
      const res = await doDelete();
      if (!res.success && res.code === 'last_factor') {
        toast.error(res.message ?? 'Cannot remove your last strong factor.');
        return;
      }
      if (!res.success && res.code === 'step_up_required') return; // user cancelled step-up
      toast.success('Passkey removed.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
    }
  }, [deleteMut, ensureStepUp]);

  if (!webauthnAvailable) {
    return (
      <div class="totp-card">
        <div class="totp-card-header">
          <div class="totp-card-icon"><i class="fas fa-fingerprint" /></div>
          <div class="totp-card-info">
            <div class="totp-card-title">Passkeys</div>
            <div class="totp-card-desc">
              Passkeys are not supported in this browser. Use a modern browser with WebAuthn support.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="totp-card">
      <div class="totp-card-header">
        <div class="totp-card-icon"><i class="fas fa-fingerprint" /></div>
        <div class="totp-card-info">
          <div class="totp-card-title">Passkeys</div>
          <div class="totp-card-desc">
            Sign in with biometrics or a hardware key — no password required.
          </div>
        </div>
        {!isLoading && (
          <div class={`totp-badge ${passkeys.length > 0 ? 'totp-badge--on' : 'totp-badge--off'}`}>
            {passkeys.length > 0 ? `${passkeys.length} registered` : 'None'}
          </div>
        )}
      </div>

      {isLoading && (
        <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>
      )}

      {!isLoading && passkeys.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {passkeys.map((cred) => (
            <div
              key={cred.id}
              class="totp-enrolled-meta"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                  {cred.label || <em style={{ color: 'var(--text-secondary)' }}>Unnamed</em>}
                </span>
                <span style={{ margin: '0 8px', color: 'var(--text-secondary)' }}>·</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {cred.deviceType === 'multiDevice' ? 'Synced' : 'Single-device'}
                  {cred.backedUp ? ' · Backed up' : ''}
                </span>
                <span style={{ margin: '0 8px', color: 'var(--text-secondary)' }}>·</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <i class="fas fa-calendar-plus" style={{ marginRight: 3 }} />
                  Added {new Date(cred.createdAt).toLocaleDateString()}
                </span>
                {cred.lastUsedAt && (
                  <>
                    <span style={{ margin: '0 8px', color: 'var(--text-secondary)' }}>·</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Last used {new Date(cred.lastUsedAt).toLocaleDateString()}
                    </span>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  type="button"
                  class="stg-btn-outline"
                  style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                  onClick={() => void handleRename(cred)}
                  disabled={renameMut.isPending}
                >
                  <i class="fas fa-pencil" /> Rename
                </button>
                <button
                  type="button"
                  class="stg-btn-outline"
                  style={{ padding: '3px 10px', fontSize: '0.78rem', color: 'var(--danger,#ef4444)', borderColor: 'var(--danger,#ef4444)' }}
                  onClick={() => void handleDelete(cred)}
                  disabled={deleteMut.isPending}
                >
                  <i class="fas fa-trash-can" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
        <div class="totp-card-actions">
          <button
            type="button"
            class="stg-btn-save"
            onClick={() => void handleAdd()}
            disabled={registerMut.isPending}
          >
            {registerMut.isPending
              ? <><i class="fas fa-spinner fa-spin" /> Registering…</>
              : <><i class="fas fa-plus" /> Add Passkey</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ── Authenticator App card ────────────────────────────────────────────────────

function AuthenticatorCard(): VNode {
  const { data: status, isLoading, refetch } = useTotpStatus();
  const [showSetup,    setShowSetup]    = useState(false);
  const [showDisable,  setShowDisable]  = useState(false);
  const [showRegen,    setShowRegen]    = useState(false);

  const handleEnabled = useCallback(() => {
    void refetch();
    setShowSetup(false);
  }, [refetch]);

  const handleDisabled = useCallback(() => {
    void refetch();
    setShowDisable(false);
  }, [refetch]);

  const mandatory  = status?.mandatory  ?? false;
  const enabled    = status?.enabled    ?? false;
  const codesLeft  = status?.backupCodesRemaining ?? 0;
  const enrolledAt = status?.enrolledAt ?? null;

  return (
    <>
      <div class="totp-card">
        <div class="totp-card-header">
          <div class="totp-card-icon">
            <i class="fas fa-mobile-screen-button" />
          </div>
          <div class="totp-card-info">
            <div class="totp-card-title">Authenticator App</div>
            <div class="totp-card-desc">
              Use a TOTP app (Google Authenticator, Authy, 1Password) to generate one-time codes at login.
            </div>
          </div>
          {!isLoading && (
            <div class={`totp-badge ${enabled ? 'totp-badge--on' : 'totp-badge--off'}`}>
              {enabled ? 'Enabled' : 'Disabled'}
            </div>
          )}
        </div>

        {isLoading && (
          <div class="totp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>
        )}

        {!isLoading && enabled && (
          <div class="totp-enrolled-meta">
            {enrolledAt && (
              <span><i class="fas fa-calendar-check" /> Enrolled {new Date(enrolledAt).toLocaleDateString()}</span>
            )}
            <span><i class="fas fa-key" /> {codesLeft} backup {codesLeft === 1 ? 'code' : 'codes'} remaining</span>
          </div>
        )}

        {!isLoading && mandatory && !enabled && (
          <div class="totp-mandatory-note">
            <i class="fas fa-circle-info" />
            Two-factor authentication is required for your role.
          </div>
        )}

        {!isLoading && (
          <div class="totp-card-actions">
            {!enabled ? (
              <button
                type="button"
                class="stg-btn-save"
                onClick={() => setShowSetup(true)}
              >
                <i class="fas fa-plus" /> Set up authenticator app
              </button>
            ) : (
              <>
                <button
                  type="button"
                  class="stg-btn-outline"
                  disabled={mandatory}
                  title={mandatory ? 'Two-factor is required for your role and cannot be disabled.' : undefined}
                  onClick={() => { if (!mandatory) setShowDisable(true); }}
                >
                  <i class="fas fa-lock-open" /> Disable
                </button>
                <button
                  type="button"
                  class="stg-btn-outline"
                  onClick={() => setShowRegen(true)}
                >
                  <i class="fas fa-rotate" /> Regenerate backup codes
                </button>
              </>
            )}
          </div>
        )}

        {!isLoading && mandatory && enabled && (
          <div class="totp-mandatory-note" style={{ marginTop: 8 }}>
            <i class="fas fa-lock" />
            Two-factor is mandatory for your role and cannot be disabled.
          </div>
        )}
      </div>

      {showSetup   && <TotpSetupModal   onClose={() => setShowSetup(false)}   onEnabled={handleEnabled} />}
      {showDisable && <TotpDisableModal onClose={() => setShowDisable(false)} onDisabled={handleDisabled} />}
      {showRegen   && <TotpRegenModal   onClose={() => { setShowRegen(false); void refetch(); }} />}
    </>
  );
}

// ── Security panel ────────────────────────────────────────────────────────────

function SecurityPanel(): VNode {
  const role = useSessionStore(s => s.role);
  const isSuperadmin = role === 'superadmin';

  const handleClearCache = useCallback(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch { /* ignore */ }
    toast.success('Local cache cleared — reloading…');
    setTimeout(() => window.location.reload(), 1200);
  }, []);

  return (
    <div>
      <SessionTimeoutCard canEdit={isSuperadmin} />

      {/* Password card — stub; password change is in scope of a later phase */}
      <div class="stg-card">
        <CardLabel icon="fa-key" text="Password" />
        <div class="totp-card">
          <div class="totp-card-header">
            <div class="totp-card-icon">
              <i class="fas fa-lock" />
            </div>
            <div class="totp-card-info">
              <div class="totp-card-title">Account Password</div>
              <div class="totp-card-desc">Managed via your account credentials.</div>
            </div>
          </div>
          <div class="totp-card-actions">
            {/* TODO: implement password change in a later phase */}
            <button type="button" class="stg-btn-outline" disabled title="Coming soon">
              <i class="fas fa-key" /> Change Password
            </button>
          </div>
        </div>
      </div>

      {/* Authenticator App (TOTP) card */}
      <div class="stg-card">
        <CardLabel icon="fa-shield-halved" text="Two-Factor Authentication" />
        <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
          Protect your account with a second verification step at login.
          Each time you sign in, you'll need your password plus a code from your authenticator app.
        </p>
        <AuthenticatorCard />
      </div>

      {/* Passkeys card */}
      <div class="stg-card">
        <CardLabel icon="fa-fingerprint" text="Passkeys" />
        <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
          Register a biometric or hardware key to sign in without a password or one-time code.
        </p>
        <PasskeysCard />
      </div>

      {/* Trusted Devices card */}
      <div class="stg-card">
        <CardLabel icon="fa-laptop-mobile" text="Trusted Devices" />
        <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
          Devices you have marked as trusted can sign in without a 2FA code for a limited time.
        </p>
        <TrustedDevicesCard />
      </div>

      {/* Login alerts — coming soon */}
      <div class="stg-card">
        <CardLabel icon="fa-bell" text="Login Alerts" />
        <div class="stg-switch-group">
          <div>
            <div class="stg-switch-label">Login alerts via email</div>
            <div class="stg-switch-desc">Notify when a new device signs in — coming soon</div>
          </div>
          <label class="stg-toggle">
            <input type="checkbox" checked={false} disabled />
            <span class="stg-slider" />
          </label>
        </div>
      </div>

      {/* Danger zone */}
      <div class="stg-card stg-danger-zone">
        <CardLabel icon="fa-triangle-exclamation" text="Danger Zone" />
        <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
          Clear all locally cached preferences, theme choices, and session tokens, then reload the page. Your server-side data is not affected.
        </p>
        <button
          type="button"
          class="stg-btn-outline stg-danger-label"
          onClick={handleClearCache}
        >
          <i class="fas fa-trash-can" /> Clear Local Settings
        </button>
      </div>
    </div>
  );
}

// ── Embedded legacy / auth panels (rendered inside the v2 shell) ───────────────

function LegacyPage({ meta, settings, onBrandingSaved }: {
  meta: SwzPage; settings: AppSettings | null; onBrandingSaved: (name: string, logoUrl: string) => void;
}): VNode {
  const body = (() => {
    if (meta.kind === 'manifests') return <ManifestReviewPanel />;
    switch (meta.legacy) {
      case 'company':    return <BrandingPanel settings={settings ?? emptySettings()} onSaved={onBrandingSaved} />;
      case 'security':   return <SecurityPanel />;
      default:           return null;
    }
  })();
  return (
    <div class="settings-content"><div class="content-shell">
      <div class="breadcrumb"><span>Settings</span><span class="sep">›</span><span>{meta.group}</span><span class="sep">›</span><span>{meta.label}</span></div>
      <section class="top-panel">
        <div class="module-icon"><SwzIcon name={meta.iconKey} /></div>
        <div><h1>{meta.title}</h1><p>{meta.desc}</p></div>
      </section>
      <div class="swz-embed">{body}</div>
    </div></div>
  );
}

// ── Placeholder (feature pending reimplementation) ─────────────────────────────

function PlaceholderPage({ meta }: { meta: SwzPage }): VNode {
  return (
    <div class="settings-content"><div class="content-shell">
      <div class="breadcrumb"><span>Settings</span><span class="sep">›</span><span>{meta.group}</span><span class="sep">›</span><span>{meta.label}</span></div>
      <section class="top-panel">
        <div class="module-icon"><SwzIcon name={meta.iconKey} /></div>
        <div><h1>{meta.title}</h1><p>{meta.desc}</p></div>
      </section>
      <div class="swz-empty" style={{ marginTop: '14px' }}>
        <i class="fas fa-screwdriver-wrench" />
        {meta.title} is being rebuilt and will be available soon.
      </div>
    </div></div>
  );
}

// ── Console (Administration) tools embedded in the v2 shell ────────────────────

const CONSOLE_BODIES: Record<string, ComponentType> = {
  'user-security':   UserSecurityPanel,
  'security-policy': SecurityPolicyTab,
  'ui-kit':          UIKitPage,
};

function ConsolePage({ meta }: { meta: SwzPage }): VNode {
  const Body = CONSOLE_BODIES[meta.page];
  return (
    <div class="settings-content"><div class="content-shell">
      <div class="breadcrumb"><span>Settings</span><span class="sep">›</span><span>{meta.group}</span><span class="sep">›</span><span>{meta.label}</span></div>
      <section class="top-panel">
        <div class="module-icon"><SwzIcon name={meta.iconKey} /></div>
        <div><h1>{meta.title}</h1><p>{meta.desc}</p></div>
      </section>
      <div class="swz-embed">{Body ? <Body /> : null}</div>
    </div></div>
  );
}

// ── Main component (Settings v2 — faithful design, sidebar-swap nav) ───────────

export function SettingsSection(): VNode {
  const role    = useSessionStore(s => s.role);
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isSuper = role === 'superadmin';
  const defaultPage = isAdmin ? 'training' : 'my-preferences';

  const [page, setPage] = useState<string>(defaultPage);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Company/attendance values for the embedded legacy panels (admin only).
  useEffect(() => {
    if (!isAdmin) return;
    const ctrl = new AbortController();
    fetchSettings(ctrl.signal).then(s => setSettings(s)).catch(() => { /* non-fatal */ });
    return () => ctrl.abort();
  }, [isAdmin]);

  const handleBrandingSaved = useCallback((name: string, logoUrl: string) => {
    setSettings(prev => prev ? { ...prev, companyName: name, companyLogoUrl: logoUrl } : prev);
  }, []);

  // Refs so the mount-once nav listener reads current values.
  const pageRef = useRef(page); pageRef.current = page;
  const inSettingsRef = useRef(false);
  const prevSectionRef = useRef('s-adm-dashboard');

  // Swap the real Siomac sidebar menu to the settings categories while Settings
  // is active; restore the normal menu on exit. Clicks on the swapped-in items
  // (data-stg-page / data-stg-exit) are handled here — NavController ignores them
  // (no data-section), so there's no navigation conflict.
  useEffect(() => {
    const enter = () => {
      try {
        const last = localStorage.getItem('siomac_last_section_' + (role || ''));
        if (last && last !== 's-settings') prevSectionRef.current = last;
      } catch { /* ignore */ }
      inSettingsRef.current = true;
      document.getElementById('sidebar')?.classList.add('settings-mode');
      const menu = document.getElementById('sidebarMenu');
      if (menu) menu.innerHTML = buildSettingsMenuHtml(isAdmin, isSuper, pageRef.current);
    };
    const exit = () => {
      inSettingsRef.current = false;
      document.getElementById('sidebar')?.classList.remove('settings-mode');
      try { buildSidebar(role || ''); } catch { /* ignore */ }
    };
    const onSection = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === 's-settings') enter();
      else if (inSettingsRef.current) exit();
    };
    const onMenuClick = (e: Event) => {
      const target = e.target as Element;
      if (target.closest('[data-stg-exit]')) {
        e.preventDefault();
        showSection(prevSectionRef.current || 's-adm-dashboard');
        return;
      }
      const toggle = target.closest('[data-stg-group-toggle]');
      if (toggle) {
        e.preventDefault();
        const grp = toggle.closest('.sb-group');
        if (grp) { const open = grp.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); }
        return;
      }
      const btn = target.closest<HTMLElement>('[data-stg-page]');
      if (btn) {
        e.preventDefault();
        const p = btn.dataset.stgPage!;
        setPage(p);
        document.querySelectorAll<HTMLElement>('#sidebarMenu [data-stg-page]')
          .forEach(b => b.classList.toggle('active', b.dataset.stgPage === p));
      }
    };
    window.addEventListener('siomac:section', onSection);
    const menu = document.getElementById('sidebarMenu');
    menu?.addEventListener('click', onMenuClick);
    if (document.getElementById('s-settings')?.classList.contains('active')) enter();
    return () => {
      window.removeEventListener('siomac:section', onSection);
      menu?.removeEventListener('click', onMenuClick);
      if (inSettingsRef.current) { inSettingsRef.current = false; document.getElementById('sidebar')?.classList.remove('settings-mode'); try { buildSidebar(role || ''); } catch { /* ignore */ } }
    };
  }, [isAdmin, role]);

  const meta = getSwzPage(page) ?? getSwzPage(defaultPage)!;
  const catalogKind = meta.kind === 'catalog' || meta.kind === 'myprefs' || meta.kind === 'critical';

  return (
    <div class="swz">
      {catalogKind ? <SwzCatalogPage pageMeta={meta} />
       : meta.kind === 'console' ? <ConsolePage meta={meta} />
       : meta.kind === 'placeholder' ? <PlaceholderPage meta={meta} />
       : <LegacyPage meta={meta} settings={settings} onBrandingSaved={handleBrandingSaved} />}
    </div>
  );
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function emptySettings(): AppSettings {
  return {
    companyName: 'My Company', companyAddress: '', companyPhone: '',
    companyEmail: '', companyNIS: '', companyBIR: '', companyLogoUrl: '',
    currency: 'TT', latePenaltyPerDay: '0', leaveFinePerDay: '0',
    lateThresholdHHMM: '09:00', maxDistanceM: '200',
    workHoursStart: '08:00', workHoursEnd: '17:00',
  };
}
