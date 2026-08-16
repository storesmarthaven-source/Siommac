import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Avatar } from '../../ui/people/Avatar';
import avatarSarah from '../../assets/avatars/untitled-ui/Sarah Page.jpg';
import { Button } from '../../ui/primitives/Button';
import { LucideIcon } from '../../ui/LucideIcon';
import { DropdownMenu, type MenuItems } from '../../ui/overlays/DropdownMenu';
import { ThemeModeSwitch } from '../../ui/patterns/ThemeModeSwitch';
import { searchShortcutLabel } from './searchShortcut';
import '../../ui/primitives/actions.recipe.css';
import './AppTopBar.recipe.css';

/**
 * Shared application top-bar frame. UserPill supplies the account/search
 * content, while this component owns the single global bar shell and portal
 * slot used by module navigation.
 */
export interface AppTopBarProps {
  children: ComponentChildren;
  /** Auto follows the application theme; Studio previews can force either surface. */
  appearance?: 'auto' | 'dark' | 'light';
  lightSurface?: 'white' | 'neutral' | 'brand-tint';
  actionTreatment?: 'outline' | 'ghost' | 'soft';
  chevronTreatment?: 'solid' | 'outline' | 'soft';
  brandPreview?: 'theme' | 'blue' | 'green';
}

export function AppTopBar({
  children, appearance = 'auto', lightSurface = 'neutral', actionTreatment = 'outline',
  chevronTreatment = 'solid', brandPreview = 'theme',
}: AppTopBarProps): VNode {
  return <header class={`app-topbar app-topbar--${appearance} app-topbar--surface-${lightSurface} app-topbar--actions-${actionTreatment} app-topbar--chevron-${chevronTreatment} app-topbar--brand-${brandPreview}`}>{children}</header>;
}

/** Closed-state account control using the exact production class contract. */
export function UserPillArtwork({
  name = 'Sarah James', role = 'Safety Officer',
  showNotifications = true, showMessages = true, showTickets = true, showProfile = true, menuOpen = false,
  actionIconStyle = 'line',
}: { name?: string; role?: string; showNotifications?: boolean; showMessages?: boolean; showTickets?: boolean; showProfile?: boolean; menuOpen?: boolean; actionIconStyle?: 'line' | 'app' }): VNode {
  const [open, setOpen] = useState(menuOpen);
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [profileAnchor, setProfileAnchor] = useState<HTMLDivElement | null>(null);
  useEffect(() => setOpen(menuOpen), [menuOpen]);
  const hasActions = showNotifications || showMessages || showTickets;
  const menuItems: MenuItems = [
    { items: [
      { id: 'profile', label: 'My Profile', icon: <LucideIcon name="User" /> },
      { id: 'settings', label: 'Settings', icon: <LucideIcon name="Settings" /> },
      { id: 'about', label: 'About', icon: <LucideIcon name="Info" /> },
    ] },
    { items: [
      { id: 'theme', label: 'Dark Mode', icon: <LucideIcon name="Moon" />, control: ({ ref, tabIndex }) => (
        <ThemeModeSwitch theme={previewTheme} onChange={setPreviewTheme} role="menuitemcheckbox"
          label="Dark Mode" class="app-topbar-theme-switch" buttonRef={ref} tabIndex={tabIndex} />
      ) },
    ] },
    { items: [
      { id: 'logout', label: 'Log out', icon: <LucideIcon name="LogOut" />, danger: true },
    ] },
  ];
  return (
    <div class="profile-notif-pill">
      {hasActions && <div class="pnp-icons">
        {showNotifications && <button type="button" class="pnp-icon-btn" aria-label="Notifications">{actionIconStyle === 'line' ? <LucideIcon name="Bell" /> : <i class="fas fa-bell" />}</button>}
        {showMessages && <button type="button" class="pnp-icon-btn" aria-label="Messages">{actionIconStyle === 'line' ? <LucideIcon name="MessageCircle" /> : <i class="fas fa-comment-dots" />}</button>}
        {showTickets && <button type="button" class="pnp-icon-btn" aria-label="Support Tickets">{actionIconStyle === 'line' ? <LucideIcon name="Ticket" /> : <i class="fas fa-ticket-alt" />}</button>}
      </div>}
      {hasActions && showProfile && <div class="pnp-divider" />}
      {showProfile && <div class="pnp-profile-wrap" ref={setProfileAnchor}>
        <span class="pnp-profile pnp-profile-split ui-split">
          <Button variant="ghost" size="md" class="pnp-profile-main" aria-label={`Open ${name}'s profile`}>
            <Avatar name={name} src={avatarSarah} size={34} class="pnp-avatar" />
            <span class="pnp-info"><span class="pnp-name">{name}</span><span class="pnp-role">{role}</span></span>
          </Button>
          <Button variant="ghost" size="md" class="pnp-profile-menu-trigger" iconOnly aria-label="Open account menu"
            aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}
            aria-controls="app-topbar-account-preview-menu"
            iconLeft={<LucideIcon name="ChevronDown" class="ui-btn-chevron pnp-caret" />} />
        </span>
        <DropdownMenu
          id="app-topbar-account-preview-menu"
          open={open}
          anchor={profileAnchor}
          onClose={() => setOpen(false)}
          items={menuItems}
          label={`${name} account menu`}
          matchAnchorWidth
        />
      </div>}
    </div>
  );
}

/** Production top-bar artwork for isolated previews; no app data hooks. */
export interface AppTopBarArtworkProps {
  layout?: 'search' | 'actions' | 'user-pill' | 'full';
  appearance?: 'dark' | 'light';
  lightSurface?: 'white' | 'neutral' | 'brand-tint';
  actionTreatment?: 'outline' | 'ghost' | 'soft';
  chevronTreatment?: 'solid' | 'outline' | 'soft';
  brandPreview?: 'theme' | 'blue' | 'green';
  actionIconStyle?: 'line' | 'app';
  showNotifications?: boolean;
  showMessages?: boolean;
  showTickets?: boolean;
  menuOpen?: boolean;
}

export function AppTopBarArtwork({
  layout = 'search',
  appearance = 'dark',
  lightSurface = 'neutral', actionTreatment = 'outline', chevronTreatment = 'solid', brandPreview = 'theme',
  actionIconStyle = 'line',
  showNotifications = true, showMessages = true, showTickets = true, menuOpen = false,
}: AppTopBarArtworkProps = {}): VNode {
  const shortcut = searchShortcutLabel();
  const actionsBar = (
    <AppTopBar appearance={appearance} lightSurface={lightSurface} actionTreatment={actionTreatment} chevronTreatment={chevronTreatment} brandPreview={brandPreview}>
        <div class="app-topbar-main app-topbar-main--actions-only">
          <div class="app-topbar-pill"><UserPillArtwork showNotifications={showNotifications}
            showMessages={showMessages} showTickets={showTickets} showProfile={false} actionIconStyle={actionIconStyle} /></div>
        </div>
    </AppTopBar>
  );
  const searchBar = (
    <AppTopBar appearance={appearance} lightSurface={lightSurface} actionTreatment={actionTreatment} chevronTreatment={chevronTreatment} brandPreview={brandPreview}>
        <div class="app-topbar-main app-topbar-main--search-only">
          <div class="app-topbar-search">
            <button type="button" class="app-topbar-search-trigger" aria-label="Search and jump to">
              <i class="fas fa-search" /><span class="app-topbar-search-text">Search &amp; jump to…</span>
            </button>
            <kbd class="app-topbar-kbd">{shortcut}</kbd>
          </div>
        </div>
    </AppTopBar>
  );
  const userPillBar = (
    <AppTopBar appearance={appearance} lightSurface={lightSurface} actionTreatment={actionTreatment} chevronTreatment={chevronTreatment} brandPreview={brandPreview}><div class="app-topbar-main app-topbar-main--account-only"><div class="app-topbar-pill">
      <UserPillArtwork showNotifications={false} showMessages={false} showTickets={false} menuOpen={menuOpen} />
    </div></div></AppTopBar>
  );
  const fullBar = (
    <AppTopBar appearance={appearance} lightSurface={lightSurface} actionTreatment={actionTreatment} chevronTreatment={chevronTreatment} brandPreview={brandPreview}>
      <div class="app-topbar-main app-topbar-main--full">
        <div class="app-topbar-search">
          <button type="button" class="app-topbar-search-trigger" aria-label="Search and jump to">
            <i class="fas fa-search" /><span class="app-topbar-search-text">Search &amp; jump to…</span>
          </button>
          <kbd class="app-topbar-kbd">{shortcut}</kbd>
        </div>
        <div class="app-topbar-pill">
          <UserPillArtwork showNotifications={showNotifications} showMessages={showMessages}
            showTickets={showTickets} menuOpen={menuOpen} actionIconStyle={actionIconStyle} />
        </div>
      </div>
    </AppTopBar>
  );
  if (layout === 'full') return fullBar;
  if (layout === 'actions') return actionsBar;
  if (layout === 'user-pill') return userPillBar;
  return searchBar;
}
