import { useEffect, useRef } from 'preact/hooks';
import { useDesigner } from '@payslip/state/DesignerContext';
import { useKeyboardShortcuts } from '@payslip/hooks/useKeyboardShortcuts';
import { useAutosave } from '@payslip/hooks/useAutosave';
import { fitToView } from '@payslip/lib/fit';
import { reseedIds } from '@payslip/lib/id';
import type { SavedRef } from '@payslip/state/reducer';
import { templateStore } from '@payslip/lib/store';
import { saveOpenRef } from '@payslip/lib/store/autosave';
import { Toolbar } from './Toolbar';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { PalettePanel } from './panels/PalettePanel';
import { TokenPanel } from './panels/TokenPanel';
import { PageSetupPanel } from './panels/PageSetupPanel';
import { LayersPanel } from './panels/LayersPanel';
import { StatusBar } from './StatusBar';
import { PrintView } from './PrintView';
import { CollapsibleSection } from './ui/CollapsibleSection';

interface WorkspaceProps {
  onBack?: () => void;
  /** The DB open-ref captured at boot (from the per-user editor state). */
  initialOpenRef?: SavedRef | null;
  /** Whether the initial design came from a restored draft (vs the default). */
  hadDraft?: boolean;
}

export function Workspace({ onBack, initialOpenRef = null, hadDraft = false }: WorkspaceProps) {
  const { state, dispatch } = useDesigner();
  useKeyboardShortcuts(state, dispatch);
  useAutosave(state.design);

  // Fit the page to the canvas once the canvas-wrap actually has dimensions, and
  // re-fit when the page size/orientation changes (a design loads, or page setup
  // changes). Waiting for a real size avoids measuring the container before the
  // full-page overlay + wrapped toolbar have laid out — which was clamping the
  // opening zoom to the 25% minimum ("opens zoomed out small").
  useEffect(() => {
    return fitToView((zoom) => dispatch({ kind: 'setView', patch: { zoom } }), state.design.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.design.page.size, state.design.page.orient]);

  // Boot: link the canvas to a saved design so "Update this design" is available.
  // If the last session was editing a saved design, restore that link; otherwise
  // open the default saved design. Built-in templates are NO LONGER seeded here
  // automatically — auto-seeding a production is_default at boot can make the
  // renderer print demo/seeded figures on real payslips. Seeding is now explicit:
  // use the "Load starter templates" button inside the Designs menu when the list
  // is empty.
  useEffect(() => {
    // The draft + open-ref were loaded from the DB before mount and passed in.
    void (async () => {
      const list = await templateStore.list();
      if (list.length === 0) return;

      if (hadDraft && initialOpenRef && list.some((t) => t.id === initialOpenRef.id)) {
        // Restored draft that belongs to a saved design — relink it.
        dispatch({ kind: 'setSavedRef', ref: initialOpenRef });
      } else if (!hadDraft) {
        // Fresh session — open the default saved design.
        const def = list.find((t) => t.isDefault) ?? list[0];
        if (def) {
          reseedIds(def.design.elements.map((e) => e.id));
          dispatch({ kind: 'loadDesign', design: def.design, savedRef: { id: def.id, name: def.name } });
          fitToView((zoom) => dispatch({ kind: 'setView', patch: { zoom } }), def.design.page);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist which saved design is open (survives reloads). Skip the initial render
  // so the stored ref isn't wiped before the boot effect reads it.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    saveOpenRef(state.savedRef);
  }, [state.savedRef]);

  return (
    <>
      <div class="app">
        <Toolbar onBack={onBack} />
        <div class="body">
          <aside class="panel panel-left">
            <div class="panel-scroll">
              <CollapsibleSection title="Add element">
                <PalettePanel />
              </CollapsibleSection>
              <CollapsibleSection title="Data fields">
                <TokenPanel />
              </CollapsibleSection>
              <CollapsibleSection title="Page setup" defaultOpen={false}>
                <PageSetupPanel />
              </CollapsibleSection>
            </div>
          </aside>

          <Canvas />

          <aside class="panel panel-right">
            <div class="panel-scroll">
              <h4>Properties</h4>
              <Inspector />
              <CollapsibleSection title="Layers">
                <LayersPanel />
              </CollapsibleSection>
            </div>
          </aside>
        </div>
        <StatusBar />
      </div>

      <PrintView />
    </>
  );
}
