// Ported from the bundle (ui/components/Avatar.tsx) + SIOMAC hardening: users
// without a profile image render initials instead of a broken <img>.
import type { User } from "../../domain/models";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts.at(-1)?.[0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function Avatar({ user, size = "medium", showPresence = false }: { user: User; size?: "small" | "medium" | "large"; showPresence?: boolean }) {
  return (
    <span className={`sm-avatar sm-avatar--${size}`}>
      {user.avatarUrl
        ? <img src={user.avatarUrl} alt={user.name} />
        : <span className="sm-avatar__initials" aria-label={user.name}>{initials(user.name)}</span>}
      {showPresence ? <i className={`sm-presence sm-presence--${user.presence}`} aria-label={user.presence} /> : null}
    </span>
  );
}

export function GroupAvatarStack({ users, variant = "compact" }: { users: User[]; variant?: "compact" | "header" }) {
  const limit = variant === "header" ? 4 : 3;
  const visible = users.slice(0, limit);
  const remaining = Math.max(0, users.length - visible.length);
  return (
    <span className={`sm-group-avatars sm-group-avatars--${variant}`} role="img" aria-label={`${users.length} participants: ${users.map((user) => user.name).join(", ")}`}>
      {visible.map((user) => <Avatar key={user.id} user={user} size="small" />)}
      {remaining ? <span className="sm-group-avatars__more">+{remaining}</span> : null}
    </span>
  );
}
