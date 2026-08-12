import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('menu migration', () => {
  it('deletes the unused pre-v2 Menu runtime and barrel export', () => {
    expect(existsSync('src/ui/components/Menu.tsx')).toBe(false);
    expect(read('src/ui/index.ts')).not.toContain("from './components/Menu'");
  });

  it('moves both clean described-action menus to DropdownButton', () => {
    const training = read('src/components/sections/HSE/Training.tsx');
    const statutory = read('src/components/sections/Finance/StatutoryConfigOverview.tsx');
    expect(training).toContain('<DropdownButton');
    expect(training).not.toContain('<NewMenu');
    expect(statutory).toContain('<DropdownButton');
    expect(statutory).not.toContain('<NewMenu');
  });
});
