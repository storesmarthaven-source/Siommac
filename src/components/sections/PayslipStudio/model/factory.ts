import type { DesignElement, ElementType, StyleProps } from '@payslip/types';
import { DEFAULT_FONT } from '@payslip/constants/fonts';
import { nextId } from '@payslip/lib/id';

export function styleDefaults(): StyleProps {
  return {
    color: '#1a2340',
    bg: 'transparent',
    fontSize: 13,
    fontFamily: DEFAULT_FONT,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    valign: 'top',
    borderW: 0,
    borderColor: '#d0d5e2',
    borderStyle: 'solid',
    radius: 0,
    padding: 6,
    lineHeight: 1.4,
  };
}

/** Highest z + 1, or 1 for an empty design. */
export function topZ(elements: readonly DesignElement[]): number {
  return elements.length ? Math.max(...elements.map((e) => e.z)) + 1 : 1;
}

export function bottomZ(elements: readonly DesignElement[]): number {
  return elements.length ? Math.min(...elements.map((e) => e.z)) - 1 : 1;
}

/** Create a new element of `type` at (x, y) with sensible defaults. */
export function createElement(type: ElementType, x: number, y: number, z: number): DesignElement {
  const base = { id: nextId(), x, y, z } as const;
  const s = styleDefaults();

  switch (type) {
    case 'heading':
      return { ...base, ...s, type, w: 360, h: 38, text: '{{company.name}}', fontSize: 22, bold: true, color: '#111a3a' };
    case 'text':
      return { ...base, ...s, type, w: 280, h: 60, text: 'Pay period: {{pay.period}}\nPay date: {{pay.date}}' };
    case 'field':
      return { ...base, ...s, type, w: 230, h: 30, label: 'Employee', token: 'employee.name', labelWidth: 90, valign: 'middle' };
    case 'box':
      return { ...base, ...s, type, w: 300, h: 120, bg: '#f4f6fa', borderW: 1, borderColor: '#e2e6ee', radius: 8, padding: 12 };
    case 'summary':
      return {
        ...base, ...s, type, w: 300, h: 96, label: 'NET PAY', token: 'pay.net',
        sub: 'Paid via {{pay.method}} on {{pay.date}}', bg: '#243049', color: '#ffffff', accent: '#ffffff',
        radius: 10, fontSize: 15, value: '',
      };
    case 'table':
      return {
        ...base, ...s, type, w: 440, h: 200, title: 'Earnings', accent: '#334155',
        rows: [
          { label: 'Basic Salary', amount: '7,200.00' },
          { label: 'Housing Allowance', amount: '1,500.00' },
          { label: 'Overtime (12h)', amount: '750.00' },
        ],
        showHead: true, showTotal: true, totalLabel: 'Gross Earnings',
        fontSize: 12, labelCol: 'Description', amtCol: 'Amount ($)',
        showHoursRate: false, hoursCol: 'Hours / Units', rateCol: 'Rate', headColor: '#ffffff', totalColor: '#243049',
      };
    case 'divider':
      return { ...base, type, w: 400, h: 2, color: '#111a3a', thickness: 2, style: 'solid' };
    case 'image':
      return { ...base, type, w: 120, h: 70, src: '', radius: 4, fit: 'contain' };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown element type: ${String(exhaustive)}`);
    }
  }
}
