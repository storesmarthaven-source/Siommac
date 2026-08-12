import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (name: string): string => fs.readFileSync(path.join(__dirname, name), 'utf8');

describe('canonical Wizard classification', () => {
  it('keeps the ordered Copy Budget flow in Wizard inside Dialog', () => {
    const text = source('BudCopyLastYearDialog.tsx');
    expect(text).toMatch(/<Dialog\b/);
    expect(text).toMatch(/<Wizard\b/);
    expect(text).toContain('validate,');
    expect(text).not.toMatch(/<HrfinWizardModal\b/);
  });

  it.each([
    'ApRecordPaymentDialog.tsx',
    'PayBridgeDialog.tsx',
    'PayWarningResolveDialog.tsx',
  ])('%s uses Dialog because its flows have exactly one step', name => {
    const text = source(name);
    expect(text).toMatch(/<Dialog\b/);
    expect(text).not.toMatch(/<Wizard\b/);
    expect(text).not.toMatch(/<HrfinWizardModal\b/);
  });
});
