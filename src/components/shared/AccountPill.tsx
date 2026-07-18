/**
 * src/components/shared/AccountPill.tsx
 *
 * The account pill: avatar + name/role + notification/message/ticket quick actions
 * + account dropdown (My Profile · Settings · About · Log out). Rendered INSIDE the
 * UserPill global top bar (src/components/shared/UserPill.tsx) — it is the "who am I
 * + quick actions" cluster on the bar's right edge.
 *
 * Fully self-contained — no shared element ids, so any number of instances can
 * exist without collisions:
 *   • Self-populating: reads name/role/avatar from the session store, so it is
 *     correct regardless of when it mounts.
 *   • Id-free actions: icon buttons carry data-pill-action="notif|msg|ticket";
 *     NavController's delegated handler opens the shared header modal positioned
 *     under the clicked icon.
 *   • Id-free badges: count spans carry data-pill-badge="…"; badgeSync updates
 *     them by attribute.
 *   • Profile area routes to My Profile.
 *
 * Customization:
 *   variant="onDark"                → styling for dark panels
 *   iconsFirst                      → icons on the left, profile in the corner (top bar)
 *   showNotif / showMsg / showTicket → toggle each quick-action icon (all default true)
 *   compact                         → avatar + caret only (hides the name/role text)
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useSessionStore, selectFullName, selectRole } from '@store/session';
import { useUiStore, selectTheme } from '@store/ui';
import { dialog } from '@lib/dialog';

// ── Lucide line-icons (the app's icon language) ───────────────────────────────
const lIco = (inner: ComponentChildren, sw = 1.8, size = 19): VNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{inner}</svg>
);
const IcUser     = (): VNode => lIco(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const IcSettings = (): VNode => lIco(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>, 1.5);
const IcAbout    = (): VNode => lIco(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>);
const IcMoon     = (): VNode => lIco(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
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

function nav(id: string): void {
  (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav?.showSection?.(id);
}
function doLogout(): void {
  (window as unknown as { handleLogout?: () => void }).handleLogout?.();
}

export interface AccountPillProps {
  /** Visual variant: 'light' (navy pill, default) or 'onDark' (for dark heroes). */
  variant?: 'light' | 'onDark';
  /** Render the notification/message/ticket icons BEFORE the profile (icons on the
   *  left, profile pill in the far-right corner). Used by the app top bar. */
  iconsFirst?: boolean;
  /** Show the notifications quick-action icon (default true). */
  showNotif?: boolean;
  /** Show the messages quick-action icon (default true). */
  showMsg?: boolean;
  /** Show the support-tickets quick-action icon (default true). */
  showTicket?: boolean;
  /** Compact mode: avatar + caret only, hides the name/role text (for tight bars). */
  compact?: boolean;
}

export function AccountPill({
  variant = 'light',
  iconsFirst = false,
  showNotif = true,
  showMsg = true,
  showTicket = true,
  compact = false,
}: AccountPillProps): VNode {
  const fullName  = useSessionStore(selectFullName);
  const role      = useSessionStore(selectRole);
  const avatarUrl = useSessionStore(s => s.profileImage);
  const username  = useSessionStore(s => s.username);

  const name    = fullName ?? username ?? 'User';
  const initial = (name.trim()[0] ?? 'U').toUpperCase();

  const [menuOpen, setMenuOpen] = useState(false);
  // Appearance: the authoritative per-user theme (store → DB via system.user_theme).
  // Menu stays open on toggle so the switch flip is visible.
  const darkMode = useUiStore(selectTheme) === 'dark';
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const openMenu = (): void => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
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
        {!compact && (
          <span class="pnp-info">
            <span class="pnp-name">{name}</span>
            <span class="pnp-role">{roleLabel(role)}</span>
          </span>
        )}
        <span class="pnp-caret-box">
          <i class={`fas fa-chevron-${menuOpen ? 'up' : 'down'} pnp-caret`} aria-hidden="true" />
        </span>
      </button>
      {menuOpen && (
        <div class="pnp-menu" role="menu" style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}>
          <div class="pnp-menu-group">
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); nav('s-profile'); }}>
              <IcUser /><span>My Profile</span>
            </button>
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); nav('s-settings'); }}>
              <IcSettings /><span>Settings</span>
            </button>
            <button type="button" class="pnp-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); nav('s-about'); }}>
              <IcAbout /><span>About</span>
            </button>
          </div>
          <div class="pnp-menu-sep" />
          <div class="pnp-menu-group">
            <button type="button" class="pnp-menu-item" role="menuitemcheckbox" aria-checked={darkMode}
              onClick={() => useUiStore.getState().toggleTheme()}>
              <IcMoon /><span>Dark Mode</span>
              <span class={`pnp-switch${darkMode ? ' on' : ''}`} aria-hidden="true" />
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

  const anyIcon = showNotif || showMsg || showTicket;
  const icons = anyIcon ? (
    <div class="pnp-icons">
      {showNotif && (
        <button type="button" class="pnp-icon-btn" data-pill-action="notif" title="Notifications">
          <i class="fas fa-bell" /><span class="pnp-badge" data-pill-badge="notif" style={{ display: 'none' }} />
        </button>
      )}
      {showMsg && (
        <button type="button" class="pnp-icon-btn" data-pill-action="msg" title="Messages">
          <i class="fas fa-comment-dots" /><span class="pnp-badge" data-pill-badge="msg" style={{ display: 'none' }} />
        </button>
      )}
      {showTicket && (
        <button type="button" class="pnp-icon-btn" data-pill-action="ticket" title="Support Tickets">
          <i class="fas fa-ticket-alt" /><span class="pnp-badge pnp-badge-gold" data-pill-badge="ticket" style={{ display: 'none' }} />
        </button>
      )}
    </div>
  ) : null;

  const divider = icons ? <div class="pnp-divider" /> : null;

  return (
    <div class={`profile-notif-pill${variant === 'onDark' ? ' pnp-on-dark' : ''}${compact ? ' pnp-compact' : ''}`}>
      {iconsFirst
        ? <>{icons}{divider}{profile}</>
        : <>{profile}{divider}{icons}</>}
    </div>
  );
}
