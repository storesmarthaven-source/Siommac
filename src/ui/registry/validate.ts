import { type ComponentDef, type PropCondition } from './types';

function conditionProps(condition: PropCondition): string[] {
  if ('prop' in condition) return [condition.prop];
  if ('stateIn' in condition) return [];
  return ('all' in condition ? condition.all : condition.any).flatMap(conditionProps);
}

/** Fail fast when registry metadata can no longer generate a truthful Studio. */
export function assertComponentRegistry(definitions: readonly ComponentDef[]): void {
  const ids = new Set<string>();
  for (const def of definitions) {
    if (ids.has(def.id)) throw new Error(`Duplicate component definition: ${def.id}`);
    ids.add(def.id);
    if (def.status === 'missing' && def.thumbnail !== 'planned') throw new Error(`${def.id}: missing definitions use the planned thumbnail`);

    for (const [name, control] of Object.entries(def.props ?? {})) {
      for (const dependency of control.visibleWhen ? conditionProps(control.visibleWhen) : []) {
        if (!def.props?.[dependency]) throw new Error(`${def.id}.${name}: visibleWhen references unknown prop "${dependency}"`);
      }
    }

    const axis = def.previewAxis;
    if (!axis) continue;
    const control = def.props?.[axis];
    if (!control || (control.type !== 'select' && control.type !== 'segmented')) {
      throw new Error(`${def.id}: previewAxis "${axis}" must reference a select or segmented prop`);
    }

    const samples = def.previewSamples ?? def.variantSamples;
    if (!samples) continue;
    const values = new Set(control.options);
    const sampleValues = new Set<string>();
    for (const sample of samples) {
      if (!values.has(sample.value)) throw new Error(`${def.id}: preview sample "${sample.value}" is not a ${axis} option`);
      if (sampleValues.has(sample.value)) throw new Error(`${def.id}: duplicate preview sample "${sample.value}"`);
      sampleValues.add(sample.value);
    }
    for (const value of values) {
      if (!sampleValues.has(value)) throw new Error(`${def.id}: ${axis} option "${value}" has no preview sample`);
    }
  }
}
