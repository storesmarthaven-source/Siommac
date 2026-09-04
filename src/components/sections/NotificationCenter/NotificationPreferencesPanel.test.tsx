import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface SetPreferenceArgs {
  event_type: string;
  eventType: string;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
}
interface SetPreferenceOptions { onSettled?: () => void }
const setPreference = vi.fn<(args: SetPreferenceArgs, options?: SetPreferenceOptions) => void>();
const mute = vi.fn<(args: { scope: string; mutedUntil: string | null }) => void>();
const { saveUiPreference } = vi.hoisted(() => ({ saveUiPreference: vi.fn() }));

const preferences = {
  data: {
    defaults: { event_type: '*', in_app: true, email: false, whatsapp: false },
    preferences: [],
    snooze: null,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@api/communications', () => ({
  useNotificationPreferences: () => preferences,
  useSetNotificationPreference: () => ({
    mutate: setPreference,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useMuteNotifications: () => ({
    mutate: mute,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

vi.mock('@api/uiPreferences', () => ({ saveUiPreference }));

import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { getToastRuntimePreferences, resetToastRuntimePreferences } from '@ui/toast';

describe('NotificationPreferencesPanel', () => {
  beforeEach(() => {
    setPreference.mockClear();
    mute.mockClear();
    preferences.data.snooze = null;
    resetToastRuntimePreferences();
    saveUiPreference.mockReset();
    saveUiPreference.mockImplementation((key: string, value: unknown) => Promise.resolve({ key, value, version: 1, updatedAt: null }));
  });

  it('uses the canonical UI Kit dialog with its left-sidebar layout', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Notification Settings' });
    expect(dialog.classList.contains('ui-dialog')).toBe(true);
    expect(dialog.classList.contains('ui-dialog--layout-sidebar-left')).toBe(true);
    expect(dialog.querySelector('.ui-dialog-sidebar')).toBeTruthy();
    expect(dialog.querySelector('.ui-dialog-content')).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.classList.contains('ui-btn')).toBe(true);
    expect(done.classList.contains('ui-btn--sm')).toBe(false);
  });

  it('uses UI Kit switches and keeps critical in-app alerts locked on', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    const critical = screen.getByRole('switch', { name: 'Critical Incidents In-App' });
    expect(critical.checked).toBe(true);
    expect(critical.disabled).toBe(true);
    expect(critical.closest('.nc-pref-control')?.querySelector('.nc-pref-lock')).toBeTruthy();
  });

  it('persists a channel change for the selected event type', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Scheduled Reminders Email' }));
    const [args, options] = setPreference.mock.calls.at(-1) ?? [];
    expect(args).toMatchObject({
      event_type: 'calendar.reminder.due',
      eventType: 'calendar.reminder.due',
      email: true,
    });
    expect(typeof options?.onSettled).toBe('function');
  });

  it('shows pending feedback only on the delivery switch being saved', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    const changed = screen.getByRole('switch', { name: 'Scheduled Reminders Email' });
    const untouched = screen.getByRole('switch', { name: 'Scheduled Reminders WhatsApp' });
    fireEvent.click(changed);

    expect(changed.getAttribute('aria-busy')).toBe('true');
    expect(untouched.getAttribute('aria-busy')).toBeNull();
    expect(untouched.disabled).toBe(false);
  });

  it('presents default delivery in the navigation display-settings pattern', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    expect(screen.getByRole('tab', { name: /Delivery Channels/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /Delivery Channels/i })).toBeTruthy();

    const defaultDelivery = screen.getAllByText('Default Delivery')
      .map(element => element.closest('.nc-pref-default'))
      .find(Boolean);
    expect(defaultDelivery).toBeTruthy();
    expect(defaultDelivery?.querySelector('.nc-pref-default-heading')).toBeTruthy();
    expect(defaultDelivery?.querySelector('.ui-feature-surface')).toBeTruthy();
    expect(defaultDelivery?.querySelector('.ui-feature-surface__copy')?.textContent)
      .toContain('Your baseline delivery preference for every alert.');

    for (const channel of ['In-App', 'Email', 'WhatsApp']) {
      const control = screen.getByRole('switch', { name: `Default Channels ${channel}` });
      expect(defaultDelivery?.contains(control)).toBe(true);
      expect(control.classList.contains('ui-choice-input')).toBe(true);
    }
  });

  it('opens the dedicated quiet-mode design inside the settings dialog', () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    const quietModeTab = screen.getByRole('tab', { name: /Quiet Mode/i });
    expect(quietModeTab.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(quietModeTab);
    expect(quietModeTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /Quiet Mode/i })).toBeTruthy();
    const quietMode = document.querySelector('.nc-pref-quiet-mode');
    expect(quietMode).toBeTruthy();
    expect(quietMode?.querySelector('.ui-feature-surface')).toBeTruthy();
    expect(quietMode?.querySelectorAll('.nc-pref-quiet-presets .ui-radio-card')).toHaveLength(3);
    const quietModeSwitch = screen.getByRole('switch', { name: 'Quiet Mode' });
    expect(quietMode?.contains(quietModeSwitch)).toBe(true);
    expect(quietModeSwitch.classList.contains('ui-choice-input')).toBe(true);
    fireEvent.click(quietModeSwitch);
    expect(mute).toHaveBeenCalledWith({ scope: 'all', mutedUntil: null });
    expect(screen.getByRole('radio', { name: /1 Hour/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Until Tomorrow/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Until Resumed/i })).toBeTruthy();
    mute.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: /1 Hour/i }));
    const oneHourMute = mute.mock.calls.at(-1)?.[0];
    expect(oneHourMute?.scope).toBe('all');
    expect(typeof oneHourMute?.mutedUntil).toBe('string');
    expect(screen.getByText('Critical Alerts Stay On')).toBeTruthy();
  });

  it('offers three visual positions and persists the position used by the live toast stack', async () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: /In-App Alerts/i }));
    expect(screen.getByRole('tabpanel', { name: /In-App Alerts/i })).toBeTruthy();
    const positionGroup = screen.getByLabelText('Toast Position');
    expect(positionGroup.querySelectorAll('.ui-radio-card')).toHaveLength(3);
    expect(positionGroup.querySelector('.ui-radio-cards--media-preview')).toBeTruthy();
    expect(positionGroup.querySelector('.ui-radio-cards--columns-3')).toBeTruthy();
    expect(positionGroup.querySelectorAll('.nc-pref-position-preview')).toHaveLength(3);

    fireEvent.click(screen.getByRole('radio', { name: /Bottom Right/i }));
    expect(getToastRuntimePreferences().position).toBe('bottom-right');
    await waitFor(() => expect(saveUiPreference).toHaveBeenCalledWith(
      'system.toast',
      expect.objectContaining({ position: 'bottom-right' }),
    ));
  });

  it('persists toast duration and behavior controls through the typed preference API', async () => {
    render(<NotificationPreferencesPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /In-App Alerts/i }));

    expect(screen.getByLabelText('Toast Display Time').querySelector('.ui-radio-cards--media-plain')).toBeTruthy();
    expect(screen.getByLabelText('Toast Display Time').querySelector('.ui-radio-cards--columns-3')).toBeTruthy();
    expect(screen.getByLabelText('Toast Display Time').querySelectorAll('.ui-radio-card__indicator--radio')).toHaveLength(3);
    expect(screen.getByLabelText('Toast Display Time').querySelector('.ui-radio-card__indicator--check')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Extended/i }));
    await waitFor(() => expect(getToastRuntimePreferences().durationMode).toBe('extended'));

    fireEvent.click(screen.getByRole('switch', { name: 'Show Message Previews' }));
    await waitFor(() => expect(getToastRuntimePreferences().showPreviews).toBe(false));
    expect(saveUiPreference).toHaveBeenLastCalledWith(
      'system.toast',
      expect.objectContaining({ showPreviews: false }),
    );
  });
});
