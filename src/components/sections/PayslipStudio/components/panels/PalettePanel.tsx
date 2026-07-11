import type { JSX } from 'preact';
import type { ElementType } from '@payslip/types';
import { useDesigner } from '@payslip/state/DesignerContext';

interface PaletteItem {
  type: ElementType;
  label: string;
  icon: JSX.Element;
}

const ICON = (paths: JSX.Element) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    {paths}
  </svg>
);

const ITEMS: PaletteItem[] = [
  { type: 'heading', label: 'Heading', icon: ICON(<path d="M6 4v16M18 4v16M6 12h12" />) },
  { type: 'text', label: 'Text', icon: ICON(<path d="M4 7V5h16v2M9 5v14M7 19h4" />) },
  { type: 'field', label: 'Data field', icon: ICON(<><path d="M4 7h16M4 12h10M4 17h7" /><rect x="15" y="14" width="6" height="6" rx="1" /></>) },
  { type: 'table', label: 'Pay table', icon: ICON(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18M3 14h18M12 4v16" /></>) },
  { type: 'summary', label: 'Net box', icon: ICON(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M7 9h10M7 13h10M7 17h6" /></>) },
  { type: 'image', label: 'Logo / image', icon: ICON(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>) },
  { type: 'divider', label: 'Divider', icon: ICON(<path d="M3 12h18" />) },
  { type: 'box', label: 'Box / panel', icon: ICON(<rect x="3" y="3" width="18" height="18" rx="2" />) },
];

export function PalettePanel() {
  const { dispatch } = useDesigner();
  return (
    <div class="palette">
      {ITEMS.map((item) => (
        <button key={item.type} class="pal-item" onClick={() => dispatch({ kind: 'add', type: item.type })}>
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
