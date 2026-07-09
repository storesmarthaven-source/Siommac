// src/ui/table/PersonCell.tsx — reusable person / identity cell for DataTable columns.
//
// Renders a profile photo (or coloured-initials fallback, via the shared Avatar) next to
// a name, with an optional inline `meta` (e.g. " · EMP-001") and a `sub` line underneath
// (department, role…). Avatar handling lives here ONCE, so any table column can show a
// profile photo simply by returning a <PersonCell> from its `renderCell` — that is what
// "profile photos are built into the table" means: it is always available, everywhere.
//
//   renderCell: r => <PersonCell name={r.name} image={r.photoUrl} meta={`· ${r.code}`} />
//
// Module-specific adapters that resolve an id → identity (e.g. Finance's
// EmployeeCellResolved) delegate their rendering to this primitive.
import type { ComponentChildren, VNode } from 'preact';
import { Avatar } from '@/components/shared/Avatar';
import './personCell.css';

export interface PersonCellProps {
  /** Display name — drives the initials fallback and alt text. */
  name: string;
  /** Profile photo URL. Falls back to coloured initials when absent or broken. */
  image?: string | null;
  /** Inline meta shown right after the name (e.g. an employee number). */
  meta?: ComponentChildren;
  /** Secondary line under the name (department, position…). */
  sub?: ComponentChildren;
  /** Avatar diameter in px (default 30). */
  size?: number;
  /** Show a loading skeleton (avatar circle + name bar) instead of content. */
  loading?: boolean;
  class?: string;
}

export function PersonCell({ name, image, meta, sub, size = 30, loading, class: extra }: PersonCellProps): VNode {
  if (loading) {
    return (
      <span class={`pc-root pc-loading${extra ? ` ${extra}` : ''}`} aria-busy="true">
        <span class="pc-skel pc-skel-avatar" style={{ width: size, height: size }} aria-hidden="true" />
        <span class="pc-text"><span class="pc-skel pc-skel-name" aria-hidden="true" /></span>
      </span>
    );
  }
  const hasMeta = meta != null && meta !== '';
  const hasSub = sub != null && sub !== '';
  return (
    <span class={`pc-root${extra ? ` ${extra}` : ''}`}>
      <Avatar name={name} src={image} size={size} className="pc-avatar" />
      <span class="pc-text">
        <span class="pc-primary">
          <span class="pc-name">{name}</span>
          {hasMeta && <span class="pc-meta">{meta}</span>}
        </span>
        {hasSub && <span class="pc-sub">{sub}</span>}
      </span>
    </span>
  );
}
