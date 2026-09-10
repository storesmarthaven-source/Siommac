import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { CalendarTitleIconPicker } from './CalendarTitleIconPicker';
import type { CalendarTitleIconType } from '../../../../types/calendar';

function EmojiPickerHarness({ onChange }: { onChange: (type: CalendarTitleIconType | null, value: string | null) => void }) {
  const [type, setType] = useState<CalendarTitleIconType | null>('emoji');
  const [value, setValue] = useState<string | null>('👋');
  return <CalendarTitleIconPicker mode="emoji" type={type} value={value} onChange={(nextType, nextValue) => {
    setType(nextType);
    setValue(nextValue);
    onChange(nextType, nextValue);
  }} />;
}

describe('CalendarTitleIconPicker', () => {
  it('keeps the emoji picker open after removing the current emoji', () => {
    const onChange = vi.fn();
    render(<EmojiPickerHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }));
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.pointerDown(remove);
    fireEvent.click(remove);

    expect(onChange).toHaveBeenCalledWith(null, null);
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
