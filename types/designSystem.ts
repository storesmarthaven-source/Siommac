/** Versioned, executable design-system configuration shared by UI and API. */
export const DESIGN_SYSTEM_SCHEMA_VERSION = 1 as const;

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'] as const;
export type CanonicalButtonVariant = typeof BUTTON_VARIANTS[number];
export const BUTTON_STATES = ['default', 'hover', 'active', 'focus', 'disabled', 'loading'] as const;
export type ButtonRecipeState = typeof BUTTON_STATES[number];

export type TokenMap = Record<string, string>;

export interface ComponentRecipeConfiguration {
  /** Absence means linked to the theme/recipe default; presence is an override. */
  overrides: TokenMap;
}

export interface DesignSystemConfigurationV1 {
  schemaVersion: typeof DESIGN_SYSTEM_SCHEMA_VERSION;
  theme: {
    tokens: TokenMap;
    /** User-curated Studio palette, versioned with the rest of the theme. */
    savedColors: string[];
  };
  recipes: {
    button: ComponentRecipeConfiguration;
    /** Governed AI Action composition; remains outside ButtonVariant. */
    aiAction?: ComponentRecipeConfiguration;
  };
}

export interface DesignSystemRevision {
  version: number;
  configuration: DesignSystemConfigurationV1;
  publishedAt: string | null;
  publishedBy: string | null;
  summary: string | null;
}

export interface DesignSystemDraft {
  id: string;
  baseVersion: number;
  revision: number;
  status: 'draft' | 'published' | 'superseded';
  configuration: DesignSystemConfigurationV1;
  validation: DesignSystemValidation;
  updatedAt: string;
  updatedBy: string;
}

export interface DesignSystemValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function emptyDesignSystemConfiguration(): DesignSystemConfigurationV1 {
  return { schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION, theme: { tokens: {}, savedColors: [] }, recipes: { button: { overrides: {} }, aiAction: { overrides: {} } } };
}

const TOKEN_NAME = /^--(?:ui|siomac|st|surface|text|border|shadow|radius|space|font|motion|ease|control|icon)-[a-z0-9-]+$/;
const UNSAFE_VALUE = /[;{}]|url\s*\(|@import|expression\s*\(/i;

function cleanTokenMap(value: unknown, errors: string[], path: string): TokenMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
    return {};
  }
  const out: TokenMap = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!TOKEN_NAME.test(name) || name.length > 80) {
      errors.push(`${path}.${name} is not a governed token name.`);
      continue;
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 160 || UNSAFE_VALUE.test(raw)) {
      errors.push(`${path}.${name} has an invalid token value.`);
      continue;
    }
    out[name] = raw.trim();
  }
  return out;
}

function cleanSavedColors(value: unknown, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('theme.savedColors must be an array.');
    return [];
  }
  if (value.length > 32) errors.push('theme.savedColors supports at most 32 colors.');
  const unique = new Set<string>();
  for (const raw of value.slice(0, 32)) {
    if (typeof raw !== 'string' || !/^#[\da-f]{6}$/i.test(raw.trim())) {
      errors.push('theme.savedColors entries must be six-digit hex colors.');
      continue;
    }
    unique.add(raw.trim().toLowerCase());
  }
  return [...unique];
}

export function sanitizeDesignSystemConfiguration(value: unknown): {
  configuration: DesignSystemConfigurationV1;
  validation: DesignSystemValidation;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const obj = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  if (obj.schemaVersion !== DESIGN_SYSTEM_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DESIGN_SYSTEM_SCHEMA_VERSION}.`);
  const theme = typeof obj.theme === 'object' && obj.theme !== null ? obj.theme as Record<string, unknown> : {};
  const recipes = typeof obj.recipes === 'object' && obj.recipes !== null ? obj.recipes as Record<string, unknown> : {};
  const button = typeof recipes.button === 'object' && recipes.button !== null ? recipes.button as Record<string, unknown> : {};
  const aiAction = typeof recipes.aiAction === 'object' && recipes.aiAction !== null ? recipes.aiAction as Record<string, unknown> : {};
  const themeTokens = cleanTokenMap(theme.tokens, errors, 'theme.tokens');
  const savedColors = cleanSavedColors(theme.savedColors, errors);
  const buttonOverrides = cleanTokenMap(button.overrides, errors, 'recipes.button.overrides');
  const aiActionOverrides = cleanTokenMap(aiAction.overrides, errors, 'recipes.aiAction.overrides');
  for (const name of Object.keys(buttonOverrides)) {
    if (!name.startsWith('--ui-button-') && !name.startsWith('--ui-toggle-')) {
      errors.push(`recipes.button.overrides.${name} is not owned by Button.`);
      delete buttonOverrides[name];
    }
  }
  for (const name of Object.keys(aiActionOverrides)) {
    if (!name.startsWith('--ui-ai-action-')) {
      errors.push(`recipes.aiAction.overrides.${name} is not owned by AI Action.`);
      delete aiActionOverrides[name];
    }
  }
  if (Object.keys(themeTokens).some(name => name === '--ui-tab-indicator')) {
    warnings.push('Tab indicator remains an independent navigation semantic token.');
  }
  return {
    configuration: { schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION, theme: { tokens: themeTokens, savedColors }, recipes: { button: { overrides: buttonOverrides }, aiAction: { overrides: aiActionOverrides } } },
    validation: { valid: errors.length === 0, errors, warnings },
  };
}

export function configurationToOverrides(configuration: DesignSystemConfigurationV1): TokenMap {
  return { ...configuration.theme.tokens, ...configuration.recipes.button.overrides, ...(configuration.recipes.aiAction?.overrides ?? {}) };
}
