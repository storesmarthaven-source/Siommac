/**
 * REFERENCE — merge-field resolver for the payroll page.
 *
 * The studio embeds `{{token}}` placeholders (e.g. {{employee.name}}, {{pay.net}}).
 * When payroll generates a payslip, it: (1) loads the chosen template's Design,
 * (2) builds a token map from the employee + pay-run record, (3) bakes the values
 * into the Design, (4) renders to PDF (see IMPLEMENTATION.md §10.5).
 *
 * Adjust the field paths on the right to the actual payroll/pay-run row shape.
 */

import type { Design, DesignElement } from '../../src/types';

/** Whatever the pay-run/employee join returns for one payslip. */
export interface PayslipData {
  company: { name: string; address: string; reg: string };
  employee: {
    name: string;
    id: string;
    position: string;
    department: string;
    nis: string;
    tin: string;
    bank: string;
    account: string;
  };
  pay: {
    period: string;
    date: string;
    frequency: string;
    method: string;
    currency: string;
    ref: string;
    gross: string;
    deductions: string;
    net: string;
    ytd: { gross: string; net: string };
  };
}

/** Flatten the record into the dotted keys the templates reference. */
export function buildTokenMap(d: PayslipData): Record<string, string> {
  return {
    'company.name': d.company.name,
    'company.address': d.company.address,
    'company.reg': d.company.reg,
    'employee.name': d.employee.name,
    'employee.id': d.employee.id,
    'employee.position': d.employee.position,
    'employee.department': d.employee.department,
    'employee.nis': d.employee.nis,
    'employee.tin': d.employee.tin,
    'employee.bank': d.employee.bank,
    'employee.account': d.employee.account,
    'pay.period': d.pay.period,
    'pay.date': d.pay.date,
    'pay.frequency': d.pay.frequency,
    'pay.method': d.pay.method,
    'pay.currency': d.pay.currency,
    'pay.ref': d.pay.ref,
    'pay.gross': d.pay.gross,
    'pay.deductions': d.pay.deductions,
    'pay.net': d.pay.net,
    'pay.ytd.gross': d.pay.ytd.gross,
    'pay.ytd.net': d.pay.ytd.net,
  };
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function resolve(text: string, map: Record<string, string>): string {
  return text.replace(TOKEN_RE, (m, key: string) => map[key] ?? m);
}

/**
 * Return a copy of the Design with every token replaced by real values.
 * (Note: earnings/deductions rows and GROSS/NET totals-bar values are usually
 * static per template; if you drive rows from data, populate them before render.)
 */
export function resolveDesignTokens(design: Design, map: Record<string, string>): Design {
  const elements = design.elements.map((el): DesignElement => {
    switch (el.type) {
      case 'heading':
      case 'text':
        return { ...el, text: resolve(el.text, map) };
      case 'field':
        return { ...el, label: resolve(el.label, map), token: el.token }; // value resolved at render from token
      case 'summary':
        return { ...el, sub: resolve(el.sub, map), value: el.value ? resolve(el.value, map) : el.value };
      default:
        return el;
    }
  });
  return { ...design, elements };
}
