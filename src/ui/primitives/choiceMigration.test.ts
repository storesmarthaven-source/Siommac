import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('choice-control migration', () => {
  it('keeps the navigation customizer on canonical Switch without legacy switch CSS', () => {
    const source = read('src/components/nav/NavCustomizer.tsx');
    const css = read('src/components/nav/NavCustomizer.css');
    expect(source).not.toContain('function Switch(');
    expect(source).toContain('<Switch checked=');
    expect(css).not.toContain('.navcust-switch');
  });

  it('removes raw choice inputs from the clean Calendar and Finance families', () => {
    expect(read('src/components/sections/Calendar/CreateCalendarItemDialog.tsx')).not.toContain('type="checkbox"');
    expect(read('src/components/sections/Finance/payroll/setup/PayPolicyWizard.tsx')).not.toContain('type="radio"');
    expect(read('src/components/sections/Finance/payroll/setup/SodChangeWizard.tsx')).not.toContain('type="radio"');
  });
});
