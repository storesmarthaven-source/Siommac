import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('demo mode preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('persists page configuration without persisting the verified session', async () => {
    const first = await import('./demoMode');
    first.setDemoModeEnabled(true);
    first.setDemoPageOptions('messages', { showLandingPage: false, useStagedData: false });

    vi.resetModules();
    const refreshed = await import('./demoMode');

    expect(refreshed.readDemoMode()).toEqual({
      enabled: false,
      pages: {
        messages: { showLandingPage: false, useStagedData: false },
        notifications: { showLandingPage: true, useStagedData: true },
        tickets: { showLandingPage: true, useStagedData: true },
        calendar: { showLandingPage: true, useStagedData: true },
        meetings: { showLandingPage: true, useStagedData: true },
      },
    });
  });

  it('falls back safely when stored configuration is malformed', async () => {
    window.localStorage.setItem('siomac.demo-mode.page-options.v1', '{not-json');
    const demoMode = await import('./demoMode');

    expect(demoMode.readDemoMode().pages.messages.useStagedData).toBe(true);
  });
});
