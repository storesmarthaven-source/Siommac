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

import { type VNode }      from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { toast }           from '@store';
import {
  fetchSettings,
  updateSetting,
  saveWorkHoursApi,
  uploadLogoApi,
  type AppSettings,
} from './api';
import { applyCompanyNameToDom, applyCompanyLogoToDom } from './domSync';
import { NotificationPreferences } from '@components/notifications';

// ── Types ─────────────────────────────────────────────────────────────────────

type StgTab = 'company' | 'attendance-rules' | 'appearance' | 'layout' | 'notifications' | 'security';

// ── Shared presentational helpers ──────────────────────────────────────────────

function SaveBtn({ loading, label, icon, onClick }: {
  loading: boolean; label: string; icon: string; onClick: () => void;
}): VNode {
  return (
    <button
      type="button"
      class="stg-btn-save"
      onClick={onClick}
      disabled={loading}
    >
      <i class={loading ? 'fas fa-spinner fa-spin' : `fas ${icon}`} />
      {loading ? 'Saving…' : label}
    </button>
  );
}

function CardLabel({ icon, text }: { icon: string; text: string }): VNode {
  return (
    <div class="stg-card-label">
      <i class={`fas ${icon}`} />
      {text}
    </div>
  );
}

// ── Nav sidebar ───────────────────────────────────────────────────────────────

interface NavItem { id: StgTab; label: string; icon: string; iconBg: string; iconColor: string; adminOnly?: boolean; }

const NAV_ITEMS: NavItem[] = [
  { id: 'company',          label: 'Company & Branding',   icon: 'fa-building',       iconBg: 'rgba(27,45,85,.08)',    iconColor: '#1B2D55', adminOnly: true  },
  { id: 'attendance-rules', label: 'Attendance Rules',     icon: 'fa-clock',          iconBg: 'rgba(202,138,4,.10)',   iconColor: '#ca8a04', adminOnly: true  },
  { id: 'appearance',       label: 'Appearance',           icon: 'fa-palette',        iconBg: 'rgba(124,58,237,.09)', iconColor: '#7c3aed'                   },
  { id: 'layout',           label: 'Layout & Navigation',  icon: 'fa-table-columns',  iconBg: 'rgba(37,99,235,.09)',  iconColor: '#2563eb'                   },
  { id: 'notifications',    label: 'Notifications',        icon: 'fa-bell',           iconBg: 'rgba(71,144,74,.09)',  iconColor: '#47904a'                   },
  { id: 'security',         label: 'Security & Privacy',   icon: 'fa-shield-halved',  iconBg: 'rgba(228,12,12,.08)', iconColor: '#DC2626'                   },
];

// ── Colour themes ─────────────────────────────────────────────────────────────

const COLOUR_THEMES = [
  { id: 'navy',    label: 'Navy',    swatch: '#1B2D55' },
  { id: 'slate',   label: 'Slate',   swatch: '#475569' },
  { id: 'emerald', label: 'Emerald', swatch: '#059669' },
  { id: 'rose',    label: 'Rose',    swatch: '#E11D48' },
  { id: 'amber',   label: 'Amber',   swatch: '#D97706' },
  { id: 'indigo',  label: 'Indigo',  swatch: '#4F46E5' },
];

const LAYOUT_MODES = [
  { id: 'sidebar', label: 'Sidebar',   icon: 'fa-sidebar',       desc: 'Fixed left navigation panel' },
  { id: 'topbar',  label: 'Top Bar',   icon: 'fa-window-maximize', desc: 'Compact top navigation bar' },
];

// ── Company & Branding panel ──────────────────────────────────────────────────

interface BrandingPanelProps {
  settings:    AppSettings;
  onSaved:     (name: string, logoUrl: string) => void;
}

function BrandingPanel({ settings, onSaved }: BrandingPanelProps): VNode {
  const [name,    setName]    = useState(settings.companyName);
  const [addr,    setAddr]    = useState(settings.companyAddress);
  const [phone,   setPhone]   = useState(settings.companyPhone);
  const [email,   setEmail]   = useState(settings.companyEmail);
  const [nis,     setNis]     = useState(settings.companyNIS);
  const [bir,     setBir]     = useState(settings.companyBIR);
  const [saving,  setSaving]  = useState(false);

  // Logo
  const [logoB64,      setLogoB64]      = useState('');
  const [logoFileName, setLogoFileName] = useState('');
  const [logoPreview,  setLogoPreview]  = useState(settings.companyLogoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync when settings prop changes (initial load)
  useEffect(() => {
    setName(settings.companyName);
    setAddr(settings.companyAddress);
    setPhone(settings.companyPhone);
    setEmail(settings.companyEmail);
    setNis(settings.companyNIS);
    setBir(settings.companyBIR);
    setLogoPreview(settings.companyLogoUrl);
  }, [settings]);

  const handleLogoFile = useCallback((e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target?.result as string;
      setLogoB64(b64);
      setLogoPreview(b64);
      setLogoFileName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSaveLogo = useCallback(async () => {
    if (!logoB64) return;
    setUploadingLogo(true);
    try {
      const url = await uploadLogoApi(logoB64);
      setLogoPreview(url);
      setLogoB64('');
      setLogoFileName('');
      applyCompanyLogoToDom(url);
      onSaved(name, url);
      toast.success('Logo updated — login screen and sidebar now show the new logo.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingLogo(false);
    }
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
      toast.success('Company settings saved successfully.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [name, addr, phone, email, nis, bir, logoPreview, onSaved]);

  // Logo preview border radius (square → circle, wide → rounded rect)
  const [logoRadius, setLogoRadius] = useState('10px');
  const logoImgRef = useRef<HTMLImageElement>(null);
  const handleLogoLoad = useCallback(() => {
    const img = logoImgRef.current;
    if (!img) return;
    const r = img.naturalWidth / (img.naturalHeight || 1);
    setLogoRadius(r >= 0.85 && r <= 1.15 ? '50%' : '10px');
  }, []);

  return (
    <div>
      {/* Company info */}
      <div class="stg-card">
        <CardLabel icon="fa-id-card" text="Company Information" />
        <div class="stg-form-group">
          <label>Company Name</label>
          <input type="text" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} maxLength={80} placeholder="My Company" />
          <small>Shown in sidebar, About, payroll documents, and leave applications</small>
        </div>
        <div class="stg-form-group">
          <label>Address</label>
          <input type="text" value={addr} onInput={e => setAddr((e.target as HTMLInputElement).value)} maxLength={160} placeholder="e.g. #64-70 Lady Hailes Avenue, San Fernando" />
        </div>
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>Phone</label>
            <input type="text" value={phone} onInput={e => setPhone((e.target as HTMLInputElement).value)} maxLength={40} placeholder="e.g. 657-2457" />
          </div>
          <div class="stg-form-group">
            <label>Email</label>
            <input type="email" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} maxLength={100} placeholder="e.g. info@company.tt" />
          </div>
        </div>
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>NIS Registration No.</label>
            <input type="text" value={nis} onInput={e => setNis((e.target as HTMLInputElement).value)} maxLength={40} placeholder="e.g. 1234567" />
          </div>
          <div class="stg-form-group">
            <label>BIR File No.</label>
            <input type="text" value={bir} onInput={e => setBir((e.target as HTMLInputElement).value)} maxLength={40} placeholder="e.g. 100123456" />
          </div>
        </div>
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>Currency</label>
            <input type="text" value="TT" readonly class="stg-readonly" />
            <small>Fixed to TT — contact your administrator to change</small>
          </div>
          <div class="stg-form-group">
            <label>Time Zone</label>
            <select disabled class="stg-readonly"><option>America/Port_of_Spain</option></select>
            <small>Contact your administrator to change</small>
          </div>
        </div>
        <SaveBtn loading={saving} label="Save Changes" icon="fa-check" onClick={() => void handleSaveInfo()} />
      </div>

      {/* Logo & Branding */}
      <div class="stg-card">
        <CardLabel icon="fa-image" text="Logo & Branding" />
        <div class="stg-logo-row">
          {/* Preview */}
          <div class="stg-logo-preview-wrap">
            {logoPreview ? (
              <img
                ref={logoImgRef}
                src={logoPreview}
                alt="Logo"
                onLoad={handleLogoLoad}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: logoRadius }}
              />
            ) : (
              <i class="fas fa-image" style={{ fontSize: '28px', color: 'var(--text-muted)' }} />
            )}
          </div>
          {/* Controls */}
          <div style={{ flex: 1, minWidth: '0' }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} />
            <div class="stg-card-actions" style={{ justifyContent: 'flex-start', marginBottom: '8px' }}>
              <button
                type="button"
                class="stg-btn-outline"
                onClick={() => fileRef.current?.click()}
              >
                <i class="fas fa-upload" /> Choose Logo
              </button>
              <button
                type="button"
                class="stg-btn-save"
                onClick={() => void handleSaveLogo()}
                disabled={!logoB64 || uploadingLogo}
              >
                <i class={uploadingLogo ? 'fas fa-spinner fa-spin' : 'fas fa-check'} />
                {uploadingLogo ? 'Uploading…' : 'Save Logo'}
              </button>
            </div>
            {logoFileName && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{logoFileName}</div>}
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>PNG or JPG, up to 2 MB. Applies to the login screen, sidebar, and About page.</p>
          </div>
        </div>
      </div>

      {/* Reset + Save all row */}
      <div class="stg-card-actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          class="stg-btn-outline"
          onClick={() => {
            setName('My Company'); setAddr(''); setPhone(''); setEmail(''); setNis(''); setBir('');
            toast.info('Fields reset — click Save Changes to apply.');
          }}
        >
          <i class="fas fa-rotate-left" /> Reset Defaults
        </button>
      </div>
    </div>
  );
}

// ── Attendance Rules panel ────────────────────────────────────────────────────

function AttendanceRulesPanel({ settings }: { settings: AppSettings }): VNode {
  const [latePenalty,  setLatePenalty]  = useState(settings.latePenaltyPerDay);
  const [leaveFine,    setLeaveFine]    = useState(settings.leaveFinePerDay);
  const [lateThresh,   setLateThresh]   = useState(settings.lateThresholdHHMM);
  const [maxDist,      setMaxDist]      = useState(settings.maxDistanceM);
  const [workStart,    setWorkStart]    = useState(settings.workHoursStart);
  const [workEnd,      setWorkEnd]      = useState(settings.workHoursEnd);
  const [savingRules,  setSavingRules]  = useState(false);
  const [savingHours,  setSavingHours]  = useState(false);

  useEffect(() => {
    setLatePenalty(settings.latePenaltyPerDay);
    setLeaveFine(settings.leaveFinePerDay);
    setLateThresh(settings.lateThresholdHHMM);
    setMaxDist(settings.maxDistanceM);
    setWorkStart(settings.workHoursStart);
    setWorkEnd(settings.workHoursEnd);
  }, [settings]);

  const handleSaveRules = useCallback(async () => {
    setSavingRules(true);
    try {
      await Promise.all([
        updateSetting('latePenaltyPerDay', String(Math.max(0, Number(latePenalty) || 0))),
        updateSetting('leaveFinePerDay',   String(Math.max(0, Number(leaveFine)   || 0))),
        updateSetting('lateThresholdHHMM', lateThresh || '09:00'),
        updateSetting('maxDistanceM',      String(Math.max(0, Number(maxDist) || 200))),
      ]);
      toast.success('Attendance rules saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingRules(false);
    }
  }, [latePenalty, leaveFine, lateThresh, maxDist]);

  const handleSaveHours = useCallback(async () => {
    if (workStart >= workEnd) { toast.error('Work start must be before end time.'); return; }
    setSavingHours(true);
    try {
      await saveWorkHoursApi(workStart, workEnd);
      toast.success(`Work hours saved: ${workStart} – ${workEnd}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingHours(false);
    }
  }, [workStart, workEnd]);

  const prefixInput = (value: string, onChange: (v: string) => void, prefix: string, suffix?: string) => (
    <div class={prefix ? 'stg-input-prefix-wrap' : suffix ? 'stg-input-suffix-wrap' : undefined}>
      {prefix && <span class="stg-input-prefix">{prefix}</span>}
      <input
        type="number"
        value={value}
        onInput={e => onChange((e.target as HTMLInputElement).value)}
        min="0"
        step="0.01"
      />
      {suffix && <span class="stg-input-suffix">{suffix}</span>}
    </div>
  );

  return (
    <div>
      <div class="stg-card">
        <CardLabel icon="fa-triangle-exclamation" text="Late & Absence Penalties" />
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>Late Penalty (per late day)</label>
            {prefixInput(latePenalty, setLatePenalty, '$')}
            <small>Deducted for each late check-in during payroll</small>
          </div>
          <div class="stg-form-group">
            <label>Absent / Leave Fine (per day)</label>
            {prefixInput(leaveFine, setLeaveFine, '$')}
            <small>Deducted for each absent day in the period</small>
          </div>
        </div>
        <CardLabel icon="fa-map-pin" text="Check-In Thresholds" />
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>Late Check-In Time</label>
            <input type="time" value={lateThresh} onInput={e => setLateThresh((e.target as HTMLInputElement).value)} />
            <small>Check-ins after this time are flagged late</small>
          </div>
          <div class="stg-form-group">
            <label>Max Geofence Distance</label>
            {prefixInput(maxDist, setMaxDist, '', 'm')}
            <small>Max metres from a site to allow check-in</small>
          </div>
        </div>
        <SaveBtn loading={savingRules} label="Save Rules" icon="fa-check" onClick={() => void handleSaveRules()} />
      </div>

      <div class="stg-card">
        <CardLabel icon="fa-business-time" text="Work Hours" />
        <div class="stg-form-row">
          <div class="stg-form-group">
            <label>Work Start Time</label>
            <input type="time" value={workStart} onInput={e => setWorkStart((e.target as HTMLInputElement).value)} />
            <small>Earliest allowed check-in time</small>
          </div>
          <div class="stg-form-group">
            <label>Work End Time</label>
            <input type="time" value={workEnd} onInput={e => setWorkEnd((e.target as HTMLInputElement).value)} />
            <small>Employees are auto signed-out at this time</small>
          </div>
        </div>
        <SaveBtn loading={savingHours} label="Save Work Hours" icon="fa-business-time" onClick={() => void handleSaveHours()} />
      </div>
    </div>
  );
}

// ── Appearance panel ──────────────────────────────────────────────────────────

function AppearancePanel(): VNode {
  const colorScheme   = useSessionStore(s => s.colorScheme);
  const setColorScheme = useSessionStore(s => s.setColorScheme);

  return (
    <div class="stg-card">
      <CardLabel icon="fa-swatchbook" text="Colour Theme" />
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {COLOUR_THEMES.map(t => {
          const active = colorScheme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setColorScheme(t.id as typeof colorScheme)}
              style={{
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            '8px',
                padding:        '12px 16px',
                border:         active ? `2px solid ${t.swatch}` : '2px solid var(--border)',
                borderRadius:   '14px',
                background:     active ? `${t.swatch}12` : 'var(--bg-card)',
                cursor:         'pointer',
                minWidth:       '80px',
              }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: t.swatch, boxShadow: active ? `0 0 0 3px ${t.swatch}44` : 'none' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: active ? t.swatch : 'var(--text-secondary)' }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Layout panel ──────────────────────────────────────────────────────────────

function LayoutPanel(): VNode {
  const layoutMode    = useSessionStore(s => s.layoutMode);
  const setLayoutMode = useSessionStore(s => s.setLayoutMode);

  return (
    <div>
      <div class="stg-card">
        <CardLabel icon="fa-sidebar" text="Navigation Style" />
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {LAYOUT_MODES.map(m => {
            const active = layoutMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setLayoutMode(m.id as typeof layoutMode)}
                style={{
                  flex:           '1 1 0',
                  minWidth:       '140px',
                  padding:        '16px',
                  border:         active ? '2px solid var(--siomac-navy)' : '2px solid var(--border)',
                  borderRadius:   '14px',
                  background:     active ? 'var(--bg-subtle, #f5f7fb)' : 'var(--bg-card)',
                  cursor:         'pointer',
                  textAlign:      'left',
                }}
              >
                <i class={`fas ${m.icon}`} style={{ fontSize: '20px', color: active ? 'var(--siomac-navy)' : 'var(--text-muted)', display: 'block', marginBottom: '8px' }} />
                <div style={{ fontSize: '0.83rem', fontWeight: 700, color: active ? 'var(--siomac-navy)' : 'var(--text-primary)' }}>{m.label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{m.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
      <div class="stg-card">
        <CardLabel icon="fa-gauge" text="Dashboard Preferences" />
        <div class="stg-form-group">
          <label>Default Dashboard View</label>
          <select disabled class="stg-readonly" style={{ opacity: 0.6 }}>
            <option>Operations Overview</option>
            <option>Attendance Analytics</option>
            <option>Live Map</option>
          </select>
          <small>Coming soon</small>
        </div>
        {[
          { label: 'Auto-refresh dashboard',  desc: 'Refresh stats every 30 seconds — coming soon', checked: true  },
          { label: 'Compact table rows',      desc: 'Reduce row height in all data tables — coming soon', checked: false },
        ].map(sw => (
          <div key={sw.label} class="stg-switch-group">
            <div>
              <div class="stg-switch-label">{sw.label}</div>
              <div class="stg-switch-desc">{sw.desc}</div>
            </div>
            <label class="stg-toggle">
              <input type="checkbox" checked={sw.checked} disabled />
              <span class="stg-slider" />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notifications panel ───────────────────────────────────────────────────────
// Phase 2c: Uses NotificationPreferences component (TanStack Query + Supabase)

function NotificationsPanel(): VNode {
  return (
    <div class="stg-card">
      <CardLabel icon="fa-bell" text="Notification Preferences" />
      <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
        Choose which types of in-app notifications you receive. Email and WhatsApp
        delivery will be available in a future update.
      </p>
      <NotificationPreferences />
    </div>
  );
}

// ── Security panel ────────────────────────────────────────────────────────────

function SecurityPanel(): VNode {
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
      <div class="stg-card">
        <CardLabel icon="fa-lock" text="Access & Session" />
        <div class="stg-form-group">
          <label>Session Timeout</label>
          <select disabled class="stg-readonly" style={{ opacity: 0.6 }}>
            <option value="60">60 minutes</option>
            <option value="30">30 minutes</option>
            <option value="120">2 hours</option>
          </select>
          <small>Contact your administrator to change the session duration</small>
        </div>
        {[
          { label: 'Two-Factor Authentication', desc: 'Require a one-time code at login — coming soon',     checked: false },
          { label: 'Login alerts via email',    desc: 'Notify when a new device logs in — coming soon',     checked: false },
        ].map(sw => (
          <div key={sw.label} class="stg-switch-group">
            <div>
              <div class="stg-switch-label">{sw.label}</div>
              <div class="stg-switch-desc">{sw.desc}</div>
            </div>
            <label class="stg-toggle">
              <input type="checkbox" checked={sw.checked} disabled />
              <span class="stg-slider" />
            </label>
          </div>
        ))}
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

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsSection(): VNode {
  const role    = useSessionStore(s => s.role);
  // Company/admin settings are available to admin AND superadmin.
  const isAdmin = role === 'admin' || role === 'superadmin';

  const [activeTab,    setActiveTab]    = useState<StgTab>(isAdmin ? 'company' : 'appearance');
  const [settings,     setSettings]     = useState<AppSettings | null>(null);
  const [loadingStg,   setLoadingStg]   = useState(true);

  // Load settings on mount (admin only for the values; panel itself loads lazily)
  useEffect(() => {
    if (!isAdmin) { setLoadingStg(false); return; }
    const ctrl = new AbortController();
    fetchSettings(ctrl.signal)
      .then(s => setSettings(s))
      .catch(() => { /* non-fatal — show empty form */ })
      .finally(() => setLoadingStg(false));
    return () => ctrl.abort();
  }, [isAdmin]);

  const handleBrandingSaved = useCallback((name: string, logoUrl: string) => {
    setSettings(prev => prev ? { ...prev, companyName: name, companyLogoUrl: logoUrl } : prev);
  }, []);

  // Visible nav items
  const navItems = NAV_ITEMS.filter(n => !n.adminOnly || isAdmin);

  const PANEL_LABEL: Record<StgTab, string> = {
    'company':          'Company & Branding',
    'attendance-rules': 'Attendance Rules',
    'appearance':       'Appearance',
    'layout':           'Layout & Navigation',
    'notifications':    'Notifications',
    'security':         'Security & Privacy',
  };

  return (
    <div style={{ padding: '24px' }}>

      {/* Page hero */}
      <div class="stg-page-hero">
        <div class="stg-page-hero-icon">
          <i class="fas fa-sliders" />
        </div>
        <div>
          <div class="stg-page-hero-title">Settings</div>
          <div class="stg-page-hero-sub">Manage your workspace, appearance, and account preferences</div>
        </div>
      </div>

      {/* Two-column layout */}
      <div class="stg-layout">

        {/* Left nav */}
        <nav class="stg-nav">
          {/* Group: Workspace (admin only) */}
          {isAdmin && (
            <div class="stg-nav-group">
              <div class="stg-nav-group-label">Workspace</div>
              {navItems.filter(n => n.adminOnly).map(n => (
                <NavBtn key={n.id} item={n} active={activeTab === n.id} onClick={() => setActiveTab(n.id)} />
              ))}
            </div>
          )}
          {/* Group: Personal */}
          <div class="stg-nav-group">
            <div class="stg-nav-group-label">Personal</div>
            {navItems.filter(n => !n.adminOnly && ['appearance','layout','notifications'].includes(n.id)).map(n => (
              <NavBtn key={n.id} item={n} active={activeTab === n.id} onClick={() => setActiveTab(n.id)} />
            ))}
          </div>
          {/* Group: System */}
          <div class="stg-nav-group">
            <div class="stg-nav-group-label">System</div>
            {navItems.filter(n => n.id === 'security').map(n => (
              <NavBtn key={n.id} item={n} active={activeTab === n.id} onClick={() => setActiveTab(n.id)} />
            ))}
          </div>
        </nav>

        {/* Right content */}
        <div class="stg-content">
          {/* Panel header */}
          <div class="stg-panel-header">
            {(() => {
              const n = NAV_ITEMS.find(x => x.id === activeTab)!;
              return (
                <>
                  <div class="stg-panel-icon" style={{ background: n.iconBg }}>
                    <i class={`fas ${n.icon}`} style={{ color: n.iconColor }} />
                  </div>
                  <div>
                    <div class="stg-panel-title">{PANEL_LABEL[activeTab]}</div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Panel body */}
          {activeTab === 'company' && isAdmin && (
            loadingStg ? <LoadingSkeleton /> :
            <BrandingPanel settings={settings ?? emptySettings()} onSaved={handleBrandingSaved} />
          )}
          {activeTab === 'attendance-rules' && isAdmin && (
            loadingStg ? <LoadingSkeleton /> :
            <AttendanceRulesPanel settings={settings ?? emptySettings()} />
          )}
          {activeTab === 'appearance'    && <AppearancePanel />}
          {activeTab === 'layout'        && <LayoutPanel />}
          {activeTab === 'notifications' && <NotificationsPanel />}
          {activeTab === 'security'      && <SecurityPanel />}
        </div>
      </div>
    </div>
  );
}

// ── Nav button ────────────────────────────────────────────────────────────────

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }): VNode {
  return (
    <button
      type="button"
      class={active ? 'stg-nav-item active' : 'stg-nav-item'}
      onClick={onClick}
    >
      <span class="stg-nav-icon" style={{ background: item.iconBg }}>
        <i class={`fas ${item.icon}`} style={{ color: item.iconColor }} />
      </span>
      <span class="stg-nav-label">{item.label}</span>
      <i class="fas fa-chevron-right stg-nav-arrow" />
    </button>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton(): VNode {
  return (
    <div class="stg-card">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} class="stg-form-group">
          <div style={{ height: '13px', width: '120px', background: 'var(--bg-subtle, #f5f7fb)', borderRadius: '4px', marginBottom: '8px' }} />
          <div style={{ height: '38px', background: 'var(--bg-subtle, #f5f7fb)', borderRadius: '14px' }} />
        </div>
      ))}
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
