import { useMemo } from 'preact/hooks';
import type { Design } from '@payslip/types';
import type { SavedRef } from '@payslip/state/reducer';
import { DesignerProvider } from '@payslip/state/DesignerContext';
import { buildTemplate, DEFAULT_TEMPLATE_ID } from '@payslip/templates';
import { blankTemplate } from '@payslip/templates/blank';
import { reseedIds } from '@payslip/lib/id';
import { Workspace } from '@payslip/components/Workspace';

interface AppProps {
  onBack?: () => void;
  /** The per-user autosaved draft (from the DB), or null to open the default. */
  draftDesign?: Design | null;
  /** Which saved template was last open (from the DB), or null. */
  openRef?: SavedRef | null;
}

export function App({ onBack, draftDesign = null, openRef = null }: AppProps) {
  // Restore the DB draft, else open the default template. Reseed ids once.
  const initialDesign = useMemo(() => {
    const d = draftDesign ?? buildTemplate(DEFAULT_TEMPLATE_ID) ?? blankTemplate();
    reseedIds(d.elements.map((e) => e.id));
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DesignerProvider initialDesign={initialDesign}>
      <Workspace onBack={onBack} initialOpenRef={openRef} hadDraft={draftDesign != null} />
    </DesignerProvider>
  );
}
