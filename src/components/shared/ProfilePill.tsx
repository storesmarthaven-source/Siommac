/**
 * src/components/shared/ProfilePill.tsx
 *
 * The single reusable profile + notification pill for page heroes.
 *
 * Fully self-contained — no shared element ids, so any number of instances can
 * exist without collisions:
 *   • Self-populating: reads name/role/avatar from the session store, so it is
 *     correct regardless of when it mounts (fixes the lazily-mounted hero where
 *     attSystem's one-time id population had already run).
 *   • Id-free actions: icon buttons carry data-pill-action="notif|msg|ticket";
 *     NavController's delegated handler opens the shared header modal positioned
 *     under the clicked icon.
 *   • Id-free badges: count spans carry data-pill-badge="…"; badgeSync updates
 *     them by attribute.
 *   • Profile area routes to My Profile.
 *
 * Drop <ProfilePill /> into any hero. Use variant="onDark" on dark panels.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useSessionStore, selectFullName, selectRole } from '@store/session';
import { dialog } from '@lib/dialog';

// ── Lucide line-icons (the app's icon language) ───────────────────────────────
// Hand-drawn to match the Lucide 24×24 / currentColor / round-cap style used across
// the shell, so the menu doesn't fall back to Font Awesome glyphs.
const lIco = (inner: ComponentChildren, sw = 1.8, size = 19): VNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{inner}</svg>
);
const IcUser     = (): VNode => lIco(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const IcSettings = (): VNode => lIco(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>, 1.5);
const IcAbout    = (): VNode => lIco(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
const IcLogout   = (): VNode => lIco(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></>);

function roleLabel(role: string | null): string {
  switch (role) {
    case 'superadmin': return 'Super Administrator';
    case 'admin':      return 'Administrator';
    case 'manager':    return 'Manager';
    case 'employee':   return 'Employee';
    default:           return role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  }
}

function gotoProfile(): void {
  (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav?.showSection?.('s-profile');
}

function gotoSettings(): void {
  (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav?.showSection?.('s-settings');
}

function gotoAbout(): void {
  (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav?.showSection?.('s-about');
}

function doLogout(): void {
  (window as unknown as { handleLogout?: () => void }).handleLogout?.();
}

export interface ProfilePillProps {
  /** Visual variant: 'light' (navy pill, default) or 'onDark' (for dark heroes). */
  variant?: 'light' | 'onDark';
  /** When true, render the notification/message/ticket icons BEFORE the profile
   *  (icons on the left, profile pill in the far-right corner). Used by the app
   *  top bar; other heroes keep the default profile-first order. */
  iconsFirst?: boolean;
}

export function ProfilePill({ variant = 'light', iconsFirst = false }: ProfilePillProps): VNode {
  const fullName  = useSessionStore(selectFullName);
  const role      = useSessionStore(selectRole);
  const avatarUrl = useSessionStore(s => s.profileImage);
  const username  = useSessionStore(s => s.username);

  const name    = fullName || username || 'User';
  const initial = (name.trim()[0] ?? 'U').toUpperCase();

  const [menuOpen, setMenuOpen] = useState(false);
  // Menu is position:fixed (positioned from the trigger) so it escapes the top bar's
  // overflow:hidden clipping.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const openMenu = (): void => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      // Aligned to the pill: derive width from the ROUNDED left/right edges (not the raw
      // width) so both the left and right edges land on the pill's exact pixels — avoids
      // a 1px drift. box-sizing:border-box keeps the menu's border inside this width.
      const left  = Math.round(r.left);
      const width = Math.round(r.right) - left;
      setMenuPos({ top: Math.round(r.bottom), left, width });
    }
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

  const confirmLogout = async (): Promise<void> => {
    setMenuOpen(false);
    const ok = await dialog.confirm({
      title: 'Log out?',
      text: 'You will be signed out of Siomac and returned to the login screen.',
      confirmText: 'Log out', danger: true,
    });
    if (ok) doLogout();
  };

  const profile = (
    <div class="pnp-profile-wrap" ref={wrapRef}>
      <button type="button" class="pnp-profile" onClick={() => menuOpen ? setMenuOpen(false) : openMenu()} title="Account menu"
        aria-haspopup="menu" aria-expanded={menuOpen}>
        <span class="pnp-avatar">
          {avatarUrl
            ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
            : initial}
        </span>
        <span class="pnp-info">
          <span class="pnp-name">{name}</span>
          <span class="pnp-role">{roleLabel(role)}</span>
        </span>
        <span class="pnp-caret-box">
          <i class={`fas fa-chevron-${menuOpen ? 'up' : 'down'} pnp-caret`} aria-hidden="true" />
        </span>
      </button>
      {menuOpen && (
        <div class="pnp-menu" role="menu" style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
          <div class="pnp-menu-group">
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); gotoProfile(); }}>
              <IcUser /><span>My Profile</span>
            </button>
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); gotoSettings(); }}>
              <IcSettings /><span>Settings</span>
            </button>
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); gotoAbout(); }}>
              <IcAbout /><span>About</span>
            </button>
          </div>
          <div class="pnp-menu-sep" />
          <div class="pnp-menu-group">
            <button type="button" class="pnp-menu-item pnp-menu-danger" role="menuitem" onClick={() => void confirmLogout()}>
              <IcLogout /><span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
  const icons = (
    <div class="pnp-icons">
      <button type="button" class="pnp-icon-btn" data-pill-action="notif" title="Notifications">
        <i class="fas fa-bell" /><span class="pnp-badge" data-pill-badge="notif" style={{ display: 'none' }} />
      </button>
      <button type="button" class="pnp-icon-btn" data-pill-action="msg" title="Messages">
        <i class="fas fa-comment-dots" /><span class="pnp-badge" data-pill-badge="msg" style={{ display: 'none' }} />
      </button>
      <button type="button" class="pnp-icon-btn" data-pill-action="ticket" title="Support Tickets">
        <i class="fas fa-ticket-alt" /><span class="pnp-badge pnp-badge-gold" data-pill-badge="ticket" style={{ display: 'none' }} />
      </button>
    </div>
  );

  return (
    <div class={`profile-notif-pill${variant === 'onDark' ? ' pnp-on-dark' : ''}`}>
      {iconsFirst
        ? <>{icons}<div class="pnp-divider" />{profile}</>
        : <>{profile}<div class="pnp-divider" />{icons}</>}
    </div>
  );
}
