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
 * Presentation uses the branded `.profile-*` design system defined in
 * assets/styles/profile.css (navy banner, avatar section, detail sections,
 * branded form groups + save button) rather than ad-hoc inline styles.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                         from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useSessionStore }                    from '@store/session';
import { toast }                              from '@store';
import { fetchMyProfile, fetchMyActivity, updateMyProfile, updateMyPassword, uploadMyProfilePhoto, removeMyProfilePhoto } from './api';
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
            fontWeight: 'var(--font-weight-bold)',
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
  const [photoB64,    setPhotoB64]    = useState<string>('');  // data-URL preview only
  const [photoFile,   setPhotoFile]   = useState<File | null>(null); // raw file → presigned upload
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
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = ev => {
      setPhotoB64(ev.target?.result as string);  // preview only
      setRemovePhoto(false);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemovePhoto = useCallback(() => {
    setPhotoB64('');
    setPhotoFile(null);
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
      // 1. Photo (presigned upload to the public avatars bucket) — separate from
      //    the text update. Tracks the new public URL to reflect into the session.
      let newImg: string | null | undefined;
      if (removePhoto) {
        ({ profileImage: newImg } = await removeMyProfilePhoto());
      } else if (photoFile) {
        ({ profileImage: newImg } = await uploadMyProfilePhoto(photoFile));
      }

      // 2. Name / email / phone (no photo fields — handled above).
      const result = await updateMyProfile({
        username,
        fullName:           formName.trim(),
        email:              formEmail.trim(),
        phone:              formPhone,
        profileImageBase64: '',
        removeProfileImage: false,
        oldPassword:        '',
        newPassword:        '',
      });

      // Reflect the new avatar into the session store so every ProfilePill refreshes.
      if (newImg !== undefined) setProfileImg(newImg ?? '');
      const shownImg = newImg !== undefined ? (newImg ?? '') : (result.profileImage ?? profile.profileImage);

      setProfile(p => ({
        ...p,
        fullName:     result.fullName,
        email:        formEmail.trim(),
        phone:        formPhone,
        profileImage: shownImg,
      }));
      setPhotoB64('');
      setPhotoFile(null);
      setRemovePhoto(false);

      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }, [username, formName, formEmail, formPhone, photoFile, removePhoto, setProfileImg, profile.profileImage]);

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

  return (
    <div class="data-section">

      {/* Page header */}
      <div class="profile-page-header">
        <div>
          <h1 class="profile-page-title">My Profile</h1>
          <p class="profile-page-sub">Manage your personal information, security and activity.</p>
        </div>
      </div>

      {/* Hero card */}
      <div class="profile-card">
        {/* Cover banner */}
        <div class="profile-banner" />

        {/* Avatar overlapping cover */}
        <div class="profile-avatar-section">
          <div class="profile-avatar-wrapper" onClick={handlePickPhoto}>
            <ProfileAvatar
              src={previewUrl}
              initial={initial}
              size={88}
              onPick={handlePickPhoto}
            />
            {/* Camera badge */}
            <div class="profile-avatar-edit">
              <i class="fas fa-camera" />
            </div>
          </div>
        </div>

        {/* Identity + meta */}
        <div class="profile-info-block">
          <div class="profile-display-name">
            {loadingProfile ? '—' : profile.fullName}
          </div>
          <div>
            <span class="profile-display-role">
              {capRole(role)}
              {profile.department ? ` · ${profile.department}` : ''}
            </span>
          </div>

          {/* Contact chips */}
          <div class="profile-display-meta">
            {[
              { icon: 'fa-envelope',  value: profile.email      || '—' },
              { icon: 'fa-phone',     value: profile.phone      || '—' },
              { icon: 'fa-building',  value: profile.department || '—' },
              { icon: 'fa-id-badge',  value: profile.username   || '—' },
              { icon: 'fa-briefcase', value: profile.position   || '—' },
            ].map(c => (
              <div key={c.icon} class="profile-meta-item">
                <i class={`fas ${c.icon}`} />
                {c.value}
              </div>
            ))}
          </div>

          {/* Remove photo button */}
          {previewUrl && (
            <button
              type="button"
              class="profile-remove-photo-btn"
              onClick={handleRemovePhoto}
            >
              <i class="fas fa-trash" /> Remove Photo
            </button>
          )}
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
      <div class="section-header" style={{ marginTop: '20px' }}>
        <div class="section-actions">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              class={tab === t.id ? 'profile-btn-save' : 'profile-remove-photo-btn'}
              style={{
                width:     'auto',
                marginTop: 0,
                ...(tab === t.id ? {} : { borderColor: 'var(--border)', color: 'var(--text-muted)' }),
              }}
              onClick={() => setTab(t.id)}
            >
              <i class={`fas ${t.icon}`} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content card */}
      <div class="profile-card" style={{ borderRadius: '24px' }}>
        <div class="profile-detail-section" style={{ background: 'white', borderRadius: '24px' }}>

          {/* ── Personal Info ─────────────────────────────────────────────────── */}
          {tab === 'personal' && (
            <div>
              <div class="profile-section-title">
                <i class="fas fa-user" /> Personal Information
              </div>
              <div class="profile-form-row">
                <div class="profile-form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={formName}
                    onInput={e => setFormName((e.target as HTMLInputElement).value)}
                    placeholder="Full name"
                  />
                </div>
                <div class="profile-form-group">
                  <label>Employee ID</label>
                  <input
                    type="text"
                    value={profile.employeeNumber}
                    readonly
                    class="profile-input-readonly"
                    style={{ fontFamily: 'monospace' }}
                  />
                </div>
              </div>
              <div class="profile-form-row">
                <div class="profile-form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={formEmail}
                    onInput={e => setFormEmail((e.target as HTMLInputElement).value)}
                    placeholder="your@email.com"
                  />
                </div>
                <div class="profile-form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onInput={e => setFormPhone((e.target as HTMLInputElement).value)}
                    placeholder="(868) xxx-xxxx"
                  />
                </div>
              </div>
              <div class="profile-form-row">
                <div class="profile-form-group">
                  <label>Department</label>
                  <input type="text" value={profile.department} readonly class="profile-input-readonly" />
                </div>
                <div class="profile-form-group">
                  <label>Position</label>
                  <input type="text" value={profile.position} readonly class="profile-input-readonly" />
                </div>
              </div>
              <div class="profile-form-row">
                <div class="profile-form-group">
                  <label>Username</label>
                  <input type="text" value={profile.username} readonly class="profile-input-readonly" />
                </div>
                <div class="profile-form-group" />
              </div>
              <button
                type="button"
                class="profile-btn-save"
                onClick={() => void handleSavePersonal()}
                disabled={saving}
                style={saving ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              >
                <i class={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'} />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}

          {/* ── Security ──────────────────────────────────────────────────────── */}
          {tab === 'security' && (
            <div>
              <div class="profile-section-title">
                <i class="fas fa-lock" /> Security
              </div>
              <div class="profile-form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={oldPwd}
                  onInput={e => setOldPwd((e.target as HTMLInputElement).value)}
                  placeholder="Required to change password"
                />
              </div>
              <div class="profile-form-row">
                <div class="profile-form-group">
                  <label>New Password</label>
                  <input
                    type="password"
                    value={newPwd}
                    onInput={e => setNewPwd((e.target as HTMLInputElement).value)}
                    placeholder="Min. 6 characters"
                  />
                  <div class="profile-pwd-hint">Use at least 6 characters.</div>
                </div>
                <div class="profile-form-group">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPwd}
                    onInput={e => setConfirmPwd((e.target as HTMLInputElement).value)}
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
              <div class="profile-form-group">
                <label>Two-Factor Authentication</label>
                <select disabled class="profile-input-readonly" style={{ opacity: 0.6 }}>
                  <option value="disabled">Disabled (coming soon)</option>
                </select>
              </div>
              <button
                type="button"
                class="profile-btn-save"
                onClick={() => void handleSavePassword()}
                disabled={savingPwd}
                style={savingPwd ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              >
                <i class={savingPwd ? 'fas fa-spinner fa-spin' : 'fas fa-shield-alt'} />
                {savingPwd ? 'Updating…' : 'Update Security'}
              </button>
            </div>
          )}

          {/* ── Activity ──────────────────────────────────────────────────────── */}
          {tab === 'activity' && (
            <div class="recent-activity-section">
              <div class="profile-section-title">
                <i class="fas fa-history" /> Recent Activity
              </div>
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
                <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-muted)' }}>
                  <i class="fas fa-history" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', color: '#D1D5DB' }} />
                  No recent activity
                </div>
              ) : (
                activity.map((ev, i) => (
                  <div key={i} class="profile-meta-item" style={{ alignItems: 'flex-start', marginBottom: '16px', gap: '12px' }}>
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
                      <i class={`fas ${ev.icon}`} style={{ fontSize: '14px', color: 'var(--siomac-navy)' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--siomac-navy)' }}>{ev.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{ev.date}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Documents ─────────────────────────────────────────────────────── */}
          {tab === 'documents' && (
            <div>
              <div class="profile-section-title">
                <i class="fas fa-folder" /> Documents
              </div>
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
                        borderBottom: '1px solid var(--border)',
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
                        <i class={`fas ${doc.icon}`} style={{ color: 'var(--siomac-navy)', fontSize: '16px' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--siomac-navy)' }}>{doc.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{doc.size}</div>
                      </div>
                      <button
                        type="button"
                        class="profile-remove-photo-btn"
                        style={{ marginTop: 0, borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        <i class="fas fa-download" /> Download
                      </button>
                    </div>
                  ))}
                  <div style={{ marginTop: '20px', textAlign: 'center' }}>
                    <button
                      type="button"
                      class="profile-btn-save"
                      style={{ width: 'auto', display: 'inline-flex' }}
                    >
                      <i class="fas fa-upload" /> Upload New Document
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-muted)' }}>
                  <i class="fas fa-folder-open" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', color: '#D1D5DB' }} />
                  Documents are available for employee accounts.
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
