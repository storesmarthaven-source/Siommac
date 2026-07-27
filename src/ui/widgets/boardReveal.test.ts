import { describe, expect, it, vi } from 'vitest';
import { requestWidgetBoardReveal, WIDGET_BOARD_REVEAL_EVENT } from './boardReveal';

describe('new widget board reveal', () => {
  it('dispatches the exact page, zone, and instance ids after an add completes', () => {
    const listener = vi.fn();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    const element = document.createElement('div');
    element.dataset.widgetInstanceId = 'one';
    const scrollIntoView = vi.fn();
    const animate = vi.fn();
    element.scrollIntoView = scrollIntoView;
    element.animate = animate;
    document.body.append(element);
    document.addEventListener(WIDGET_BOARD_REVEAL_EVENT, listener);
    requestWidgetBoardReveal({ pageKey: 'hr.employees.overview', zoneId: 'main', instanceIds: ['one', 'two'] });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      pageKey: 'hr.employees.overview', zoneId: 'main', instanceIds: ['one', 'two'],
    });
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    document.removeEventListener(WIDGET_BOARD_REVEAL_EVENT, listener);
    element.remove();
    raf.mockRestore();
  });
});
