import { type VNode } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Tooltip } from './Tooltip';

export interface OverflowTooltipTextProps {
  text: string;
  as?: 'span' | 'strong' | 'h1' | 'h2' | 'h3';
  id?: string;
  class?: string;
  maxWidth?: number;
}

/**
 * Single-line text that exposes its complete value only when CSS truncates it.
 * ResizeObserver keeps the decision correct as responsive columns open, close,
 * or resize; short labels do not receive noisy, redundant tooltips.
 */
export function OverflowTooltipText({
  text, as = 'span', id, class: className, maxWidth = 360,
}: OverflowTooltipTextProps): VNode {
  const elementRef = useRef<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;

    const measure = (): void => {
      setTruncated(element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  const setElement = (element: HTMLElement | null): void => { elementRef.current = element; };
  const trigger = as === 'h1'
    ? <h1 ref={setElement} id={id} class={className}>{text}</h1>
    : as === 'h2'
      ? <h2 ref={setElement} id={id} class={className}>{text}</h2>
      : as === 'h3'
        ? <h3 ref={setElement} id={id} class={className}>{text}</h3>
        : as === 'strong'
          ? <strong ref={setElement} id={id} class={className}>{text}</strong>
          : <span ref={setElement} id={id} class={className}>{text}</span>;

  return <Tooltip content={text} disabled={!truncated} arrow maxWidth={maxWidth}>{trigger}</Tooltip>;
}
