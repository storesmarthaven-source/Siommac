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

import { type VNode } from 'preact';
import { useSessionStore, selectFullName, selectRole } from '@store/session';

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

export interface ProfilePillProps {
  /** Visual variant: 'light' (navy pill, default) or 'onDark' (for dark heroes). */
  variant?: 'light' | 'onDark';
}

export function ProfilePill({ variant = 'light' }: ProfilePillProps): VNode {
  const fullName  = useSessionStore(selectFullName);
  const role      = useSessionStore(selectRole);
  const avatarUrl = useSessionStore(s => s.profileImage);
  const username  = useSessionStore(s => s.username);

  const name    = fullName || username || 'User';
  const initial = (name.trim()[0] ?? 'U').toUpperCase();

  return (
    <div class={`profile-notif-pill${variant === 'onDark' ? ' pnp-on-dark' : ''}`}>
      <button type="button" class="pnp-profile" onClick={gotoProfile} title="My Profile">
        <span class="pnp-avatar">
          {avatarUrl
            ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
            : initial}
        </span>
        <span class="pnp-info">
          <span class="pnp-name">{name}</span>
          <span class="pnp-role">{roleLabel(role)}</span>
        </span>
      </button>
      <div class="pnp-divider" />
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
    </div>
  );
}
