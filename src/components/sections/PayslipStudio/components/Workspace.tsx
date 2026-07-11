import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { useDesigner } from '@payslip/state/DesignerContext';
import { useKeyboardShortcuts } from '@payslip/hooks/useKeyboardShortcuts';
import { useAutosave } from '@payslip/hooks/useAutosave';
import { computeFitZoom } from '@payslip/lib/fit';
import { reseedIds } from '@payslip/lib/id';
import { templateStore } from '@payslip/lib/store';
import { getAutosave, getOpenRef, setOpenRef } from '@payslip/lib/store/autosave';
import { seedBuiltInTemplates } from '@payslip/templates/seed';
import { Toolbar } from './Toolbar';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { PalettePanel } from './panels/PalettePanel';
import { TokenPanel } from './panels/TokenPanel';
import { PageSetupPanel } from './panels/PageSetupPanel';
import { LayersPanel } from './panels/LayersPanel';
import { StatusBar } from './StatusBar';
import { PrintView } from './PrintView';
import { Toast } from './ui/Toast';
import { CollapsibleSection } from './ui/CollapsibleSection';

export function Workspace({ onBack }: { onBack?: () => void }) {
  const { state, dispatch } = useDesigner();
  useKeyboardShortcuts(state, dispatch);
  useAutosave(state.design);

  // Fit the page to the viewport once, after first layout.
  useLayoutEffect(() => {
    dispatch({ kind: 'setView', patch: { zoom: computeFitZoom(state.design.page) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot: seed built-ins, then link the canvas to a saved design so "Update this
  // design" is available. If the last session was editing a saved design, restore
  // that link; otherwise open the default saved design.
  useEffect(() => {
    // Capture persisted state synchronously, before the persist effect can touch it.
    const hadAutosave = getAutosave() != null;
    const openRef = getOpenRef();
    void (async () => {
      await seedBuiltInTemplates();
      const list = await templateStore.list();
      if (list.length === 0) return;

      if (hadAutosave && openRef && list.some((t) => t.id === openRef.id)) {
        // Restored autosaved work that belongs to a saved design — relink it.
        dispatch({ kind: 'setSavedRef', ref: openRef });
      } else if (!hadAutosave) {
        // Fresh session — open the default saved design.
        const def = list.find((t) => t.isDefault) ?? list[0];
        if (def) {
          reseedIds(def.design.elements.map((e) => e.id));
          dispatch({ kind: 'loadDesign', design: def.design, savedRef: { id: def.id, name: def.name } });
          window.setTimeout(() => dispatch({ kind: 'setView', patch: { zoom: computeFitZoom(def.design.page) } }), 10);
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
    setOpenRef(state.savedRef);
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
      <Toast />
    </>
  );
}
