// ============================================================================
// Settings & Preferences — value validation (Spec §15)
// ============================================================================
// Validates a candidate value against its catalog row (data_type, min/max,
// allowed_values). Throws SettingsError(400) on failure.
// ============================================================================

import { badRequest } from './errors';

export interface CatalogValidationRow {
  data_type: string;
  min_value: number | null;
  max_value: number | null;
  allowed_values: unknown[] | null;
}

export function validateSettingValue(catalog: CatalogValidationRow, value: unknown): void {
  switch (catalog.data_type) {
    case 'boolean': {
      if (typeof value !== 'boolean') throw badRequest('Value must be true or false', 'value');
      break;
    }

    case 'number':
    case 'duration': {
      if (typeof value !== 'number' || Number.isNaN(value)) throw badRequest('Value must be a number', 'value');
      if (catalog.min_value !== null && value < Number(catalog.min_value)) {
        throw badRequest(`Value must be at least ${catalog.min_value}`, 'value');
      }
      if (catalog.max_value !== null && value > Number(catalog.max_value)) {
        throw badRequest(`Value must be no more than ${catalog.max_value}`, 'value');
      }
      break;
    }

    case 'string':
    case 'time': {
      if (typeof value !== 'string') throw badRequest('Value must be text', 'value');
      break;
    }

    case 'select': {
      if (!Array.isArray(catalog.allowed_values)) throw badRequest('Setting has no allowed values configured', 'value');
      if (!catalog.allowed_values.includes(value)) throw badRequest('Value is not allowed', 'value');
      break;
    }

    case 'multi_select':
    case 'array': {
      if (!Array.isArray(value)) throw badRequest('Value must be a list', 'value');
      if (Array.isArray(catalog.allowed_values)) {
        for (const item of value) {
          if (!catalog.allowed_values.includes(item)) throw badRequest(`Value ${String(item)} is not allowed`, 'value');
        }
      }
      break;
    }

    case 'json': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw badRequest('Value must be a JSON object', 'value');
      }
      break;
    }

    default:
      throw badRequest('Unsupported setting type', 'value');
  }
}
