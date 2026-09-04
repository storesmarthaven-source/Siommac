import { type VNode } from 'preact';
import { IconTile, type IconTileSize, type IconTileTone } from './IconTile';
import { type LucideName } from '../LucideIcon';

export type NotificationIconVariant =
  | 'general'
  | 'critical'
  | 'warning'
  | 'success'
  | 'approval'
  | 'assignment'
  | 'reminder'
  | 'announcement'
  | 'document'
  | 'message'
  | 'finance'
  | 'workflow';

export interface NotificationIconProps {
  variant?: NotificationIconVariant;
  size?: IconTileSize;
  label?: string;
  class?: string;
}

interface NotificationIconDefinition {
  icon: LucideName;
  tone: IconTileTone;
}

/**
 * Canonical notification semantics. Product surfaces select the event meaning;
 * the UI Kit owns its icon and palette so unrelated alerts never drift into
 * arbitrary or duplicate treatments.
 */
export const NOTIFICATION_ICON_DEFINITIONS: Readonly<Record<NotificationIconVariant, NotificationIconDefinition>> = {
  general:      { icon: 'Bell',              tone: 'neutral' },
  critical:     { icon: 'ShieldAlert',       tone: 'danger' },
  warning:      { icon: 'TriangleAlert',     tone: 'amber' },
  success:      { icon: 'CircleCheck',       tone: 'success' },
  approval:     { icon: 'BadgeCheck',        tone: 'indigo' },
  assignment:   { icon: 'ClipboardCheck',    tone: 'blue' },
  reminder:     { icon: 'Clock3',            tone: 'cyan' },
  announcement: { icon: 'Megaphone',         tone: 'violet' },
  document:     { icon: 'FileText',           tone: 'navy' },
  message:      { icon: 'MessageSquareText', tone: 'teal' },
  finance:      { icon: 'WalletCards',        tone: 'orange' },
  workflow:     { icon: 'Workflow',           tone: 'rose' },
};

export function NotificationIcon({
  variant = 'general',
  size = 'md',
  label,
  class: extra,
}: NotificationIconProps): VNode {
  const definition = NOTIFICATION_ICON_DEFINITIONS[variant];
  return <IconTile icon={definition.icon} tone={definition.tone} size={size} label={label} class={extra} />;
}
