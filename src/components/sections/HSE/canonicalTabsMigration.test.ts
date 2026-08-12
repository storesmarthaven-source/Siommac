import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migratedSurfaces = [
  'Environmental.tsx',
  'EmergencyResponse.tsx',
  'Documents.tsx',
  'Contractors.tsx',
  'Workflows.tsx',
  'Training.tsx',
  'LegalCompliance.tsx',
  'Toolbox.tsx',
  'training/WorkerProfileDrawer.tsx',
  '../HR/OrgStructureOverview.tsx',
  '../NotificationCenter/NotificationCenter.tsx',
] as const;

describe('canonical Tabs migration', () => {
  it.each(migratedSurfaces)('%s uses Tabs and its matching TabPanel contract', relativePath => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');

    expect(source).toMatch(/<Tabs\b/);
    expect(source).toMatch(/<TabPanel\b/);
    expect(source).not.toMatch(/<TabBar\b/);
    expect(source).not.toMatch(/\bwithCounts\s*\(/);
    expect(source).not.toMatch(/type\s+AreaTab\b/);
  });

  it('deletes the unused pre-v2 generic Tabs runtime', () => {
    expect(fs.existsSync(path.join(__dirname, '../../../ui/components/Tabs.tsx'))).toBe(false);
  });
});
