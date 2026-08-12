/**
 * src/ui/navigation/Wizard — the one multi-step flow.
 *
 * There is no `WizardModal` and there will not be one: a modal wizard is
 * `<Dialog><Wizard /></Dialog>`. Owning the overlay is what made three wizard
 * implementations exist, and what stopped any of them being usable on a page.
 */

export {
  Wizard, wizardStepDomId, wizardPanelDomId,
  type WizardProps, type WizardStep, type WizardStepStatus,
  type WizardIssues, type WizardOrientation,
} from './Wizard';
