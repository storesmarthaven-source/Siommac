import { render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@untitledui/file-icons', () => ({
  FileIcon: ({ type }: { type: string }) => <svg data-upstream-file-icon={type} />,
}));

import { FileTypeIcon } from './FileTypeIcon';

describe('FileTypeIcon', () => {
  it('uses a solid white document sheet by default without adding an outer tile', () => {
    const { container } = render(<FileTypeIcon type="pdf" size={40} />);
    expect(container.querySelector('.ui-file-type-icon__sheet')).toBeTruthy();
    expect(container.querySelector('.ui-file-type-icon')?.classList.contains('ui-file-type-icon--sheet-white')).toBe(true);
  });

  it('can preserve a transparent document sheet when explicitly requested', () => {
    const { container } = render(<FileTypeIcon type="pdf" sheetBackground="transparent" />);
    expect(container.querySelector('.ui-file-type-icon__sheet')).toBeNull();
  });
});
