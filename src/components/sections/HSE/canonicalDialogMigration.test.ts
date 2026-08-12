import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migratedDialogSurfaces = [
  'Environmental.tsx',
  'EmergencyResponse.tsx',
  'Documents.tsx',
  'Contractors.tsx',
  'LegalCompliance.tsx',
  'Toolbox.tsx',
  'training/TrainingDialogs.tsx',
] as const;

describe('canonical Dialog migration', () => {
  it.each(migratedDialogSurfaces)('%s composes the canonical dialog frame', relativePath => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');

    expect(source).toMatch(/<Dialog\b/);
    expect(source).toMatch(/<Dialog\.Header\b/);
    expect(source).toMatch(/<Dialog\.Body\b/);
    expect(source).toMatch(/<Dialog\.Footer\b/);
    expect(source).not.toMatch(/<HseModal\b/);
  });

  it('migrates all four live Training dialog flows', () => {
    const source = fs.readFileSync(path.join(__dirname, 'training/TrainingDialogs.tsx'), 'utf8');
    expect(source.match(/<Dialog open=/g)).toHaveLength(4);
  });
});
