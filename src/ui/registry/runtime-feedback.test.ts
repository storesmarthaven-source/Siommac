import { Fragment, h } from 'preact';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster, toast as notify } from '../toast';
import { defaultProps, findComponent } from './index';

afterEach(() => { notify.dismiss(); cleanup(); });

describe('runtime feedback catalogue entries', () => {
  it('registers the app Toast and existing SweetAlert popup implementations', () => {
    const toast = findComponent('toast');
    const popup = findComponent('sweet-alert');

    expect(toast?.status).toBe('stable');
    expect(toast?.componentPath).toBe('src/ui/toast/Toaster.tsx');
    expect(toast?.props?.tier).toBeDefined();
    expect(Object.keys(toast?.props ?? {})).toEqual(expect.arrayContaining([
      'tier', 'tone', 'icon', 'timer', 'duration', 'progress', 'dismissible',
      'chips', 'details', 'note', 'file', 'action',
    ]));

    expect(popup?.status).toBe('stable');
    expect(popup?.componentPath).toBe('src/lib/popup.ts');
    expect(popup?.props?.tone).toBeDefined();
    expect(Object.keys(popup?.props ?? {})).toEqual(expect.arrayContaining([
      'mode', 'tone', 'showIcon', 'showCancel', 'allowDismiss', 'inputType', 'duration', 'progress',
    ]));
  });

  it('triggers the global Toast renderer from the Studio preview', () => {
    const def = findComponent('toast');
    if (!def?.render) throw new Error('Toast definition is not renderable');
    render(h(Fragment, null, def.render(defaultProps(def), 'default'), h(Toaster, {})));

    fireEvent.click(screen.getByRole('button', { name: 'Trigger toast' }));

    expect(screen.getAllByText('Changes saved')).toHaveLength(2);
    expect(document.querySelector('.siomac-toaster .siomac-toast__progress')).toBeTruthy();
  });
});
