# Design System Studio page standard

This is the required structure for every generated component editor. The Button
family is the visual reference; the registry and canonical renderer remain the
source of truth.

## Page anatomy

1. Keep global draft, history, review and publish controls in the Studio header.
2. Show the live canonical preview first, on the white dotted canvas.
3. Put the component's variant selector directly below the live preview.
4. Put **Common application use** below the preview as real product examples.
5. Keep the right panel focused on the selected preview:
   - state selector and Reset at the top;
   - all relevant preview options visible in clear groups;
   - **Component style** as the single collapsed section.

Component size remains part of the typed runtime API, but Small/Medium/Large is
not a preview property control. The Studio previews the canonical default size;
geometry is governed through the collapsed recipe section.

Do not create a separate “More preview options” drawer. Collapsing ordinary
preview controls hides the most common work while leaving the riskier published
style controls exposed.

## Variant ownership

Every preview-axis value owns its own preview props and UI state. Changing the
Search input's icon, placeholder or focus state must not alter Email, Text or any
other input type. Returning to Search restores its previous preview session.
Reset affects only the selected variant.

This rule also applies to families and compositions: component members remain
separate definitions, and variants remain separate editing scopes inside them.

## Preview versus published style

- Preview content, props and forced states are local demonstrations. They are
  never written to the design-system draft and never published to the app.
- Component style controls edit governed recipe variables only. They inherit the
  brand theme until a deliberate component override is enabled.
- Shared recipe controls are allowed only when the definition explicitly owns a
  shared foundation. Variant-specific styling must use variant-scoped recipe
  variables and must never be simulated by reusing another variant's settings.
- Arbitrary CSS, component semantics, accessibility contracts, keyboard rules,
  ARIA behaviour and canonical variant enums are never editable.
- A published recipe must flow through the real runtime configuration and every
  canonical consumer. Studio drafts stay scoped to the preview until publish.

## Registration checklist

For every new component:

1. Register one typed `ComponentDef` with its canonical renderer and prop schema.
2. Declare a `previewAxis` and meaningful samples when the component has variants.
3. Add governed recipe controls to `style`; do not build a bespoke inspector.
4. Add real application examples where they clarify intended use.
5. Verify variant isolation, preview-only props, accessibility and runtime recipe
   application with focused tests.
6. Visually compare the finished page with the Button editor at desktop and a
   narrow viewport before considering it complete.
