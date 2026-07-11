import { DesignerProvider } from '@payslip/state/DesignerContext';
import { buildTemplate, DEFAULT_TEMPLATE_ID } from '@payslip/templates';
import { blankTemplate } from '@payslip/templates/blank';
import { reseedIds } from '@payslip/lib/id';
import { getAutosave } from '@payslip/lib/store/autosave';
import { Workspace } from '@payslip/components/Workspace';

// Restore the last auto-saved session, else open the default template.
const initialDesign = getAutosave() ?? buildTemplate(DEFAULT_TEMPLATE_ID) ?? blankTemplate();
reseedIds(initialDesign.elements.map((e) => e.id));

export function App() {
  return (
    <DesignerProvider initialDesign={initialDesign}>
      <Workspace />
    </DesignerProvider>
  );
}
