import { type VNode } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import './Avatar.recipe.css';

export type AvatarVariant = 'circle' | 'square';
export type AvatarNamedSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarSize = AvatarNamedSize | number;
export type AvatarPresence = 'online' | 'away' | 'busy' | 'offline';

export interface AvatarProps {
  name: string;
  src?: string | null;
  seed?: string | null;
  size?: AvatarSize;
  variant?: AvatarVariant;
  presence?: AvatarPresence;
  decorative?: boolean;
  label?: string;
  class?: string;
  /** Legacy spelling accepted because this component replaces @shared/Avatar. */
  className?: string;
  fontSize?: number;
}

const NAME_TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'eng', 'rev', 'sir']);
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq']);

function bareWord(part: string): string {
  return part.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).map(bareWord).filter(Boolean);
  if (parts.length > 1 && NAME_TITLES.has(parts[0] ?? '')) parts.shift();
  if (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1] ?? '')) parts.pop();
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + (parts[parts.length - 1] ?? first).charAt(0)).toUpperCase();
}

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 8;
}

function isPreloaded(src: string | null | undefined): boolean {
  return Boolean(src && typeof window !== 'undefined' && window._preloadedProfileUrl === src && window._preloadedProfileImage?.complete);
}

export function Avatar({
  name, src, seed, size = 'md', variant = 'circle', presence,
  decorative = false, label, class: extra, className, fontSize,
}: AvatarProps): VNode {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);
  const onError = useCallback(() => setImageFailed(true), []);

  const numericSize = typeof size === 'number' ? Math.max(16, size) : undefined;
  const textSize = fontSize ?? (numericSize ? Math.round(numericSize * 0.38) : undefined);
  const style = [
    numericSize ? `width:${numericSize}px;height:${numericSize}px` : '',
    `border-radius:${variant === 'circle' ? '50%' : '6px'}`,
    textSize ? `font-size:${textSize}px` : '',
  ].filter(Boolean).join(';');
  const trimmedSeed = seed?.trim();
  const seedValue = trimmedSeed === undefined || trimmedSeed === '' ? name : trimmedSeed;
  const accessibleName = label ?? (name.trim() || 'Unknown user');
  const showImage = Boolean(src && !imageFailed);
  const classes = ['ui-avatar', `ui-avatar--${typeof size === 'number' ? 'custom' : size}`, `ui-avatar--${variant}`, extra, className].filter(Boolean).join(' ');

  return (
    <span
      class={classes}
      data-palette={paletteIndex(seedValue) + 1}
      style={style}
      role={!decorative && !showImage ? 'img' : undefined}
      aria-label={!decorative && !showImage ? accessibleName : undefined}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {showImage ? (
        <img src={src ?? undefined} alt={decorative ? '' : accessibleName} aria-hidden={decorative ? 'true' : undefined} width={numericSize} height={numericSize} onError={onError} decoding="async" loading="lazy" data-preloaded={isPreloaded(src) ? 'true' : undefined} />
      ) : name.trim() ? (
        <span class="ui-avatar__initials" aria-hidden="true">{avatarInitials(name)}</span>
      ) : (
        <LucideIcon name="User" aria-hidden="true" />
      )}
      {presence && <span class={`ui-avatar__presence ui-avatar__presence--${presence}`} aria-hidden="true" />}
    </span>
  );
}
