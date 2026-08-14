import { defaultProps, type ComponentDef, type PropValues } from '../registry';

/**
 * Neutral catalogue specimens describe the component itself, not a product
 * action. Editors can still demonstrate Save, Next, and other usage patterns,
 * but the family browser should never imply that those labels or icons are the
 * component's default identity.
 */
export function buttonFamilyPreviewProps(def: ComponentDef): PropValues {
  const props = defaultProps(def);

  if (def.id === 'button') {
    return { ...props, label: 'Button', iconLeft: 'None', iconRight: 'None' };
  }

  if (def.id === 'split-button') {
    return {
      ...props,
      label: 'Split button',
      iconLeft: 'None',
      menuLabel: 'More split button options',
    };
  }

  return props;
}
