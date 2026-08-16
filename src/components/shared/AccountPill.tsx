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
 *   • Id-free badges: count spans carry data-pill-badge="…"; the Preact pill
 *     renders counts from the same communications summary query as the dropdowns.
 *     badgeSync remains a fallback for non-Preact/legacy badge nodes.
 *   • Profile area routes to My Profile.
 *
 * Customization:
 *   variant="onDark"                → styling for dark panels
 *   iconsFirst                      → icons on the left, profile in the corner (top bar)
 *   showNotif / showMsg / showTicket → toggle each quick-action icon (all default true)
 *   compact                         → avatar + caret only (hides the name/role text)
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useSessionStore, selectFullName, selectRole } from '@store/session';
import { useUiStore, selectTheme } from '@store/ui';
import { dialog } from '@lib/dialog';
import { useCommsSummary } from '@api/communications';
import { Avatar } from '../../ui/people/Avatar';
import { Button } from '../../ui/primitives/Button';
import { LucideIcon } from '../../ui/LucideIcon';
import { DropdownMenu, type MenuItems } from '../../ui/overlays/DropdownMenu';
import { ThemeModeSwitch } from '../../ui/patterns/ThemeModeSwitch';
import '../../ui/primitives/actions.recipe.css';
import './AppTopBar.recipe.css';

// ── Lucide line-icons (the app's icon language) ───────────────────────────────
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

function nav(id: string): void {
  (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav?.showSection?.(id);
}
function doLogout(): void {
  (window as unknown as { handleLogout?: () => void }).handleLogout?.();
}

function badgeText(count: number | undefined): string {
  if (!count || count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

function badgeStyle(label: string): { display: string } | undefined {
  return label ? undefined : { display: 'none' };
}

function actionLabel(label: string, count: number | undefined): string {
  if (!count || count <= 0) return label;
  return `${label}, ${count > 99 ? '99+' : count} unread`;
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
  const summaryQ  = useCommsSummary();

  const name    = fullName ?? username ?? 'User';
  const notifBadge  = badgeText(summaryQ.data?.notificationsUnread);
  const msgBadge    = badgeText(summaryQ.data?.messagesUnread);
  const ticketBadge = badgeText(summaryQ.data?.ticketsUnread);

  const [menuOpen, setMenuOpen] = useState(false);
  // Appearance: the authoritative per-user theme (store → DB via system.user_theme).
  // Menu stays open on toggle so the switch flip is visible.
  const darkMode = useUiStore(selectTheme) === 'dark';
  const [menuAnchor, setMenuAnchor] = useState<HTMLDivElement | null>(null);

  const openMenu = (): void => {
    setMenuOpen(true);
  };

  const confirmLogout = async (): Promise<void> => {
    setMenuOpen(false);
    const ok = await dialog.confirm({
      title: 'Log out?',
      text: 'You will be signed out of Siomac and returned to the login screen.',
      confirmText: 'Log out', danger: true,
    });
    if (ok) doLogout();
  };

  const menuItems: MenuItems = [
    { items: [
      { id: 'profile', label: 'My Profile', icon: <IcUser />, onSelect: () => nav('s-profile') },
      { id: 'settings', label: 'Settings', icon: <IcSettings />, onSelect: () => nav('s-settings') },
      { id: 'about', label: 'About', icon: <IcAbout />, onSelect: () => nav('s-about') },
    ] },
    { items: [
      {
        id: 'theme',
        label: 'Dark Mode',
        icon: <LucideIcon name="Moon" />,
        control: ({ ref, tabIndex }) => (
          <ThemeModeSwitch
            theme={darkMode ? 'dark' : 'light'}
            onChange={theme => useUiStore.getState().setTheme(theme)}
            role="menuitemcheckbox"
            label="Dark Mode"
            class="app-topbar-theme-switch"
            buttonRef={ref}
            tabIndex={tabIndex}
          />
        ),
      },
    ] },
    { items: [
      { id: 'logout', label: 'Log out', icon: <IcLogout />, danger: true, onSelect: () => void confirmLogout() },
    ] },
  ];

  const profile = (
    <div class="pnp-profile-wrap" ref={setMenuAnchor}>
      <span class="pnp-profile pnp-profile-split ui-split">
        <Button variant="ghost" size="md" class="pnp-profile-main" onClick={() => nav('s-profile')} title="My profile">
          <Avatar name={name} src={avatarUrl} size={34} class="pnp-avatar" />
          {!compact && (
            <span class="pnp-info">
              <span class="pnp-name">{name}</span>
              <span class="pnp-role">{roleLabel(role)}</span>
            </span>
          )}
        </Button>
        <Button variant="ghost" size="md" class="pnp-profile-menu-trigger" iconOnly
          onClick={() => menuOpen ? setMenuOpen(false) : openMenu()} title="Account menu"
          aria-label="Open account menu" aria-haspopup="menu" aria-expanded={menuOpen}
          aria-controls="app-topbar-account-menu"
          iconLeft={<LucideIcon name="ChevronDown" class="ui-btn-chevron pnp-caret" aria-hidden="true" />} />
      </span>
      <DropdownMenu
        id="app-topbar-account-menu"
        open={menuOpen}
        anchor={menuAnchor}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        label={`${name} account menu`}
        matchAnchorWidth
      />
    </div>
  );

  const anyIcon = showNotif || showMsg || showTicket;
  const icons = anyIcon ? (
    <div class="pnp-icons">
      {showNotif && (
        <button type="button" class="pnp-icon-btn" data-pill-action="notif" title="Notifications"
          aria-label={actionLabel('Notifications', summaryQ.data?.notificationsUnread)}>
          <i class="fas fa-bell" /><span class="pnp-badge" data-pill-badge="notif" style={badgeStyle(notifBadge)}>{notifBadge}</span>
        </button>
      )}
      {showMsg && (
        <button type="button" class="pnp-icon-btn" data-pill-action="msg" title="Messages"
          aria-label={actionLabel('Messages', summaryQ.data?.messagesUnread)}>
          <i class="fas fa-comment-dots" /><span class="pnp-badge" data-pill-badge="msg" style={badgeStyle(msgBadge)}>{msgBadge}</span>
        </button>
      )}
      {showTicket && (
        <button type="button" class="pnp-icon-btn" data-pill-action="ticket" title="Support Tickets"
          aria-label={actionLabel('Support Tickets', summaryQ.data?.ticketsUnread)}>
          <i class="fas fa-ticket-alt" /><span class="pnp-badge pnp-badge-gold" data-pill-badge="ticket" style={badgeStyle(ticketBadge)}>{ticketBadge}</span>
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
