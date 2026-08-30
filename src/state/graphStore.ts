import { create } from "zustand";
import type { Annotation, Citation, Edge, Entity } from "../types";

/**
 * The confirmed graph: what the analyst has decided is true, plus their
 * selection and what the camera can currently see.
 *
 * Nothing outside src/state/actions.ts calls setState on this store. The
 * setters below are named `_`-prefixed as a reminder — actions.ts is the only
 * legitimate caller, for both the human's clicks and the agent's tool calls.
 */

export interface CanvasNode extends Entity {
  /** Analyst-asserted nodes carry no citation; corpus-backed ones do. */
  citations: Citation[];
  /** Set when the node arrived by accepting a proposal. Used for the material. */
  justAccepted?: number;
}

export interface CanvasEdge extends Edge {
  /** The analyst drew this by hand and no filing was found for it. */
  analystAsserted?: boolean;
  justAccepted?: number;
}

interface GraphState {
  nodes: Map<string, CanvasNode>;
  edges: Map<string, CanvasEdge>;
  annotations: Annotation[];
  selection: string[];
  /** Maintained by the canvas so get_viewport can answer honestly. */
  viewport: { visibleNodeIds: string[]; zoom: number };
  /** Bumped by actions.requestFocus; the canvas watches it and flies. */
  focusRequest: { nodeIds: string[]; nonce: number } | null;
  /** Bumped whenever the physics needs to re-settle (an accept). */
  reheat: number;

  _setNodes: (nodes: Map<string, CanvasNode>) => void;
  _setEdges: (edges: Map<string, CanvasEdge>) => void;
  _setAnnotations: (a: Annotation[]) => void;
  _setSelection: (ids: string[]) => void;
  _setViewport: (v: { visibleNodeIds: string[]; zoom: number }) => void;
  _setFocusRequest: (f: { nodeIds: string[]; nonce: number } | null) => void;
  _bumpReheat: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: new Map(),
  edges: new Map(),
  annotations: [],
  selection: [],
  viewport: { visibleNodeIds: [], zoom: 1 },
  focusRequest: null,
  reheat: 0,

  _setNodes: (nodes) => set({ nodes }),
  _setEdges: (edges) => set({ edges }),
  _setAnnotations: (annotations) => set({ annotations }),
  _setSelection: (selection) => set({ selection }),
  _setViewport: (viewport) => set({ viewport }),
  _setFocusRequest: (focusRequest) => set({ focusRequest }),
  _bumpReheat: () => set((s) => ({ reheat: s.reheat + 1 })),
}));

/** Read the store from outside React — the tool layer runs in no component. */
export const graph = () => useGraphStore.getState();
