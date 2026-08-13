import {
  BUTTON_VARIANTS, configurationToOverrides, emptyDesignSystemConfiguration,
  sanitizeDesignSystemConfiguration,
} from '../../../types/designSystem';

describe('design-system configuration contract', () => {
  it('locks Button to the six canonical variants', () => {
    expect(BUTTON_VARIANTS).toEqual(['primary', 'secondary', 'outline', 'ghost', 'danger', 'link']);
    expect(BUTTON_VARIANTS).not.toContain('credits');
    expect(BUTTON_VARIANTS).not.toContain('save');
  });

  it('keeps theme tokens and Button recipe overrides separate until runtime', () => {
    const config = emptyDesignSystemConfiguration();
    config.theme.tokens['--ui-tab-indicator'] = '#315d8c';
    config.recipes.button.overrides['--ui-button-primary-bg'] = '#173f6f';
    expect(configurationToOverrides(config)).toEqual({
      '--ui-tab-indicator': '#315d8c',
      '--ui-button-primary-bg': '#173f6f',
    });
  });

  it('rejects arbitrary CSS and non-Button recipe ownership', () => {
    const unsafe = sanitizeDesignSystemConfiguration({
      schemaVersion: 1,
      theme: { tokens: { color: 'red', '--ui-color-action': 'red; display:none' } },
      recipes: { button: { overrides: { '--ui-tab-indicator': '#fff', '--ui-button-primary-bg': 'url(https://bad)' } } },
    });
    expect(unsafe.validation.valid).toBe(false);
    expect(unsafe.validation.errors.join(' ')).toContain('governed token name');
    expect(unsafe.validation.errors.join(' ')).toContain('not owned by Button');
    expect(unsafe.validation.errors.join(' ')).toContain('invalid token value');
  });

  it('accepts governed values and calls out the independent tab semantic', () => {
    const result = sanitizeDesignSystemConfiguration({
      schemaVersion: 1,
      theme: { tokens: { '--ui-tab-indicator': 'var(--ui-color-navigation-active)' } },
      recipes: { button: { overrides: { '--ui-button-radius': '8px' } } },
    });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.warnings[0]).toContain('independent navigation semantic token');
  });
});
