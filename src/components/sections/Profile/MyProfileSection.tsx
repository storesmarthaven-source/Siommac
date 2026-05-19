/**
 * src/components/sections/Profile/MyProfileSection.tsx
 *
 * Self-service profile editor — every role.
 * Section id: s-profile
 * Replaces profile.js.
 *
 * Reads identity from useSessionStore (no AppState dependency).
 * After a successful save, calls setProfileImage / updates fullName in the
 * session store so all pnp pills auto-update via reactive subscriptions.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                         from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useSessionStore }                    from '@store/session';
import { toast }                              from '@store';
import { fetchMyProfile, fetchMyActivity, updateMyProfile, updateMyPassword } from './api';
import type { ProfileData, ProfileTab, ActivityEvent, StaticDoc } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function capRole(r: string | null): string {
  if (!r) return '—';
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function fmtPhone(raw: string): string {
  // Strip non-digits and format as (868) xxx-xxxx if 10+ digits
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

const STATIC_DOCS: StaticDoc[] = [
  { icon: 'fa-file-pdf', name: 'Employment Contract.pdf',     size: '1.2 MB' },
  { icon: 'fa-id-card',  name: 'ID_Card_Scan.pdf',            size: '0.8 MB' },
  { icon: 'fa-file-alt', name: 'Performance_Review_2024.pdf', size: '2.1 MB' },
];

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS: Array<{ id: ProfileTab; label: string; icon: string }> = [
  { id: 'personal',  label: 'Personal Info', icon: 'fa-user'    },
  { id: 'security',  label: 'Security',      icon: 'fa-lock'    },
  { id: 'activity',  label: 'Activity',      icon: 'fa-history' },
  { id: 'documents', label: 'Documents',     icon: 'fa-folder'  },
];

// ── Avatar component ──────────────────────────────────────────────────────────

interface AvatarProps {
  src:     string;
  initial: string;
  size:    number;
  onPick?: () => void;
}

function ProfileAvatar({ src, initial, size, onPick }: AvatarProps): VNode {
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [src]);

  const showImg = src && !error;

  return (
    <div
      onClick={onPick}
      style={{
        width:          `${size}px`,
        height:         `${size}px`,
        borderRadius:   '50%',
        background:     '#1B2D55',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        overflow:       'hidden',
        cursor:         onPick ? 'pointer' : 'default',
        position:       'relative',
        flexShrink:     0,
      }}
    >
      {showImg && (
        <img
          src={src}
          alt="Profile"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{
            width:     '100%',
            height:    '100%',
            objectFit: 'cover',
            display:   loaded ? 'block' : 'none',
          }}
        />
      )}
      {(!showImg || !loaded) && (
        <span
          style={{
            fontSize:   `${Math.round(size * 0.38)}px`,
            fontWeight: '700',
            color:      '#fff',
          }}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MyProfileSection(): VNode {
  const session        = useSessionStore();
  const setProfileImg  = useSessionStore(s => s.setProfileImage);

  const username  = session.username  ?? '';
  const fullName  = session.fullName  ?? '';
  const role      = session.role      ?? '';
  const storedImg = session.profileImage ?? '';
  const initial   = (fullName || username || '?').trim().charAt(0).toUpperCase();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<ProfileTab>('personal');

  // ── Profile data ──────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileData>({
    fullName:       fullName,
    username:       username,
    email:          '',
    phone:          '',
    department:     '',
    position:       '',
    employeeNumber: '',
    profileImage:   storedImg,
    role:           role,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);

  // ── Photo state ───────────────────────────────────────────────────────────
  const [photoB64,    setPhotoB64]    = useState<string>('');  // base64 pending upload
  const [removePhoto, setRemovePhoto] = useState<boolean>(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Preview URL: pending b64 > stored URL > ''
  const previewUrl = photoB64 || (removePhoto ? '' : profile.profileImage);

  // ── Activity ──────────────────────────────────────────────────────────────
  const [activity,        setActivity]        = useState<ActivityEvent[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // ── Personal form state ───────────────────────────────────────────────────
  const [formName,  setFormName]  = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [saving,    setSaving]    = useState(false);

  // ── Security form state ───────────────────────────────────────────────────
  const [oldPwd,      setOldPwd]      = useState('');
  const [newPwd,      setNewPwd]      = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [savingPwd,   setSavingPwd]   = useState(false);

  // ── Load profile on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingProfile(true);

    fetchMyProfile(username, ctrl.signal)
      .then(u => {
        if (cancelled) return;
        const p: ProfileData = {
          fullName:       u.fullName       || fullName,
          username:       username,
          email:          u.email          || '',
          phone:          u.phone          || '',
          department:     u.department     || '',
          position:       u.position       || '',
          employeeNumber: u.employeeNumber || '',
          profileImage:   u.profileImage   || storedImg,
          role:           role,
        };
        setProfile(p);
        setFormName(p.fullName);
        setFormEmail(p.email);
        setFormPhone(p.phone);
        // Sync photo to session store if it differs
        if (u.profileImage && u.profileImage !== storedImg) {
          setProfileImg(u.profileImage);
        }
      })
      .catch(() => { /* ignore — keep defaults */ })
      .finally(() => { if (!cancelled) setLoadingProfile(false); });

    return () => { cancelled = true; ctrl.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // ── Load activity when tab switches to activity ───────────────────────────
  useEffect(() => {
    if (tab !== 'activity') return;
    if (activity.length > 0) return; // already loaded
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingActivity(true);

    fetchMyActivity(ctrl.signal)
      .then(events => { if (!cancelled) setActivity(events); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoadingActivity(false); });

    return () => { cancelled = true; ctrl.abort(); };
  }, [tab, activity.length]);

  // ── Photo pick ────────────────────────────────────────────────────────────
  const handlePickPhoto = useCallback(() => { fileInputRef.current?.click(); }, []);

  const handleFileChange = useCallback((e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target?.result as string;
      setPhotoB64(b64);
      setRemovePhoto(false);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemovePhoto = useCallback(() => {
    setPhotoB64('');
    setRemovePhoto(true);
  }, []);

  // ── Save personal info ────────────────────────────────────────────────────
  const handleSavePersonal = useCallback(async () => {
    if (!formName.trim()) { toast.error('Full Name is required.'); return; }
    if (!formEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) {
      toast.error('A valid email is required.'); return;
    }

    setSaving(true);
    try {
      const result = await updateMyProfile({
        username,
        fullName:           formName.trim(),
        email:              formEmail.trim(),
        phone:              formPhone,
        profileImageBase64: photoB64,
        removeProfileImage: removePhoto,
        oldPassword:        '',
        newPassword:        '',
      });

      // Update session store so all pnp pills refresh reactively
      const newImg = result.profileImage ?? '';
      setProfileImg(newImg);

      // Update local form state
      setProfile(p => ({
        ...p,
        fullName:     result.fullName,
        email:        formEmail.trim(),
        phone:        formPhone,
        profileImage: newImg,
      }));
      setPhotoB64('');
      setRemovePhoto(false);

      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }, [username, formName, formEmail, formPhone, photoB64, removePhoto, setProfileImg]);

  // ── Save password ─────────────────────────────────────────────────────────
  const handleSavePassword = useCallback(async () => {
    if (!newPwd) { toast.error('Enter a new password.'); return; }
    if (newPwd.length < 6) { toast.error('New password must be at least 6 characters.'); return; }
    if (newPwd !== confirmPwd) { toast.error('Passwords do not match.'); return; }
    if (!oldPwd) { toast.error('Enter your current password.'); return; }

    setSavingPwd(true);
    try {
      await updateMyPassword({ username, fullName: profile.fullName, oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      toast.success('Password updated successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingPwd(false);
    }
  }, [username, profile.fullName, oldPwd, newPwd, confirmPwd]);

  // ── Shared input style ────────────────────────────────────────────────────
  const inputStyle = (readonly?: boolean) => ({
    width:        '100%',
    padding:      '9px 12px',
    border:       '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize:     '14px',
    background:   readonly ? '#f9fafb' : '#fff',
    color:        '#374151',
    outline:      'none',
    boxSizing:    'border-box' as const,
    cursor:       readonly ? 'default' : 'text',
  });

  const labelStyle = {
    display:      'block',
    fontSize:     '13px',
    fontWeight:   '600' as const,
    color:        '#374151',
    marginBottom: '5px',
  };

  const formGroupStyle = {
    flex:     '1 1 0',
    minWidth: '200px',
  };

  const saveBtn = (loading: boolean, label: string, icon: string) => (
    <button
      type="button"
      onClick={label === 'Save Changes' ? () => void handleSavePersonal() : () => void handleSavePassword()}
      disabled={loading}
      style={{
        padding:      '10px 22px',
        background:   '#1B2D55',
        color:        '#fff',
        border:       'none',
        borderRadius: '8px',
        fontSize:     '14px',
        fontWeight:   '600',
        cursor:       loading ? 'not-allowed' : 'pointer',
        display:      'flex',
        alignItems:   'center',
        gap:          '7px',
        opacity:      loading ? 0.7 : 1,
      }}
    >
      <i class={loading ? 'fas fa-spinner fa-spin' : `fas ${icon}`} />
      {loading ? 'Saving…' : label}
    </button>
  );

  return (
    <div style={{ padding: '24px' }}>

      {/* Hero card */}
      <div
        style={{
          background:   '#fff',
          borderRadius: '16px',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
          overflow:     'hidden',
          marginBottom: '24px',
        }}
      >
        {/* Cover */}
        <div
          style={{
            height:     '100px',
            background: 'linear-gradient(135deg, #1B2D55 0%, #2563EB 100%)',
          }}
        />

        {/* Avatar + info row */}
        <div style={{ padding: '0 24px 24px', position: 'relative' }}>
          {/* Avatar overlapping cover */}
          <div
            style={{
              display:     'flex',
              alignItems:  'flex-end',
              gap:         '16px',
              marginTop:   '-40px',
              flexWrap:    'wrap',
            }}
          >
            <div style={{ position: 'relative' }}>
              <ProfileAvatar
                src={previewUrl}
                initial={initial}
                size={88}
                onPick={handlePickPhoto}
              />
              {/* Camera badge */}
              <div
                onClick={handlePickPhoto}
                style={{
                  position:       'absolute',
                  bottom:         0,
                  right:          0,
                  width:          '26px',
                  height:         '26px',
                  borderRadius:   '50%',
                  background:     '#fff',
                  border:         '2px solid #e5e7eb',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  cursor:         'pointer',
                  fontSize:       '11px',
                  color:          '#1B2D55',
                }}
              >
                <i class="fas fa-camera" />
              </div>
            </div>

            <div style={{ paddingBottom: '4px', flex: 1, minWidth: '0' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>
                {loadingProfile ? '—' : profile.fullName}
              </div>
              <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
                {capRole(role)}
                {profile.department ? ` · ${profile.department}` : ''}
              </div>
              <span
                style={{
                  display:      'inline-flex',
                  alignItems:   'center',
                  gap:          '4px',
                  marginTop:    '6px',
                  padding:      '2px 10px',
                  borderRadius: '999px',
                  background:   '#DCFCE7',
                  color:        '#166534',
                  fontSize:     '12px',
                  fontWeight:   '600',
                }}
              >
                <i class="fas fa-check-circle" /> Active
              </span>
            </div>

            {/* Remove photo button */}
            {previewUrl && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                style={{
                  padding:      '7px 14px',
                  border:       '1px solid #fca5a5',
                  borderRadius: '8px',
                  background:   '#fff',
                  color:        '#DC2626',
                  fontSize:     '12px',
                  fontWeight:   '500',
                  cursor:       'pointer',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          '5px',
                  alignSelf:    'flex-end',
                  marginBottom: '4px',
                }}
              >
                <i class="fas fa-trash" /> Remove Photo
              </button>
            )}
          </div>

          {/* Contact chips */}
          <div
            style={{
              display:   'flex',
              gap:       '20px',
              flexWrap:  'wrap',
              marginTop: '16px',
            }}
          >
            {[
              { icon: 'fa-envelope', value: profile.email        || '—' },
              { icon: 'fa-phone',    value: profile.phone        || '—' },
              { icon: 'fa-building', value: profile.department   || '—' },
              { icon: 'fa-id-badge', value: profile.username     || '—' },
              { icon: 'fa-briefcase',value: profile.position     || '—' },
            ].map(c => (
              <div
                key={c.icon}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6B7280' }}
              >
                <i class={`fas ${c.icon}`} style={{ color: '#9CA3AF' }} />
                {c.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Tabs bar */}
      <div
        style={{
          display:      'flex',
          gap:          '4px',
          marginBottom: '20px',
          background:   '#fff',
          borderRadius: '10px',
          padding:      '4px',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.06)',
          overflowX:    'auto',
        }}
      >
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding:      '8px 18px',
              border:       'none',
              borderRadius: '7px',
              fontSize:     '13px',
              fontWeight:   '600',
              cursor:       'pointer',
              background:   tab === t.id ? '#1B2D55' : 'transparent',
              color:        tab === t.id ? '#fff'    : '#6B7280',
              display:      'flex',
              alignItems:   'center',
              gap:          '7px',
              whiteSpace:   'nowrap',
              transition:   'background 0.15s',
            }}
          >
            <i class={`fas ${t.icon}`} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content card */}
      <div
        style={{
          background:   '#fff',
          borderRadius: '12px',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
          padding:      '24px',
        }}
      >

        {/* ── Personal Info ─────────────────────────────────────────────────── */}
        {tab === 'personal' && (
          <div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Full Name</label>
                <input
                  type="text"
                  value={formName}
                  onInput={e => setFormName((e.target as HTMLInputElement).value)}
                  placeholder="Full name"
                  style={inputStyle()}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Employee ID</label>
                <input
                  type="text"
                  value={profile.employeeNumber}
                  readonly
                  style={{ ...inputStyle(true), fontFamily: 'monospace' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Email Address</label>
                <input
                  type="email"
                  value={formEmail}
                  onInput={e => setFormEmail((e.target as HTMLInputElement).value)}
                  placeholder="your@email.com"
                  style={inputStyle()}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Phone Number</label>
                <input
                  type="tel"
                  value={formPhone}
                  onInput={e => setFormPhone((e.target as HTMLInputElement).value)}
                  placeholder="(868) xxx-xxxx"
                  style={inputStyle()}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Department</label>
                <input type="text" value={profile.department} readonly style={inputStyle(true)} />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Position</label>
                <input type="text" value={profile.position} readonly style={inputStyle(true)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '24px' }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Username</label>
                <input type="text" value={profile.username} readonly style={inputStyle(true)} />
              </div>
              <div style={formGroupStyle} />
            </div>
            {saveBtn(saving, 'Save Changes', 'fa-save')}
          </div>
        )}

        {/* ── Security ──────────────────────────────────────────────────────── */}
        {tab === 'security' && (
          <div>
            <div style={{ maxWidth: '420px', marginBottom: '20px' }}>
              <label style={labelStyle}>Current Password</label>
              <input
                type="password"
                value={oldPwd}
                onInput={e => setOldPwd((e.target as HTMLInputElement).value)}
                placeholder="Required to change password"
                style={inputStyle()}
              />
            </div>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', maxWidth: '860px', marginBottom: '20px' }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>New Password</label>
                <input
                  type="password"
                  value={newPwd}
                  onInput={e => setNewPwd((e.target as HTMLInputElement).value)}
                  placeholder="Min. 6 characters"
                  style={inputStyle()}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onInput={e => setConfirmPwd((e.target as HTMLInputElement).value)}
                  placeholder="Confirm new password"
                  style={inputStyle()}
                />
              </div>
            </div>
            <div style={{ maxWidth: '420px', marginBottom: '24px' }}>
              <label style={labelStyle}>Two-Factor Authentication</label>
              <select
                disabled
                style={{ ...inputStyle(true), opacity: 0.6, cursor: 'not-allowed' }}
              >
                <option value="disabled">Disabled (coming soon)</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleSavePassword()}
              disabled={savingPwd}
              style={{
                padding:      '10px 22px',
                background:   '#1B2D55',
                color:        '#fff',
                border:       'none',
                borderRadius: '8px',
                fontSize:     '14px',
                fontWeight:   '600',
                cursor:       savingPwd ? 'not-allowed' : 'pointer',
                display:      'flex',
                alignItems:   'center',
                gap:          '7px',
                opacity:      savingPwd ? 0.7 : 1,
              }}
            >
              <i class={savingPwd ? 'fas fa-spinner fa-spin' : 'fas fa-shield-alt'} />
              {savingPwd ? 'Updating…' : 'Update Security'}
            </button>
          </div>
        )}

        {/* ── Activity ──────────────────────────────────────────────────────── */}
        {tab === 'activity' && (
          <div>
            {loadingActivity ? (
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#f3f4f6', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: '14px', background: '#f3f4f6', borderRadius: '4px', marginBottom: '6px', width: '60%' }} />
                    <div style={{ height: '12px', background: '#f3f4f6', borderRadius: '4px', width: '40%' }} />
                  </div>
                </div>
              ))
            ) : activity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9CA3AF' }}>
                <i class="fas fa-history" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', color: '#D1D5DB' }} />
                No recent activity
              </div>
            ) : (
              activity.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div
                    style={{
                      width:          '36px',
                      height:         '36px',
                      borderRadius:   '50%',
                      background:     '#EFF6FF',
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'center',
                      flexShrink:     0,
                    }}
                  >
                    <i class={`fas ${ev.icon}`} style={{ fontSize: '14px', color: '#1E40AF' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{ev.title}</div>
                    <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>{ev.date}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Documents ─────────────────────────────────────────────────────── */}
        {tab === 'documents' && (
          <div>
            {role === 'employee' ? (
              <>
                {STATIC_DOCS.map(doc => (
                  <div
                    key={doc.name}
                    style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          '14px',
                      padding:      '14px 0',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <div
                      style={{
                        width:          '40px',
                        height:         '40px',
                        borderRadius:   '8px',
                        background:     '#EFF6FF',
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'center',
                        flexShrink:     0,
                      }}
                    >
                      <i class={`fas ${doc.icon}`} style={{ color: '#1E40AF', fontSize: '16px' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}>{doc.name}</div>
                      <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{doc.size}</div>
                    </div>
                    <button
                      type="button"
                      style={{
                        padding:      '6px 14px',
                        border:       '1px solid #e5e7eb',
                        borderRadius: '7px',
                        background:   '#fff',
                        fontSize:     '12px',
                        fontWeight:   '500',
                        cursor:       'pointer',
                        color:        '#374151',
                        display:      'flex',
                        alignItems:   'center',
                        gap:          '5px',
                      }}
                    >
                      <i class="fas fa-download" /> Download
                    </button>
                  </div>
                ))}
                <div style={{ marginTop: '20px', textAlign: 'center' }}>
                  <button
                    type="button"
                    style={{
                      padding:      '10px 22px',
                      border:       '2px solid #1B2D55',
                      borderRadius: '8px',
                      background:   '#fff',
                      color:        '#1B2D55',
                      fontSize:     '14px',
                      fontWeight:   '600',
                      cursor:       'pointer',
                      display:      'inline-flex',
                      alignItems:   'center',
                      gap:          '7px',
                    }}
                  >
                    <i class="fas fa-upload" /> Upload New Document
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 24px', color: '#9CA3AF' }}>
                <i class="fas fa-folder-open" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', color: '#D1D5DB' }} />
                Documents are available for employee accounts.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
