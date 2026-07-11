import { DesignerProvider } from '@/state/DesignerContext';
import { buildTemplate, DEFAULT_TEMPLATE_ID } from '@/templates';
import { blankTemplate } from '@/templates/blank';
import { reseedIds } from '@/lib/id';
import { getAutosave } from '@/lib/store/autosave';
import { Workspace } from '@/components/Workspace';

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
