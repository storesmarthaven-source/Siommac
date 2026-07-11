import { createContext } from 'preact';
import { useContext, useMemo, useReducer } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Design } from '@/types';
import { reducer, initialState, type Action, type DesignerState } from './reducer';

interface DesignerContextValue {
  state: DesignerState;
  dispatch: (action: Action) => void;
}

const DesignerContext = createContext<DesignerContextValue | null>(null);

export function DesignerProvider({
  initialDesign,
  children,
}: {
  initialDesign: Design;
  children: ComponentChildren;
}) {
  const [state, dispatch] = useReducer(reducer, initialDesign, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <DesignerContext.Provider value={value}>{children}</DesignerContext.Provider>;
}

export function useDesigner(): DesignerContextValue {
  const ctx = useContext(DesignerContext);
  if (!ctx) throw new Error('useDesigner must be used within <DesignerProvider>');
  return ctx;
}
