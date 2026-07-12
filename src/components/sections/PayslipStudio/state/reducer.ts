import type { Design, DesignElement, ElementPatch, PageConfig, ViewState } from '@payslip/types';
import { bottomZ, createElement, topZ } from '@payslip/model/factory';
import { nextId } from '@payslip/lib/id';

const HISTORY_LIMIT = 80;

export interface SavedRef {
  id: string;
  name: string;
}

export interface DesignerState {
  design: Design;
  selectedIds: string[];
  view: ViewState;
  past: Design[];
  future: Design[];
  /** Snapshot captured at the start of a live edit (drag / typing / colour pick). */
  checkpoint: Design | null;
  /** The saved design currently open (null for an unsaved template / import). */
  savedRef: SavedRef | null;
  /** Active alignment guide lines (design-space positions) while dragging. */
  guides: { x: number[]; y: number[] };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom' | 'hdist' | 'vdist';

export interface MultiPatch {
  id: string;
  patch: ElementPatch;
}

export type Action =
  | { kind: 'select'; id: string | null; additive?: boolean }
  | { kind: 'selectIds'; ids: string[] }
  | { kind: 'add'; type: DesignElement['type']; at?: { x: number; y: number } }
  | { kind: 'insertField'; token: string; label: string }
  | { kind: 'patch'; id: string; patch: ElementPatch }
  | { kind: 'patchMany'; patches: MultiPatch[] }
  | { kind: 'endEdit' }
  | { kind: 'deleteSelected' }
  | { kind: 'duplicateSelected' }
  | { kind: 'resetElement'; id: string }
  | { kind: 'group' }
  | { kind: 'ungroup' }
  | { kind: 'align'; mode: AlignMode }
  | { kind: 'setGuides'; guides: { x: number[]; y: number[] } }
  | { kind: 'bringSelectedToFront' }
  | { kind: 'sendSelectedToBack' }
  | { kind: 'setPage'; patch: Partial<PageConfig> }
  | { kind: 'loadDesign'; design: Design; savedRef?: SavedRef | null }
  | { kind: 'setSavedRef'; ref: SavedRef | null }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'setView'; patch: Partial<ViewState> };

export function initialState(design: Design): DesignerState {
  return {
    design,
    selectedIds: [],
    view: { zoom: 1, snap: true, preview: false },
    past: [],
    future: [],
    checkpoint: null,
    savedRef: null,
    guides: { x: [], y: [] },
  };
}

function commitNow(state: DesignerState, design: Design): DesignerState {
  return {
    ...state,
    design,
    past: [...state.past, state.design].slice(-HISTORY_LIMIT),
    future: [],
    checkpoint: null,
  };
}

function mapElements(design: Design, fn: (el: DesignElement) => DesignElement): Design {
  return { ...design, elements: design.elements.map(fn) };
}

function nextInsertPos(count: number): { x: number; y: number } {
  const off = (count % 6) * 14;
  return { x: 60 + off, y: 60 + off };
}

/** All ids that move/select with `id` (its whole group, or just itself). */
function groupMates(design: Design, id: string): string[] {
  const el = design.elements.find((e) => e.id === id);
  if (!el) return [];
  if (!el.group) return [id];
  return design.elements.filter((e) => e.group === el.group).map((e) => e.id);
}

export function reducer(state: DesignerState, action: Action): DesignerState {
  switch (action.kind) {
    case 'select': {
      if (action.id == null) return { ...state, selectedIds: [] };
      const mates = groupMates(state.design, action.id);
      if (action.additive) {
        const set = new Set(state.selectedIds);
        const allIn = mates.every((m) => set.has(m));
        mates.forEach((m) => (allIn ? set.delete(m) : set.add(m)));
        return { ...state, selectedIds: [...set] };
      }
      return { ...state, selectedIds: mates };
    }

    case 'selectIds':
      return { ...state, selectedIds: action.ids };

    case 'add': {
      const pos = action.at ?? nextInsertPos(state.design.elements.length);
      const el = createElement(action.type, pos.x, pos.y, topZ(state.design.elements));
      const design = { ...state.design, elements: [...state.design.elements, el] };
      return { ...commitNow(state, design), selectedIds: [el.id] };
    }

    case 'insertField': {
      const pos = nextInsertPos(state.design.elements.length);
      const base = createElement('field', pos.x, pos.y, topZ(state.design.elements));
      const el = { ...base, token: action.token, label: action.label } as DesignElement;
      const design = { ...state.design, elements: [...state.design.elements, el] };
      return { ...commitNow(state, design), selectedIds: [el.id] };
    }

    case 'patch': {
      const checkpoint = state.checkpoint ?? state.design;
      const design = mapElements(state.design, (el) =>
        el.id === action.id ? ({ ...el, ...action.patch }) : el,
      );
      return { ...state, design, checkpoint };
    }

    case 'patchMany': {
      const checkpoint = state.checkpoint ?? state.design;
      const map = new Map(action.patches.map((p) => [p.id, p.patch]));
      const design = mapElements(state.design, (el) =>
        map.has(el.id) ? ({ ...el, ...map.get(el.id) }) : el,
      );
      return { ...state, design, checkpoint };
    }

    case 'endEdit': {
      if (!state.checkpoint || state.checkpoint === state.design) {
        return { ...state, checkpoint: null };
      }
      return {
        ...state,
        past: [...state.past, state.checkpoint].slice(-HISTORY_LIMIT),
        future: [],
        checkpoint: null,
      };
    }

    case 'deleteSelected': {
      const set = new Set(state.selectedIds);
      const design = { ...state.design, elements: state.design.elements.filter((e) => !set.has(e.id)) };
      return { ...commitNow(state, design), selectedIds: [] };
    }

    case 'duplicateSelected': {
      const set = new Set(state.selectedIds);
      const srcs = state.design.elements.filter((e) => set.has(e.id));
      if (!srcs.length) return state;
      let z = topZ(state.design.elements);
      const groupRemap = new Map<string, string>();
      const copies = srcs.map((src) => {
        let group = src.group;
        if (group) {
          if (!groupRemap.has(group)) groupRemap.set(group, `g${nextId()}`);
          group = groupRemap.get(group);
        }
        return { ...src, id: nextId(), x: src.x + 14, y: src.y + 14, z: z++, group };
      });
      const design = { ...state.design, elements: [...state.design.elements, ...copies] };
      return { ...commitNow(state, design), selectedIds: copies.map((c) => c.id) };
    }

    case 'resetElement': {
      const src = state.design.elements.find((e) => e.id === action.id);
      if (!src) return state;
      const fresh = createElement(src.type, src.x, src.y, src.z);
      const reset = { ...fresh, id: src.id, group: src.group } as DesignElement;
      return commitNow(state, mapElements(state.design, (el) => (el.id === action.id ? reset : el)));
    }

    case 'group': {
      if (state.selectedIds.length < 2) return state;
      const gid = `g${nextId()}`;
      const set = new Set(state.selectedIds);
      return commitNow(state, mapElements(state.design, (el) => (set.has(el.id) ? { ...el, group: gid } : el)));
    }

    case 'ungroup': {
      const set = new Set(state.selectedIds);
      return commitNow(
        state,
        mapElements(state.design, (el) => (set.has(el.id) && el.group ? { ...el, group: undefined } : el)),
      );
    }

    case 'align': {
      const set = new Set(state.selectedIds);
      const sel = state.design.elements.filter((e) => set.has(e.id));
      if (sel.length < 2) return state;
      const minX = Math.min(...sel.map((e) => e.x));
      const maxX = Math.max(...sel.map((e) => e.x + e.w));
      const minY = Math.min(...sel.map((e) => e.y));
      const maxY = Math.max(...sel.map((e) => e.y + e.h));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Distribute: spread the selected elements with equal gaps between them.
      const dist = new Map<string, { x?: number; y?: number }>();
      if (action.mode === 'hdist' || action.mode === 'vdist') {
        if (sel.length < 3) return state;
        const horiz = action.mode === 'hdist';
        const sorted = [...sel].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        const start = horiz ? first.x : first.y;
        const end = horiz ? last.x + last.w : last.y + last.h;
        const totalSize = sorted.reduce((s, e) => s + (horiz ? e.w : e.h), 0);
        const gap = (end - start - totalSize) / (sorted.length - 1);
        let cursor = start;
        for (const e of sorted) {
          dist.set(e.id, horiz ? { x: Math.round(cursor) } : { y: Math.round(cursor) });
          cursor += (horiz ? e.w : e.h) + gap;
        }
      }

      const patchFor = (el: DesignElement): Partial<DesignElement> => {
        switch (action.mode) {
          case 'left':
            return { x: Math.round(minX) };
          case 'right':
            return { x: Math.round(maxX - el.w) };
          case 'hcenter':
            return { x: Math.round(cx - el.w / 2) };
          case 'top':
            return { y: Math.round(minY) };
          case 'bottom':
            return { y: Math.round(maxY - el.h) };
          case 'vmiddle':
            return { y: Math.round(cy - el.h / 2) };
          case 'hdist':
          case 'vdist':
            return dist.get(el.id) ?? {};
        }
      };
      return commitNow(
        state,
        mapElements(state.design, (el) => (set.has(el.id) ? ({ ...el, ...patchFor(el) } as DesignElement) : el)),
      );
    }

    case 'setGuides':
      return { ...state, guides: action.guides };

    case 'bringSelectedToFront': {
      const set = new Set(state.selectedIds);
      let z = topZ(state.design.elements);
      return commitNow(state, mapElements(state.design, (el) => (set.has(el.id) ? { ...el, z: z++ } : el)));
    }

    case 'sendSelectedToBack': {
      const set = new Set(state.selectedIds);
      let z = bottomZ(state.design.elements) - state.selectedIds.length;
      return commitNow(state, mapElements(state.design, (el) => (set.has(el.id) ? { ...el, z: z++ } : el)));
    }

    case 'setPage':
      return commitNow(state, { ...state.design, page: { ...state.design.page, ...action.patch } });

    case 'loadDesign':
      return { ...initialState(action.design), view: state.view, savedRef: action.savedRef ?? null };

    case 'setSavedRef':
      return { ...state, savedRef: action.ref };

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        design: prev,
        past: state.past.slice(0, -1),
        future: [state.design, ...state.future],
        checkpoint: null,
        selectedIds: state.selectedIds.filter((id) => prev.elements.some((e) => e.id === id)),
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        design: next,
        past: [...state.past, state.design],
        future: state.future.slice(1),
        checkpoint: null,
        selectedIds: state.selectedIds.filter((id) => next.elements.some((e) => e.id === id)),
      };
    }

    case 'setView':
      return { ...state, view: { ...state.view, ...action.patch } };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export const canUndo = (s: DesignerState): boolean => s.past.length > 0;
export const canRedo = (s: DesignerState): boolean => s.future.length > 0;

export const selectedElements = (s: DesignerState): DesignElement[] =>
  s.design.elements.filter((e) => s.selectedIds.includes(e.id));

/** The single selected element, or undefined when 0 or 2+ are selected. */
export const selectedElement = (s: DesignerState): DesignElement | undefined =>
  s.selectedIds.length === 1 ? s.design.elements.find((e) => e.id === s.selectedIds[0]) : undefined;

export const isGrouped = (s: DesignerState): boolean =>
  selectedElements(s).some((e) => e.group);
