import { type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CALENDAR_LUCIDE_TITLE_ICONS,
  type CalendarTitleIconType,
} from '../../../../types/calendar';
import { LucideIcon, type LucideName } from '@ui';
import { EmojiPicker } from '../Messages/messenger/ui/components/EmojiPicker';

export function CalendarTitleIcon({ type, value, size = 16 }: {
  type?: CalendarTitleIconType | null;
  value?: string | null;
  size?: number;
}): VNode | null {
  if (!type || !value) return null;
  return type === 'emoji'
    ? <span class="cal-title-icon-emoji" aria-hidden="true">{value}</span>
    : <LucideIcon name={value as LucideName} size={size} aria-hidden="true" />;
}

export function CalendarTitleIconPicker({ mode, type, value, disabled = false, onChange }: {
  mode: CalendarTitleIconType;
  type?: CalendarTitleIconType | null;
  value?: string | null;
  disabled?: boolean;
  onChange: (type: CalendarTitleIconType | null, value: string | null) => void;
}): VNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || mode === 'emoji') return;
    const closeOnOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mode, open]);

  const label = mode === 'emoji' ? 'Choose emoji' : 'Choose Lucide icon';

  return <div class="cal-title-icon-picker" ref={rootRef}>
    <button type="button" class={`cal-title-icon-trigger${type && value ? ' has-value' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
      {type && value
        ? <CalendarTitleIcon type={type} value={value} size={18} />
        : <LucideIcon name={mode === 'emoji' ? 'SmilePlus' : 'Shapes'} size={18} />}
    </button>
    {open && mode === 'emoji' ? <div class="cal-calendar-emoji-picker" onPointerDown={event => event.stopPropagation()}><header><strong>Choose an emoji</strong>{type && value ? <button type="button" onClick={() => onChange(null, null)}>Remove</button> : null}</header><EmojiPicker onSelect={emoji => { onChange('emoji', emoji); setOpen(false); }} onClose={() => setOpen(false)} /></div> : null}
    {open && mode === 'lucide' ? <div class="cal-lucide-picker" role="dialog" aria-label="Lucide icon picker">
      <header><strong>Choose an icon</strong>{type && value ? <button type="button" onClick={() => { onChange(null, null); setOpen(false); }}>Remove</button> : null}</header>
      <div class="cal-lucide-picker-grid">
        {CALENDAR_LUCIDE_TITLE_ICONS.map(icon => <button key={icon} type="button" class={type === 'lucide' && value === icon ? 'is-selected' : ''} aria-label={icon.replace(/([a-z])([A-Z])/g, '$1 $2')} title={icon.replace(/([a-z])([A-Z])/g, '$1 $2')} onClick={() => { onChange('lucide', icon); setOpen(false); }}><LucideIcon name={icon as LucideName} size={18} /></button>)}
      </div>
    </div> : null}
  </div>;
}
