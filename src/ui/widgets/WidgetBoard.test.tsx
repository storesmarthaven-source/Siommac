import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { WidgetBoard } from './WidgetBoard';

const { registerGuardMock, confirmMock } = vi.hoisted(() => ({
  registerGuardMock: vi.fn(() => vi.fn()),
  confirmMock: vi.fn(),
}));

vi.mock('./runtimeRegistry', () => ({ useInstalledWidgetPackages: () => ({ isSuccess: true }) }));
vi.mock('./WidgetBoardZone', () => ({ WidgetBoardZone: () => <div data-testid="board-zone" /> }));
vi.mock('@components/nav/navCore', () => ({ registerSectionNavigationGuard: registerGuardMock }));
vi.mock('@lib/dialog', () => ({ dialog: { confirm: confirmMock } }));

describe('WidgetBoard edit controls', () => {
  it('keeps the compact edit bar mounted and opens the library from it', () => {
    const openLibrary = vi.fn();
    render(<WidgetBoard pageKey="hr.employees.overview" editing onFinishEditing={() => undefined} onOpenLibrary={openLibrary} />);

    const wrapper = document.querySelector('.wbi-edit-banner-wrap');
    expect(wrapper?.classList.contains('is-open')).toBe(true);
    expect(screen.getByText('Editing layout')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Widget library' }));
    expect(openLibrary).toHaveBeenCalledOnce();
  });

  it('keeps the floating bar inaccessible outside edit mode', () => {
    render(<WidgetBoard pageKey="hr.employees.overview" editing={false} onFinishEditing={() => undefined} />);
    expect(document.querySelector('.wbi-edit-banner-wrap')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the shared unsaved-state guard while a board transaction is dirty', async () => {
    const cancel = vi.fn();
    confirmMock.mockResolvedValueOnce(true);
    render(<WidgetBoard pageKey="hr.employees.overview" editing isDirty
      onFinishEditing={() => undefined} onCancelEditing={cancel} />);

    expect(screen.getByText('Editing layout · Unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeTruthy();
    expect(registerGuardMock).toHaveBeenCalledOnce();

    const guard = (registerGuardMock.mock.calls as unknown as [(target: string) => Promise<boolean>][])[0]?.[0];
    expect(await guard?.('s-finance-statutory')).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
