import { describe, expect, it } from 'vitest';
import { findComponent } from './index';

describe('runtime feedback catalogue entries', () => {
  it('registers the app Toast and existing SweetAlert popup implementations', () => {
    const toast = findComponent('toast');
    const popup = findComponent('sweet-alert');

    expect(toast?.status).toBe('stable');
    expect(toast?.componentPath).toBe('src/ui/toast/Toaster.tsx');
    expect(toast?.props?.tier).toBeDefined();

    expect(popup?.status).toBe('stable');
    expect(popup?.componentPath).toBe('src/lib/popup.ts');
    expect(popup?.props?.tone).toBeDefined();
  });
});
