import { describe, expect, it, vi } from 'vitest';
import { checkWidgetContentFit } from './contentFit';

function dimensions(element: HTMLElement, values: { clientWidth: number; clientHeight: number; scrollWidth?: number; scrollHeight?: number; rect: Partial<DOMRect> }): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: values.clientWidth },
    clientHeight: { configurable: true, value: values.clientHeight },
    scrollWidth: { configurable: true, value: values.scrollWidth ?? values.clientWidth },
    scrollHeight: { configurable: true, value: values.scrollHeight ?? values.clientHeight },
  });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: values.clientWidth, bottom: values.clientHeight,
    width: values.clientWidth, height: values.clientHeight, toJSON: () => ({}), ...values.rect,
  });
}

describe('widget content-fit validation', () => {
  it('accepts required content that remains inside the widget boundary', () => {
    const root = document.createElement('article');
    const child = document.createElement('header');
    child.dataset.widgetFitRequired = '';
    root.append(child);
    dimensions(root, { clientWidth: 320, clientHeight: 360, rect: {} });
    dimensions(child, { clientWidth: 280, clientHeight: 48, rect: { left: 20, top: 16, right: 300, bottom: 64 } });
    expect(checkWidgetContentFit(root)).toEqual({ fits: true, reasons: [], horizontalOverflow: false, verticalOverflow: false });
  });

  it('detects horizontal and vertical overflow and required content outside the card', () => {
    const root = document.createElement('article');
    const child = document.createElement('footer');
    child.dataset.widgetFitRequired = '';
    root.append(child);
    dimensions(root, { clientWidth: 280, clientHeight: 330, scrollWidth: 310, scrollHeight: 370, rect: {} });
    dimensions(child, { clientWidth: 290, clientHeight: 60, rect: { left: 12, top: 300, right: 302, bottom: 360 } });
    expect(checkWidgetContentFit(root)).toMatchObject({
      fits: false, horizontalOverflow: true, verticalOverflow: true,
      reasons: expect.arrayContaining(['container-overflow', 'required-content-outside']) as string[],
    });
  });

  it('rejects truncated full text, undersized charts, and overlapping header actions', () => {
    const root = document.createElement('article');
    const chart = document.createElement('div');
    chart.dataset.widgetFitRequired = '';
    chart.dataset.widgetMinWidth = '240';
    chart.dataset.widgetMinHeight = '120';
    const title = document.createElement('h3');
    title.dataset.widgetFitFullText = '';
    const group = document.createElement('header');
    group.dataset.widgetFitGroup = '';
    const first = document.createElement('span');
    const second = document.createElement('span');
    first.dataset.widgetFitNoOverlap = '';
    second.dataset.widgetFitNoOverlap = '';
    group.append(first, second);
    root.append(chart, title, group);
    dimensions(root, { clientWidth: 320, clientHeight: 360, rect: {} });
    dimensions(chart, { clientWidth: 200, clientHeight: 90, rect: { left: 10, top: 70, right: 210, bottom: 160 } });
    dimensions(title, { clientWidth: 100, clientHeight: 20, scrollWidth: 150, rect: { left: 10, top: 10, right: 110, bottom: 30 } });
    dimensions(group, { clientWidth: 300, clientHeight: 40, rect: { left: 10, top: 20, right: 310, bottom: 60 } });
    dimensions(first, { clientWidth: 100, clientHeight: 30, rect: { left: 10, top: 20, right: 110, bottom: 50 } });
    dimensions(second, { clientWidth: 100, clientHeight: 30, rect: { left: 90, top: 20, right: 190, bottom: 50 } });
    expect(checkWidgetContentFit(root)).toMatchObject({
      fits: false, horizontalOverflow: true, verticalOverflow: true,
      reasons: expect.arrayContaining(['required-content-too-small', 'required-text-truncated', 'required-content-overlap']) as string[],
    });
  });
});
