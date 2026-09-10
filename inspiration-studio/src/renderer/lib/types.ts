// Authoring-time model. Grows incrementally toward the full .isx
// schema. `toIsxDocument` below emits a document that is a valid
// *subset* of the schema at every stage, never an invalid one.

export type ElementType = "container" | "text" | "button" | "shape" | "image" | "video" | "pdf" | "input";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContainerModel {
  mode: "static" | "free" | "pinnable";
  allowMove: boolean;
  moveDirection: "any" | "horizontal" | "vertical";
  allowResize: boolean;
  allowRotate: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  initialState: "normal" | "minimized" | "maximized";
  showMaximizeButton: boolean;
  showMinimizeButton: boolean;
}

export interface EffectsModel {
  blur: number;
  grayscale: number;
  sepia: number;
  hueRotation: number;
  brightness: number;
}

export const DEFAULT_CONTAINER: ContainerModel = {
  mode: "static", allowMove: true, moveDirection: "any", allowResize: true, allowRotate: true,
  initialState: "normal", showMaximizeButton: false, showMinimizeButton: false,
};
export const DEFAULT_EFFECTS: EffectsModel = { blur: 0, grayscale: 0, sepia: 0, hueRotation: 0, brightness: 100 };

export type ActionModel =
  | { type: "none" }
  | { type: "navigate"; screen: string }
  | { type: "setVariable"; variable: string; expr: string }
  | { type: "toggleVisibility"; target: string }
  | { type: "showMessage"; message: string }
  | { type: "moveTo"; target: string; x: number; y: number }
  | { type: "resizeToFactor"; target: string; factor: number }
  | { type: "rotateBy"; target: string; angleOffset: number }
  | { type: "bringToFront"; target: string }
  | { type: "sendToBack"; target: string }
  | { type: "setOpacity"; target: string; opacity: number }
  | { type: "applyEffects"; target: string; blur?: number; grayscale?: number; sepia?: number; hueRotation?: number; brightness?: number }
  | { type: "containerState"; target: string; op: "maximize" | "minimize" | "normal" | "toggleMaximize" | "toggleMinimize" }
  | { type: "collectionNext"; target: string }
  | { type: "collectionPrevious"; target: string }
  | { type: "collectionScrollToIndex"; target: string; index: number }
  | { type: "dataQuery"; source: string; into: string; query?: string }
  | { type: "remoteSend"; target: string; action: ActionModel }
  | { type: "panMap"; target: string; dx: number; dy: number }
  | { type: "zoomMap"; target: string; factor: number }
  | { type: "scrollToDate"; target: string; date: string }
  | { type: "pauseSlideshow"; target: string }
  | { type: "resumeSlideshow"; target: string };

export type TriggerType =
  | "tap" | "doubleTap" | "longPress" | "swipe"
  | "isShown" | "isHidden"
  | "hasBeenInactive" | "userActivityDetected"
  | "startsToBeManipulated" | "isManipulated"
  | "isMaximized" | "isMinimized" | "isUnmaximized" | "isUnminimized"
  | "movedIntoFocus" | "movedOutOfFocus"
  | "isDroppedOn" | "isDraggedOver" | "isDraggedAwayFrom" | "drop"
  | "pinch" | "rotate"
  | "timer";

export interface StudioEvent {
  id: string;
  trigger: TriggerType;
  action: ActionModel;
  /** swipe only */
  direction?: "left" | "right" | "up" | "down" | "any";
  /** isDroppedOn / isDraggedOver / isDraggedAwayFrom only — the zone to test against */
  target?: string;
  /** hasBeenInactive / userActivityDetected (ms) / timer (interval ms) */
  durationMs?: number;
  /** timer / hasBeenInactive */
  repeatIndefinitely?: boolean;
}

export interface StudioElement {
  id: string;
  type: ElementType;
  name: string;
  rect: Rect;
  z: number;
  rotation: number;
  visible: boolean;
  container: ContainerModel;
  effects: EffectsModel;
  props: Record<string, unknown>;
  events: StudioEvent[];
  /** Binding expressions, keyed by prop name (e.g. text -> "'Taps: ' + count"). */
  bindings?: Record<string, string>;
  children?: StudioElement[];
}

export interface StudioVariable {
  id: string;
  type: "string" | "number" | "boolean";
  initial: string | number | boolean;
}

export interface StudioDataSource {
  id: string;
  name: string;
  kind: "csv" | "json" | "rest" | "sqlite" | "excel";
  uri: string;
}

/** An embedded local file (image/video/PDF). `data` is base64 — its presence
 *  is what makes the project fully self-contained when exported to .isx. */
export interface StudioAsset {
  id: string;
  name: string;
  kind: "image" | "video" | "pdf";
  mimeType: string;
  data: string;
  bytes: number;
}

export interface StudioScreen {
  id: string;
  name: string;
  background: string;
  elements: StudioElement[];
}

export interface StudioRemoteEndpoint {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface StudioProject {
  id: string;
  name: string;
  appVersion: string;
  stage: { width: number; height: number; background: string };
  variables: StudioVariable[];
  dataSources: StudioDataSource[];
  assets: StudioAsset[];
  remoteEndpoints: StudioRemoteEndpoint[];
  screens: StudioScreen[];
  entryScreen: string;
}
