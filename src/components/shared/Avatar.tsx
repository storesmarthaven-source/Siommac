/**
 * src/components/shared/Avatar.tsx
 *
 * Profile image with graceful fallback to initials.
 *
 * Handles:
 *   - Broken / missing image URLs  → initials derived from `name`
 *   - Empty name                   → generic person icon
 *   - Signed URL expiry            → error handler triggers fallback silently
 *   - Preloaded images             → checks window._preloadedProfileImage
 *     to avoid the initial-letter → photo flash on first render
 *
 * Usage:
 *   <Avatar name="Jane Doe" src={profileImage} size={40} />
 *   <Avatar name="Jane Doe" size={32} variant="square" />
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { type VNode }                                    from 'preact';
import { useState, useCallback, useEffect }              from 'preact/hooks';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AvatarVariant = 'circle' | 'square';
export type AvatarSize    = number;   // px

export interface AvatarProps {
  /** Full name — used to derive initials and as alt text */
  name:      string;
  /** Signed storage URL.  If absent or broken, falls back to initials. */
  src?:      string | null;
  /** Diameter / side-length in px.  Default: 40 */
  size?:     AvatarSize;
  variant?:  AvatarVariant;
  className?: string;
  /** Override the font-size for initials text (px). Defaults to size * 0.38. */
  fontSize?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/**
 * Generate a deterministic background colour from the name so each person
 * always gets the same colour — not random on every render.
 */
function nameToColor(name: string): string {
  const PALETTE = [
    '#1B4F8A', '#2E7D32', '#6A1B9A', '#C62828',
    '#00695C', '#E65100', '#4527A0', '#00838F',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

/** Check if the preloaded image matches the given src and is decoded already */
function isPreloaded(src: string | null | undefined): boolean {
  if (!src || typeof window === 'undefined') return false;
  return (
    window._preloadedProfileUrl === src &&
    window._preloadedProfileImage?.complete === true
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Avatar({
  name,
  src,
  size      = 40,
  variant   = 'circle',
  className = '',
  fontSize,
}: AvatarProps): VNode {
  const [imgError, setImgError] = useState(false);

  // Reset error state when the src prop changes (e.g. after photo upload)
  useEffect(() => {
    setImgError(false);
  }, [src]);

  const handleError = useCallback(() => {
    setImgError(true);
  }, []);

  const radius     = variant === 'circle' ? '50%' : '6px';
  const textSize   = fontSize ?? Math.round(size * 0.38);
  const showImage  = src && !imgError;
  const initials   = getInitials(name);
  const bgColor    = nameToColor(name);

  const baseStyle: Record<string, string | number> = {
    width:          size,
    height:         size,
    borderRadius:   radius,
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    overflow:       'hidden',
    userSelect:     'none',
    fontFamily:     'system-ui, sans-serif',
    fontWeight:     '600',
    lineHeight:     '1',
  };

  if (showImage) {
    // If the image was preloaded by the inline script in index.html,
    // skip the loading fade — it is already in the browser cache.
    const skipFade = isPreloaded(src);
    return (
      <span class={`siomac-avatar ${className}`} style={baseStyle} aria-label={name}>
        <img
          src={src!}
          alt={name}
          width={size}
          height={size}
          onError={handleError}
          style={{
            width:      '100%',
            height:     '100%',
            objectFit:  'cover',
            display:    'block',
            opacity:    skipFade ? 1 : undefined,
            transition: skipFade ? 'none' : 'opacity 0.2s',
          }}
          decoding="async"
          loading="lazy"
        />
      </span>
    );
  }

  // Initials fallback
  if (name.trim()) {
    return (
      <span
        class={`siomac-avatar siomac-avatar--initials ${className}`}
        style={{ ...baseStyle, background: bgColor, color: '#fff', fontSize: textSize }}
        aria-label={name}
        role="img"
      >
        {initials}
      </span>
    );
  }

  // Generic icon fallback for empty name
  return (
    <span
      class={`siomac-avatar siomac-avatar--icon ${className}`}
      style={{ ...baseStyle, background: '#6c757d', color: '#fff', fontSize: textSize }}
      aria-label="Unknown user"
      role="img"
    >
      <i class="fas fa-user" aria-hidden="true" />
    </span>
  );
}
