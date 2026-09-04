import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_PREFERENCE_KEY,
  sanitizeUiPreference,
} from '../../types/uiPreferences';

describe('navigation UI preference contract', () => {
  it('accepts the bounded navigation preference shape', () => {
    const result = sanitizeUiPreference(NAVIGATION_PREFERENCE_KEY, {
      density: 'compact',
      showChildIcons: false,
      visibility: [{ namespace: 'workforce', id: 'rostering', visible: true }],
      order: [{ namespace: 'workforce', ids: ['rostering', 'employees'] }],
    });
    expect(result).toEqual({
      version: 1,
      value: {
        density: 'compact',
        showChildIcons: false,
        visibility: [{ namespace: 'workforce', id: 'rostering', visible: true }],
        order: [{ namespace: 'workforce', ids: ['rostering', 'employees'] }],
      },
    });
  });

  it('rejects arbitrary ids and malformed values', () => {
    expect(sanitizeUiPreference(NAVIGATION_PREFERENCE_KEY, {
      density: 'large', showChildIcons: false, visibility: [], order: [],
    })).toBeNull();
    expect(sanitizeUiPreference(NAVIGATION_PREFERENCE_KEY, {
      density: 'comfortable', showChildIcons: false,
      visibility: [{ namespace: 'work force', id: 'rostering', visible: true }],
      order: [],
    })).toBeNull();
  });
});
