// Module settings manifest registry. Add a module's manifest here once authored;
// the catalog sync + build gate read this list. (Spec §8 build order, §28.)
import type { ModuleSettingsManifest } from '../types';
import { systemManifest } from './system.manifest';
import { trainingManifest } from './training.manifest';

export const moduleSettingsManifests: ModuleSettingsManifest[] = [
  systemManifest,
  trainingManifest,
];
