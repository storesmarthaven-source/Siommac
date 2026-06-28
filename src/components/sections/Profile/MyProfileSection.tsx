/**
 * src/components/sections/Profile/MyProfileSection.tsx
 *
 * Self-service profile editor — every role. Section id: s-profile.
 *
 * STANDARD page shape: PageHeader (title + ProfilePill) → a single scroll of clean settings
 * cards (Account Information · Security · Recent Activity). All fields are wired to the real
 * self-service API; readonly fields (department/position/username/employee id) come from the
 * record. After a save we update the session store so every ProfilePill refreshes.
 *
 * Styling: profilePage.css (scoped `.pf`).
 */
import { type VNode } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { PageHeader } from '@ui';
import { useSessionStore } from '@store/session';
import { toast } from '@store';
import { fetchMyProfile, fetchMyActivity, updateMyProfile, updateMyPassword, uploadMyProfilePhoto, removeMyProfilePhoto } from './api';
import type { ProfileData, ActivityEvent } from './types';
import './profilePage.css';

function capRole(r: string | null): string {
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : '—';
}

// ── Avatar ──────────────────────────────────────────────────────────────────────
function ProfileAvatar({ src, initial, size, onPick }: { src: string; initial: string; size: number; onPick?: () => void }): VNode {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setLoaded(false); setError(false); }, [src]);
  const showImg = src && !error;
  return (
    <div onClick={onPick} style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#1B2D55', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: onPick ? 'pointer' : 'default', flexShrink: 0 }}>
      {showImg && <img src={src} alt="Profile" onLoad={() => setLoaded(true)} onError={() => setError(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: loaded ? 'block' : 'none' }} />}
      {(!showImg || !loaded) && <span style={{ fontSize: `${Math.round(size * 0.38)}px`, fontWeight: 'var(--font-weight-bold)', color: '#fff' }}>{initial}</span>}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export function MyProfileSection(): VNode {
  const session       = useSessionStore();
  const setProfileImg = useSessionStore(s => s.setProfileImage);

  const username  = session.username ?? '';
  const fullName  = session.fullName ?? '';
  const role      = session.role ?? '';
  const storedImg = session.profileImage ?? '';
  const initial   = (fullName || username || '?').trim().charAt(0).toUpperCase();

  const [profile, setProfile] = useState<ProfileData>({
    fullName, username, email: '', phone: '', department: '', position: '', employeeNumber: '', profileImage: storedImg, role,
  });
  const [loadingProfile, setLoadingProfile] = useState(true);

  // photo
  const [photoB64, setPhotoB64] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = photoB64 || (removePhoto ? '' : profile.profileImage);

  // activity
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  // personal form
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // security form
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // ── load profile ──
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingProfile(true);
    fetchMyProfile(username, ctrl.signal)
      .then(u => {
        if (cancelled) return;
        const p: ProfileData = {
          fullName: u.fullName || fullName, username,
          email: u.email || '', phone: u.phone || '', department: u.department || '',
          position: u.position || '', employeeNumber: u.employeeNumber || '',
          profileImage: u.profileImage || storedImg, role,
        };
        setProfile(p); setFormName(p.fullName); setFormEmail(p.email); setFormPhone(p.phone);
        if (u.profileImage && u.profileImage !== storedImg) setProfileImg(u.profileImage);
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => { if (!cancelled) setLoadingProfile(false); });
    return () => { cancelled = true; ctrl.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // ── load activity ──
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadingActivity(true);
    fetchMyActivity(ctrl.signal)
      .then(events => { if (!cancelled) setActivity(events); })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoadingActivity(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  // ── photo handlers ──
  const handlePickPhoto = useCallback(() => { fileInputRef.current?.click(); }, []);
  const handleFileChange = useCallback((e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = ev => { setPhotoB64(ev.target?.result as string); setRemovePhoto(false); };
    reader.readAsDataURL(file);
  }, []);
  const handleRemovePhoto = useCallback(() => { setPhotoB64(''); setPhotoFile(null); setRemovePhoto(true); }, []);

  // ── save personal ──
  const handleSavePersonal = useCallback(async () => {
    if (!formName.trim()) { toast.error('Full Name is required.'); return; }
    if (!formEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail)) { toast.error('A valid email is required.'); return; }
    setSaving(true);
    try {
      let newImg: string | null | undefined;
      if (removePhoto) ({ profileImage: newImg } = await removeMyProfilePhoto());
      else if (photoFile) ({ profileImage: newImg } = await uploadMyProfilePhoto(photoFile));
      const result = await updateMyProfile({
        username, fullName: formName.trim(), email: formEmail.trim(), phone: formPhone,
        profileImageBase64: '', removeProfileImage: false, oldPassword: '', newPassword: '',
      });
      if (newImg !== undefined) setProfileImg(newImg ?? '');
      const shownImg = newImg !== undefined ? (newImg ?? '') : (result.profileImage ?? profile.profileImage);
      setProfile(p => ({ ...p, fullName: result.fullName, email: formEmail.trim(), phone: formPhone, profileImage: shownImg }));
      setPhotoB64(''); setPhotoFile(null); setRemovePhoto(false);
      toast.success('Profile updated successfully!');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Update failed'); }
    finally { setSaving(false); }
  }, [username, formName, formEmail, formPhone, photoFile, removePhoto, setProfileImg, profile.profileImage]);

  // ── save password ──
  const handleSavePassword = useCallback(async () => {
    if (!newPwd) { toast.error('Enter a new password.'); return; }
    if (newPwd.length < 6) { toast.error('New password must be at least 6 characters.'); return; }
    if (newPwd !== confirmPwd) { toast.error('Passwords do not match.'); return; }
    if (!oldPwd) { toast.error('Enter your current password.'); return; }
    setSavingPwd(true);
    try {
      await updateMyPassword({ username, fullName: profile.fullName, oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      toast.success('Password updated successfully!');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Update failed'); }
    finally { setSavingPwd(false); }
  }, [username, profile.fullName, oldPwd, newPwd, confirmPwd]);

  const chips: { icon: string; value: string }[] = [
    { icon: 'fa-envelope', value: profile.email || '—' },
    { icon: 'fa-phone', value: profile.phone || '—' },
    { icon: 'fa-building', value: profile.department || '—' },
    { icon: 'fa-id-badge', value: profile.username || '—' },
    { icon: 'fa-briefcase', value: profile.position || '—' },
  ];

  return (
    <div class="pf-page">
      <PageHeader icon="fa-user" title="My Profile" sub="Manage your personal information, security and activity." />

      <div class="pf">
        {/* hero */}
        <div class="pf-hero">
          <div class="pf-photo" onClick={handlePickPhoto}>
            <ProfileAvatar src={previewUrl} initial={initial} size={88} onPick={handlePickPhoto} />
            <span class="pf-cam"><i class="fas fa-camera" /></span>
          </div>
          <div class="pf-id">
            <div class="pf-name">{loadingProfile ? '—' : profile.fullName}</div>
            <div class="pf-role">{capRole(role)}{profile.department ? ` · ${profile.department}` : ''}</div>
            <div class="pf-chips">
              {chips.map(c => <div key={c.icon} class="pf-chip"><i class={`fas ${c.icon}`} />{c.value}</div>)}
            </div>
          </div>
          <div class="pf-photo-actions">
            <button type="button" class="pf-btn ghost sm" onClick={handlePickPhoto}><i class="fas fa-camera" /> Change photo</button>
            {previewUrl && <button type="button" class="pf-btn danger sm" onClick={handleRemovePhoto}><i class="fas fa-trash" /> Remove</button>}
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

        {/* Account information */}
        <div class="pf-card">
          <div class="pf-card-head"><i class="fas fa-user" /><h2>Account information</h2></div>
          <div class="pf-card-body">
            <div class="pf-grid">
              <div class="pf-field">
                <label>Full name</label>
                <input type="text" value={formName} onInput={e => setFormName((e.target as HTMLInputElement).value)} placeholder="Full name" />
              </div>
              <div class="pf-field">
                <label>Employee ID</label>
                <input type="text" value={profile.employeeNumber} readonly class="pf-mono" />
              </div>
              <div class="pf-field">
                <label>Email address</label>
                <input type="email" value={formEmail} onInput={e => setFormEmail((e.target as HTMLInputElement).value)} placeholder="your@email.com" />
              </div>
              <div class="pf-field">
                <label>Phone number</label>
                <input type="tel" value={formPhone} onInput={e => setFormPhone((e.target as HTMLInputElement).value)} placeholder="(868) xxx-xxxx" />
              </div>
              <div class="pf-field">
                <label>Department</label>
                <input type="text" value={profile.department} readonly />
              </div>
              <div class="pf-field">
                <label>Position</label>
                <input type="text" value={profile.position} readonly />
              </div>
              <div class="pf-field">
                <label>Username</label>
                <input type="text" value={profile.username} readonly />
              </div>
              <div class="pf-field">
                <label>Role</label>
                <input type="text" value={capRole(role)} readonly />
              </div>
            </div>
            <div class="pf-actions">
              <button type="button" class="pf-btn" onClick={() => void handleSavePersonal()} disabled={saving}>
                <i class={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>

        {/* Security */}
        <div class="pf-card">
          <div class="pf-card-head"><i class="fas fa-lock" /><h2>Security</h2><span class="pf-card-sub">Update the password used to sign in.</span></div>
          <div class="pf-card-body">
            <div class="pf-grid">
              <div class="pf-field" style={{ gridColumn: '1 / -1' }}>
                <label>Current password</label>
                <input type="password" value={oldPwd} onInput={e => setOldPwd((e.target as HTMLInputElement).value)} placeholder="Required to change password" />
              </div>
              <div class="pf-field">
                <label>New password</label>
                <input type="password" value={newPwd} onInput={e => setNewPwd((e.target as HTMLInputElement).value)} placeholder="Min. 6 characters" />
                <span class="pf-hint">Use at least 6 characters.</span>
              </div>
              <div class="pf-field">
                <label>Confirm new password</label>
                <input type="password" value={confirmPwd} onInput={e => setConfirmPwd((e.target as HTMLInputElement).value)} placeholder="Confirm new password" />
              </div>
              <div class="pf-field">
                <label>Two-factor authentication</label>
                <select disabled><option>Disabled (coming soon)</option></select>
              </div>
            </div>
            <div class="pf-actions">
              <button type="button" class="pf-btn" onClick={() => void handleSavePassword()} disabled={savingPwd}>
                <i class={savingPwd ? 'fas fa-spinner fa-spin' : 'fas fa-shield-alt'} /> {savingPwd ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div class="pf-card">
          <div class="pf-card-head"><i class="fas fa-history" /><h2>Recent activity</h2></div>
          <div class="pf-card-body">
            {loadingActivity ? (
              <div class="pf-feed">{Array.from({ length: 4 }, (_, i) => <div key={i} class="pf-skel" />)}</div>
            ) : activity.length === 0 ? (
              <div class="pf-empty"><i class="fas fa-history" />No recent activity</div>
            ) : (
              <div class="pf-feed">
                {activity.map((ev, i) => (
                  <div key={i} class="pf-feed-item">
                    <div class="pf-feed-ico"><i class={`fas ${ev.icon}`} /></div>
                    <div><div class="pf-feed-title">{ev.title}</div><div class="pf-feed-date">{ev.date}</div></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
