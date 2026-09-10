import { evalExpr, evalValue } from "./expr";
import { clampZoom, panToCenter, computeTimelineWindow, recenterTimelineWindow, type MapView, type TimelineWindow } from "./collections-geo";

// ---- loose types for the parts of an .isx doc the runtime executes ----
export interface IsxDoc {
  format: "isx";
  schemaVersion: string;
  meta: { id: string; name: string };
  stage: { width: number; height: number; background?: string; scaleMode?: string };
  variables?: { id: string; type: string; initial: unknown }[];
  dataSources?: { id: string; kind: string; uri: string }[];
  assets?: { id: string; kind: string; uri: string; mimeType?: string; data?: string; bytes?: number }[];
  hardware?: { id: string; name?: string; channel: string; emits: string }[];
  remoteEndpoints?: { id: string; name?: string; host: string; port: number }[];
  entryScreen: string;
  screens: IsxScreen[];
}
export interface IsxScreen {
  id: string;
  name?: string;
  background?: string;
  elements: IsxElement[];
  events?: IsxEvent[];
}
export interface ContainerConfig {
  mode?: "static" | "free" | "pinnable";
  visibleToInteractivity?: boolean;
  allowMove?: boolean;
  moveDirection?: "any" | "horizontal" | "vertical";
  allowResize?: boolean;
  allowRotate?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  initialState?: "normal" | "minimized" | "maximized";
  showMaximizeButton?: boolean;
  showMinimizeButton?: boolean;
  showCloseButton?: boolean;
}
export interface EffectsConfig {
  blur?: number;
  grayscale?: number;
  sepia?: number;
  hueRotation?: number;
  brightness?: number;
}
export interface IsxElement {
  id: string;
  type: string;
  name?: string;
  layout: { x: number; y: number; width: number; height: number; z?: number; rotation?: number; opacity?: number };
  visible?: boolean;
  container?: ContainerConfig;
  effects?: EffectsConfig;
  props: Record<string, unknown>;
  bindings?: Record<string, string>;
  children?: IsxElement[];
  events?: IsxEvent[];
}
export interface IsxEvent {
  on: string;
  when?: string;
  intervalMs?: number;
  repeatIndefinitely?: boolean;
  runCount?: number;
  durationMs?: number;
  binding?: string;
  source?: string;
  target?: string;
  direction?: "left" | "right" | "up" | "down" | "any";
  do: IsxAction[];
}
export type IsxAction = { type: string; [k: string]: unknown };

export type HttpFetcher = (opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }) => Promise<{ ok: boolean; status?: number; json?: unknown; text?: string; error?: string }>;
export type LocalDataReader = (opts: { kind: string; uri: string; basePath?: string | null; query?: string }) => Promise<{ ok: boolean; rows?: unknown[]; error?: string }>;

export interface RuntimeCallbacks {
  onToast?: (message: string) => void;
  onScriptBlocked?: (elementId: string | undefined, error: string) => void;
  onDataError?: (sourceId: string, error: string) => void;
  onRemoteError?: (targetId: string, error: string) => void;
  httpFetch?: HttpFetcher;
  readLocalData?: LocalDataReader;
  /** The currently open .isx file's path, used to resolve relative dataSource URIs. */
  basePath?: string | null;
}

export type ContainerState = "normal" | "minimized" | "maximized";

export interface ElementOverride {
  visible?: boolean;
  props?: Record<string, unknown>;
  rect?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  opacity?: number;
  effects?: EffectsConfig;
  z?: number;
  interactive?: boolean;
  containerState?: ContainerState;
  focusIndex?: number;
  mapView?: MapView;
  timelineWindow?: TimelineWindow;
  paused?: boolean;
  savedRect?: { x: number; y: number; width: number; height: number; rotation: number };
}

const DEFAULT_DOUBLE_TAP_WINDOW_MS = 300;

/**
 * IsxRuntime — the shared execution core. Holds variable/data state,
 * per-element overrides (visibility, position/size/rotation/opacity/
 * effects/z-order, container state), and executes the full Tier-1
 * action grammar plus container-state and manipulation triggers. Has
 * no rendering code and no DOM dependency, so it can be driven from
 * React (see App.tsx) or from a headless test (see runtime.test.ts)
 * identically.
 */
export class IsxRuntime {
  doc: IsxDoc;
  screenId: string;
  variables: Record<string, unknown> = {};
  data: Record<string, unknown> = {};
  overrides: Record<string, ElementOverride> = {};
  private timers: ReturnType<typeof setInterval>[] = [];
  private cb: RuntimeCallbacks;
  private listeners = new Set<() => void>();
  private zCounter = 1000; // bringToFront seeds from here — assumes authored z values stay well below 1000
  private backCounter = 0; // sendToBack counts down from 0 — assumes authored z values are non-negative (the schema's documented convention)
  private pendingTap: Record<string, ReturnType<typeof setTimeout>> = {};
  private lastInteractionAt = Date.now();
  private inactivityArmedAt: Record<string, number> = {};
  private userActivityFired: Record<string, boolean> = {};

  constructor(doc: IsxDoc, cb: RuntimeCallbacks = {}) {
    this.doc = doc;
    this.cb = cb;
    this.screenId = doc.entryScreen;
    for (const v of doc.variables || []) this.variables[v.id] = v.initial;
    for (const s of doc.screens) this.applyInitialContainerStates(s.elements);
  }

  private applyInitialContainerStates(els: IsxElement[]) {
    for (const el of els) {
      const initial = el.container?.initialState;
      if (initial && initial !== "normal") {
        this.overrides[el.id] = { containerState: initial };
      }
      if (el.children) this.applyInitialContainerStates(el.children);
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() { this.listeners.forEach((fn) => fn()); }

  get screen(): IsxScreen {
    return this.doc.screens.find((s) => s.id === this.screenId) || this.doc.screens[0];
  }

  scope(eventCtx: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...this.variables, data: this.data, event: eventCtx };
  }

  findElement(id: string, els: IsxElement[] = this.screen.elements): IsxElement | undefined {
    for (const e of els) {
      if (e.id === id) return e;
      if (e.children) { const c = this.findElement(id, e.children); if (c) return c; }
    }
    return undefined;
  }

  private override(id: string): ElementOverride {
    return this.overrides[id] || (this.overrides[id] = {});
  }

  isVisible(id: string): boolean {
    const o = this.overrides[id];
    if (o && "visible" in o) return !!o.visible;
    const el = this.findElement(id);
    return el ? el.visible !== false : true;
  }

  isInteractive(id: string): boolean {
    const o = this.overrides[id];
    if (o && "interactive" in o) return !!o.interactive;
    return true;
  }

  containerStateOf(id: string): ContainerState {
    return this.overrides[id]?.containerState || "normal";
  }

  effectiveRect(id: string): { x: number; y: number; width: number; height: number } {
    const el = this.findElement(id);
    const o = this.overrides[id];
    if (o?.rect) return o.rect;
    return el ? { x: el.layout.x, y: el.layout.y, width: el.layout.width, height: el.layout.height } : { x: 0, y: 0, width: 0, height: 0 };
  }
  effectiveRotation(id: string): number {
    const el = this.findElement(id);
    const o = this.overrides[id];
    if (o && "rotation" in o) return o.rotation!;
    return el?.layout.rotation ?? 0;
  }
  effectiveOpacity(id: string): number {
    const el = this.findElement(id);
    const o = this.overrides[id];
    if (o && "opacity" in o) return o.opacity!;
    return el?.layout.opacity ?? 1;
  }
  effectiveEffects(id: string): Required<EffectsConfig> {
    const el = this.findElement(id);
    const base: Required<EffectsConfig> = { blur: 0, grayscale: 0, sepia: 0, hueRotation: 0, brightness: 100 };
    const authored = el?.effects || {};
    const o = this.overrides[id]?.effects || {};
    return { ...base, ...authored, ...o };
  }
  effectiveZ(id: string): number {
    const el = this.findElement(id);
    const o = this.overrides[id];
    if (o && "z" in o) return o.z!;
    return el?.layout.z ?? 0;
  }

  private resolveTarget(a: IsxAction, eventCtx: Record<string, unknown>): string | undefined {
    return (a.target as string | undefined) ?? (eventCtx.__elementId as string | undefined);
  }

  startScreenLifecycle() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.lastInteractionAt = Date.now();
    this.inactivityArmedAt = {};
    this.userActivityFired = {};
    const now = Date.now();

    const runOwner = (owner: { events?: IsxEvent[] }, ctx: Record<string, unknown>, ownerKey: string) => {
      for (const e of owner.events || []) {
        if (e.on === "load") void this.runActions(e.do, ctx);

        if (e.on === "timer" && e.intervalMs) {
          let count = 0;
          const id = setInterval(() => {
            count++;
            void this.runActions(e.do, ctx);
            if (!e.repeatIndefinitely && e.runCount && count >= e.runCount) clearInterval(id);
          }, e.intervalMs);
          this.timers.push(id);
        }

        if (e.on === "hasBeenInactive" && e.durationMs) {
          const id = setInterval(() => {
            const idleFor = Date.now() - this.lastInteractionAt;
            if (idleFor >= e.durationMs!) {
              void this.runActions(e.do, ctx);
              this.lastInteractionAt = Date.now();
              if (e.repeatIndefinitely === false) clearInterval(id);
            }
          }, Math.min(1000, e.durationMs));
          this.timers.push(id);
        }

        if (e.on === "userActivityDetected" && e.durationMs) {
          const key = `${ownerKey}:${e.on}:${e.durationMs}`;
          this.inactivityArmedAt[key] = now;
          this.userActivityFired[key] = false;
        }
      }
    };
    runOwner(this.screen, {}, "screen");
    const walk = (els: IsxElement[]) => els.forEach((el) => {
      runOwner(el, { __elementId: el.id }, el.id);
      if ((el.props as any)?.arrange === "slideshow" && el.children && el.children.length > 1) {
        const durationMs = (el.props as any).slideDurationMs ?? 5000;
        const id = setInterval(() => {
          if (!this.isCollectionPaused(el.id)) this.collectionNext(el.id);
        }, durationMs);
        this.timers.push(id);
      }
      if (el.children) walk(el.children);
    });
    walk(this.screen.elements);
    this.initializeCollectionFocus();
  }

  private noteInteraction(ownerEvents: IsxEvent[] | undefined, ctx: Record<string, unknown>) {
    this.lastInteractionAt = Date.now();
    for (const e of ownerEvents || []) {
      if (e.on !== "userActivityDetected" || !e.durationMs) continue;
      const key = `${(ctx.__elementId as string) || "screen"}:${e.on}:${e.durationMs}`;
      const armedAt = this.inactivityArmedAt[key];
      if (armedAt !== undefined && !this.userActivityFired[key] && Date.now() - armedAt >= e.durationMs) {
        this.userActivityFired[key] = true;
        void this.runActions(e.do, ctx);
      }
    }
  }

  dispose() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    Object.values(this.pendingTap).forEach(clearTimeout);
    this.pendingTap = {};
    Object.values(this.pendingLongPress).forEach(clearTimeout);
    this.pendingLongPress = {};
  }

  private touchPoints: Record<string, Map<number, { x: number; y: number }>> = {}; // elementId -> pointerId -> position
  private gestureBaseline: Record<string, { dist: number; angle: number }> = {}; // elementId -> baseline dist/angle when the 2nd finger joined

  private static twoPointGeometry(pts: { x: number; y: number }[]): { dist: number; angle: number } {
    const [a, b] = pts;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { dist: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }

  /** Register a finger down on an element. Once a 2nd finger joins, a pinch/rotate baseline is captured. */
  multiTouchStart(elementId: string, pointerId: number, x: number, y: number) {
    const map = this.touchPoints[elementId] || (this.touchPoints[elementId] = new Map());
    map.set(pointerId, { x, y });
    if (map.size === 2) {
      this.gestureBaseline[elementId] = IsxRuntime.twoPointGeometry([...map.values()]);
    }
  }

  /** Update a tracked finger's position. With exactly 2 fingers down, fires pinch (event.scale) and rotate (event.angle, degrees delta) continuously. */
  multiTouchMove(elementId: string, pointerId: number, x: number, y: number) {
    const map = this.touchPoints[elementId];
    if (!map || !map.has(pointerId)) return;
    map.set(pointerId, { x, y });
    if (map.size !== 2) return;
    const baseline = this.gestureBaseline[elementId];
    if (!baseline) return;
    const cur = IsxRuntime.twoPointGeometry([...map.values()]);
    const scale = baseline.dist > 0 ? cur.dist / baseline.dist : 1;
    let angleDelta = cur.angle - baseline.angle;
    if (angleDelta > 180) angleDelta -= 360;
    if (angleDelta < -180) angleDelta += 360;

    const el = this.findElement(elementId);
    const pinchEv = el?.events?.find((e) => e.on === "pinch");
    if (pinchEv) void this.runActions(pinchEv.do, { __elementId: elementId, scale });
    const rotateEv = el?.events?.find((e) => e.on === "rotate");
    if (rotateEv) void this.runActions(rotateEv.do, { __elementId: elementId, angle: angleDelta });
  }

  /** Release a tracked finger. If the gesture drops back to <2 fingers, the baseline resets for next time. */
  multiTouchEnd(elementId: string, pointerId: number) {
    const map = this.touchPoints[elementId];
    if (!map) return;
    map.delete(pointerId);
    if (map.size < 2) delete this.gestureBaseline[elementId];
    if (map.size === 0) delete this.touchPoints[elementId];
  }

  /**
   * Resolves an element's props (assetId or a raw uri) to a usable src.
   * When assetId points to an embedded asset (asset.data present), returns
   * a data: URI built from the embedded base64 — the runtime never touches
   * the filesystem/network for it, which is what makes a document with
   * embedded assets fully self-contained and portable. Falls back to a
   * raw uri (external reference) when there's no embedded asset.
   */
  resolveAssetSrc(props: { assetId?: unknown; uri?: unknown }): string {
    const assetId = props.assetId as string | undefined;
    if (assetId) {
      const asset = (this.doc.assets || []).find((a) => a.id === assetId);
      if (asset?.data && asset.mimeType) return `data:${asset.mimeType};base64,${asset.data}`;
      if (asset?.uri) return asset.uri; // asset entry exists but isn't embedded — external reference
    }
    return (props.uri as string) || "";
  }

  getMapView(collectionId: string): MapView {
    return this.overrides[collectionId]?.mapView || { panX: 0, panY: 0, zoom: 1 };
  }

  panMap(collectionId: string, dx: number, dy: number) {
    const cur = this.getMapView(collectionId);
    this.override(collectionId).mapView = { ...cur, panX: cur.panX + dx, panY: cur.panY + dy };
    this.notify();
  }

  zoomMap(collectionId: string, factor: number) {
    const el = this.findElement(collectionId);
    const min = (el?.props as any)?.mapMinZoom ?? 0.5;
    const max = (el?.props as any)?.mapMaxZoom ?? 4;
    const cur = this.getMapView(collectionId);
    this.override(collectionId).mapView = { ...cur, zoom: clampZoom(cur.zoom * factor, min, max) };
    this.notify();
  }

  /** Centers the map view on a normalized (0-1) point — used by "center on marker N" and by scrollToIndex on a map collection. */
  centerMapOn(collectionId: string, mapX: number, mapY: number, containerW: number, containerH: number) {
    const cur = this.getMapView(collectionId);
    const { panX, panY } = panToCenter(mapX, mapY, cur.zoom, containerW, containerH);
    this.override(collectionId).mapView = { ...cur, panX, panY };
    this.notify();
  }

  getTimelineWindow(collectionId: string): TimelineWindow {
    const existing = this.overrides[collectionId]?.timelineWindow;
    if (existing) return existing;
    const el = this.findElement(collectionId);
    const childDates = (el?.children || []).map((c) => (c.props as any)?.date).filter(Boolean);
    const w = computeTimelineWindow(childDates, (el?.props as any)?.timelineStart, (el?.props as any)?.timelineEnd);
    this.override(collectionId).timelineWindow = w;
    return w;
  }

  scrollTimelineToDate(collectionId: string, iso: string) {
    const cur = this.getTimelineWindow(collectionId);
    this.override(collectionId).timelineWindow = recenterTimelineWindow(cur, iso);
    this.notify();
  }

  /** Shifts the visible timeline window by a relative amount (ms) — used by drag-to-scrub. */
  shiftTimelineWindow(collectionId: string, deltaMs: number) {
    const cur = this.getTimelineWindow(collectionId);
    this.override(collectionId).timelineWindow = { start: cur.start + deltaMs, end: cur.end + deltaMs };
    this.notify();
  }

  fireDeviceEvent(bindingId: string, eventData: Record<string, unknown> = {}) {
    for (const e of this.screen.events || []) {
      if (e.on === "device" && e.binding === bindingId) void this.runActions(e.do, { binding: bindingId, ...eventData });
    }
  }

  private pendingLongPress: Record<string, ReturnType<typeof setTimeout>> = {};
  private longPressFired: Set<string> = new Set();
  private swipeStart: Record<string, { x: number; y: number; t: number }> = {};
  private dragOverState: Record<string, Set<string>> = {}; // draggedId -> set of target ids currently overlapping

  /** Called by the UI when a bound <input>'s value changes (two-way binding). Updates the variable and fires valueChange on the input element itself. */
  setVariableFromInput(elementId: string, variableId: string, value: unknown) {
    this.variables[variableId] = value;
    this.notify();
    const el = this.findElement(elementId);
    const ev = el?.events?.find((e) => e.on === "valueChange");
    if (ev) void this.runActions(ev.do, { __elementId: elementId, value });
  }

  fireTap(elementId: string) {
    const el = this.findElement(elementId);
    if (!el) return;
    this.noteInteraction(el.events, { __elementId: elementId });
    const hasDouble = el.events?.some((e) => e.on === "doubleTap");
    if (!hasDouble) {
      const ev = el.events?.find((e) => e.on === "tap");
      if (ev) void this.runActions(ev.do, { __elementId: elementId });
      return;
    }
    if (this.pendingTap[elementId]) {
      clearTimeout(this.pendingTap[elementId]);
      delete this.pendingTap[elementId];
      const dev = el.events?.find((e) => e.on === "doubleTap");
      if (dev) void this.runActions(dev.do, { __elementId: elementId });
      return;
    }
    this.pendingTap[elementId] = setTimeout(() => {
      delete this.pendingTap[elementId];
      const ev = el.events?.find((e) => e.on === "tap");
      if (ev) void this.runActions(ev.do, { __elementId: elementId });
    }, DEFAULT_DOUBLE_TAP_WINDOW_MS);
  }

  /** Call on pointer-down for any (non-manipulable) element that might have a longPress or swipe trigger. */
  pressStart(elementId: string, x: number, y: number) {
    const el = this.findElement(elementId);
    if (!el) return;
    this.swipeStart[elementId] = { x, y, t: Date.now() };
    const hasLongPress = el.events?.some((e) => e.on === "longPress");
    if (!hasLongPress) return;
    this.longPressFired.delete(elementId);
    this.pendingLongPress[elementId] = setTimeout(() => {
      this.longPressFired.add(elementId);
      const ev = el.events?.find((e) => e.on === "longPress");
      if (ev) void this.runActions(ev.do, { __elementId: elementId });
    }, 500);
  }

  /** Call on pointer-up. Returns true if the interaction was consumed as a long-press or swipe (caller should skip firing a tap). */
  pressEnd(elementId: string, x: number, y: number): boolean {
    if (this.pendingLongPress[elementId]) { clearTimeout(this.pendingLongPress[elementId]); delete this.pendingLongPress[elementId]; }
    const consumedByLongPress = this.longPressFired.has(elementId);
    this.longPressFired.delete(elementId);

    const start = this.swipeStart[elementId];
    delete this.swipeStart[elementId];
    if (!start) return consumedByLongPress;
    const dx = x - start.x, dy = y - start.y;
    const dt = Date.now() - start.t;
    const dist = Math.hypot(dx, dy);
    const SWIPE_MIN_DIST = 40, SWIPE_MAX_MS = 600;
    if (dist >= SWIPE_MIN_DIST && dt <= SWIPE_MAX_MS) {
      const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      const el = this.findElement(elementId);
      const ev = el?.events?.find((e) => e.on === "swipe" && (e.direction === direction || !e.direction || e.direction === "any"));
      if (ev) { void this.runActions(ev.do, { __elementId: elementId, direction }); return true; }
    }
    return consumedByLongPress;
  }

  startManipulation(elementId: string) {
    const el = this.findElement(elementId);
    this.noteInteraction(el?.events, { __elementId: elementId });
    this.dragOverState[elementId] = new Set();
    const ev = el?.events?.find((e) => e.on === "startsToBeManipulated");
    if (ev) void this.runActions(ev.do, { __elementId: elementId });
    const dragStartEv = el?.events?.find((e) => e.on === "dragStart");
    if (dragStartEv) void this.runActions(dragStartEv.do, { __elementId: elementId });
  }

  endManipulation(elementId: string) {
    const el = this.findElement(elementId);
    const ev = el?.events?.find((e) => e.on === "isManipulated");
    if (ev) void this.runActions(ev.do, { __elementId: elementId });
    const dragEndEv = el?.events?.find((e) => e.on === "dragEnd");
    if (dragEndEv) void this.runActions(dragEndEv.do, { __elementId: elementId });

    for (const e of el?.events || []) {
      if (e.on !== "isDroppedOn" || !e.target) continue;
      if (this.rectsOverlap(this.effectiveRect(elementId), this.effectiveRect(e.target))) {
        void this.runActions(e.do, { __elementId: elementId, target: e.target });
        const targetEl = this.findElement(e.target);
        const dropEv = targetEl?.events?.find((ev2) => ev2.on === "drop");
        if (dropEv) void this.runActions(dropEv.do, { __elementId: e.target, droppedElementId: elementId });
      }
    }
    delete this.dragOverState[elementId];
  }

  private rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    // Convention check: layout.x/y is the TOP-LEFT corner throughout this project
    // (rendering uses `left: x, top: y` directly) — NOT a center point.
    const aL = a.x, aR = a.x + a.width, aT = a.y, aB = a.y + a.height;
    const bL = b.x, bR = b.x + b.width, bT = b.y, bB = b.y + b.height;
    return aL < bR && aR > bL && aT < bB && aB > bT;
  }

  updateManipulation(elementId: string, patch: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>) {
    const el = this.findElement(elementId);
    if (!el) return;
    const container = el.container;
    if (!container || container.mode === "static") return;
    const cur = this.effectiveRect(elementId);
    const curRot = this.effectiveRotation(elementId);
    let { x = cur.x, y = cur.y, width = cur.width, height = cur.height } = patch;
    const rotation = patch.rotation ?? curRot;

    if (container.allowMove === false) { x = cur.x; y = cur.y; }
    else if (container.moveDirection === "horizontal") y = cur.y;
    else if (container.moveDirection === "vertical") x = cur.x;

    if (container.allowResize === false) { width = cur.width; height = cur.height; }
    if (container.minWidth != null) width = Math.max(container.minWidth, width);
    if (container.minHeight != null) height = Math.max(container.minHeight, height);
    if (container.maxWidth != null) width = Math.min(container.maxWidth, width);
    if (container.maxHeight != null) height = Math.min(container.maxHeight, height);

    const o = this.override(elementId);
    o.rect = { x, y, width, height };
    if (container.allowRotate !== false) o.rotation = rotation;
    this.notify();

    // continuous drag-over tracking (edge-triggered enter/leave against each declared target)
    const overlapSet = this.dragOverState[elementId] || (this.dragOverState[elementId] = new Set());
    const newRect = { x, y, width, height };
    const targets = new Set<string>();
    for (const e of el.events || []) {
      if ((e.on === "isDraggedOver" || e.on === "isDraggedAwayFrom") && e.target) targets.add(e.target);
    }
    const transitions = new Map<string, "entered" | "left" | "none">();
    for (const targetId of targets) {
      const isOver = this.rectsOverlap(newRect, this.effectiveRect(targetId));
      const wasOver = overlapSet.has(targetId);
      if (isOver && !wasOver) { overlapSet.add(targetId); transitions.set(targetId, "entered"); }
      else if (!isOver && wasOver) { overlapSet.delete(targetId); transitions.set(targetId, "left"); }
      else transitions.set(targetId, "none");
    }
    for (const e of el.events || []) {
      if (!e.target) continue;
      const t = transitions.get(e.target);
      if (e.on === "isDraggedOver" && t === "entered") void this.runActions(e.do, { __elementId: elementId, target: e.target });
      if (e.on === "isDraggedAwayFrom" && t === "left") void this.runActions(e.do, { __elementId: elementId, target: e.target });
    }
  }

  navigate(screenId: string) {
    if (!this.doc.screens.find((s) => s.id === screenId)) return;
    this.screenId = screenId;
    this.overrides = {};
    this.notify();
    this.startScreenLifecycle();
  }

  private setVisible(target: string, visible: boolean) {
    const before = this.isVisible(target);
    this.override(target).visible = visible;
    if (before !== visible) {
      const el = this.findElement(target);
      const ev = el?.events?.find((e) => e.on === (visible ? "isShown" : "isHidden"));
      if (ev) void this.runActions(ev.do, { __elementId: target });
    }
  }

  getFocusIndex(collectionId: string): number {
    return this.overrides[collectionId]?.focusIndex ?? 0;
  }

  private setFocusIndex(collectionId: string, rawIndex: number) {
    const el = this.findElement(collectionId);
    const children = el?.children || [];
    if (!children.length) return;
    const loop = !!(el?.props as any)?.loop;
    let index = rawIndex;
    if (loop) index = ((rawIndex % children.length) + children.length) % children.length;
    else index = Math.max(0, Math.min(children.length - 1, rawIndex));

    const prevIndex = this.getFocusIndex(collectionId);
    if (index === prevIndex && this.overrides[collectionId]?.focusIndex !== undefined) return;

    const prevChild = children[prevIndex];
    const nextChild = children[index];
    this.override(collectionId).focusIndex = index;
    this.notify();

    if (prevChild && prevChild.id !== nextChild?.id) {
      const outEv = prevChild.events?.find((e) => e.on === "movedOutOfFocus");
      if (outEv) void this.runActions(outEv.do, { __elementId: prevChild.id });
    }
    if (nextChild) {
      const inEv = nextChild.events?.find((e) => e.on === "movedIntoFocus");
      if (inEv) void this.runActions(inEv.do, { __elementId: nextChild.id });
    }
  }

  collectionNext(collectionId: string) { this.setFocusIndex(collectionId, this.getFocusIndex(collectionId) + 1); }
  collectionPrevious(collectionId: string) { this.setFocusIndex(collectionId, this.getFocusIndex(collectionId) - 1); }
  collectionScrollToIndex(collectionId: string, index: number) { this.setFocusIndex(collectionId, index); }

  /** Establishes initial focus (index 0, firing movedIntoFocus) for every indexed collection on the screen. */
  isCollectionPaused(collectionId: string): boolean {
    return !!this.overrides[collectionId]?.paused;
  }
  pauseCollection(collectionId: string) {
    this.override(collectionId).paused = true;
    this.notify();
  }
  resumeCollection(collectionId: string) {
    this.override(collectionId).paused = false;
    this.notify();
  }

  private initializeCollectionFocus() {
    const walk = (els: IsxElement[]) => els.forEach((el) => {
      const arrange = (el.props as any)?.arrange;
      if (["grid", "carousel", "map", "timeline", "slideshow", "swap", "picker"].includes(arrange) && el.children?.length && this.overrides[el.id]?.focusIndex === undefined) {
        const first = el.children[0];
        this.override(el.id).focusIndex = 0;
        const inEv = first.events?.find((e) => e.on === "movedIntoFocus");
        if (inEv) void this.runActions(inEv.do, { __elementId: first.id });
      }
      if (el.children) walk(el.children);
    });
    walk(this.screen.elements);
  }

  private setContainerState(target: string, next: ContainerState) {
    const el = this.findElement(target);
    if (!el || !el.container || el.container.mode === "static" || el.container.mode === undefined) return;
    const o = this.override(target);
    const prev = o.containerState || "normal";
    if (prev === next) return;

    if (next === "maximized") {
      o.savedRect = { ...this.effectiveRect(target), rotation: this.effectiveRotation(target) };
      o.rect = { x: 0, y: 0, width: this.doc.stage.width, height: this.doc.stage.height };
      o.rotation = 0;
    } else if (next === "minimized") {
      o.savedRect = { ...this.effectiveRect(target), rotation: this.effectiveRotation(target) };
      const w = 96, h = 96;
      o.rect = { x: 12, y: this.doc.stage.height - h - 12, width: w, height: h };
    } else if (next === "normal" && o.savedRect) {
      o.rect = { x: o.savedRect.x, y: o.savedRect.y, width: o.savedRect.width, height: o.savedRect.height };
      o.rotation = o.savedRect.rotation;
    }
    o.containerState = next;
    this.notify();

    const fireStateEvent = (name: string) => {
      const ev = el.events?.find((e) => e.on === name);
      if (ev) void this.runActions(ev.do, { __elementId: target });
    };
    if (next === "maximized") fireStateEvent("isMaximized");
    if (next === "minimized") fireStateEvent("isMinimized");
    if (prev === "maximized" && next === "normal") fireStateEvent("isUnmaximized");
    if (prev === "minimized" && next === "normal") fireStateEvent("isUnminimized");
  }

  async runActions(actions: IsxAction[] | undefined, eventCtx: Record<string, unknown> = {}): Promise<void> {
    for (const a of actions || []) {
      const sc = this.scope(eventCtx);
      const target = () => this.resolveTarget(a, eventCtx);
      switch (a.type) {
        case "navigate":
          this.navigate(a.screen as string);
          break;
        case "setVariable":
          this.variables[a.variable as string] = evalValue(a.to as any, sc);
          this.notify();
          break;
        case "setProperty": {
          const t = a.target as string;
          const o = this.override(t);
          o.props = { ...o.props, [a.property as string]: evalValue(a.to as any, sc) };
          this.notify();
          break;
        }
        case "toggleVisibility": {
          const t = a.target as string;
          const cur = this.isVisible(t);
          const to = a.to as string | undefined;
          this.setVisible(t, to === "show" ? true : to === "hide" ? false : !cur);
          break;
        }
        case "showAtLocation": {
          const t = a.target as string;
          const cur = this.effectiveRect(t);
          this.override(t).rect = { ...cur, x: a.x as number, y: a.y as number };
          this.setVisible(t, true);
          if (a.hideEverythingElse) {
            for (const sib of this.screen.elements) if (sib.id !== t) this.setVisible(sib.id, false);
          }
          this.notify();
          break;
        }
        case "showMessage":
          this.cb.onToast?.(String(evalValue(a.message as any, sc)));
          break;
        case "moveTo": {
          const t = target()!;
          const cur = this.effectiveRect(t);
          this.override(t).rect = { ...cur, x: a.x as number, y: a.y as number };
          this.notify();
          break;
        }
        case "moveBy": {
          const t = target()!;
          const cur = this.effectiveRect(t);
          this.override(t).rect = { ...cur, x: cur.x + (a.dx as number), y: cur.y + (a.dy as number) };
          this.notify();
          break;
        }
        case "resizeToFactor": {
          const t = target()!;
          const el = this.findElement(t)!;
          const factor = a.factor as number;
          const cur = this.effectiveRect(t);
          this.override(t).rect = { ...cur, width: el.layout.width * factor, height: el.layout.height * factor };
          this.notify();
          break;
        }
        case "resizeByFactor": {
          const t = target()!;
          const cur = this.effectiveRect(t);
          const factor = a.factor as number;
          this.override(t).rect = { ...cur, width: cur.width * factor, height: cur.height * factor };
          this.notify();
          break;
        }
        case "setSize": {
          const t = target()!;
          const cur = this.effectiveRect(t);
          this.override(t).rect = { ...cur, width: a.width as number, height: a.height as number };
          this.notify();
          break;
        }
        case "rotateTo": {
          const t = target()!;
          this.override(t).rotation = a.angle as number;
          this.notify();
          break;
        }
        case "rotateBy": {
          const t = target()!;
          this.override(t).rotation = this.effectiveRotation(t) + (a.angleOffset as number);
          this.notify();
          break;
        }
        case "bringToFront": {
          const t = target()!;
          this.override(t).z = ++this.zCounter;
          this.notify();
          break;
        }
        case "sendToBack": {
          const t = target()!;
          this.override(t).z = --this.backCounter;
          this.notify();
          break;
        }
        case "setOpacity": {
          const t = target()!;
          this.override(t).opacity = a.opacity as number;
          this.notify();
          break;
        }
        case "applyEffects": {
          const t = target()!;
          const cur = this.effectiveEffects(t);
          const o = this.override(t);
          o.effects = { ...cur, ...Object.fromEntries(Object.entries(a).filter(([k]) => ["blur", "grayscale", "sepia", "hueRotation", "brightness"].includes(k))) };
          this.notify();
          break;
        }
        case "containerState": {
          const t = target()!;
          const op = a.op as string;
          const cur = this.containerStateOf(t);
          if (op === "maximize") this.setContainerState(t, "maximized");
          else if (op === "minimize") this.setContainerState(t, "minimized");
          else if (op === "normal") this.setContainerState(t, "normal");
          else if (op === "toggleMaximize") this.setContainerState(t, cur === "maximized" ? "normal" : "maximized");
          else if (op === "toggleMinimize") this.setContainerState(t, cur === "minimized" ? "normal" : "minimized");
          break;
        }
        case "setInteractivity": {
          const t = target()!;
          const cur = this.isInteractive(t);
          const to = a.to as string;
          this.override(t).interactive = to === "visible" ? true : to === "hidden" ? false : !cur;
          this.notify();
          break;
        }
        case "data.query": {
          const source = a.source as string;
          const ds = (this.doc.dataSources || []).find((d) => d.id === source);
          if (!ds) break;
          if (ds.kind === "rest" && this.cb.httpFetch) {
            const res = await this.cb.httpFetch({ url: ds.uri });
            const rows = res.ok ? res.json ?? [] : [];
            this.data[source] = rows;
            if (a.into) this.variables[a.into as string] = rows;
            if (!res.ok) this.cb.onDataError?.(source, res.error || `request to ${ds.uri} failed`);
          } else if ((ds.kind === "csv" || ds.kind === "json" || ds.kind === "sqlite" || ds.kind === "excel") && this.cb.readLocalData) {
            const res = await this.cb.readLocalData({ kind: ds.kind, uri: ds.uri, basePath: this.cb.basePath, query: a.query as string | undefined });
            if (res.ok) {
              this.data[source] = res.rows || [];
              if (a.into) this.variables[a.into as string] = res.rows || [];
            } else {
              this.cb.onDataError?.(source, res.error || `could not read ${ds.kind} source ${ds.uri}`);
            }
          }
          this.notify();
          break;
        }
        case "http.request": {
          if (this.cb.httpFetch) {
            const res = await this.cb.httpFetch({ url: a.url as string, method: a.method as string, headers: a.headers as Record<string, string> });
            if (a.into) this.variables[a.into as string] = res.json ?? res.text;
            this.notify();
          }
          break;
        }
        case "collection.scrollToIndex":
          this.collectionScrollToIndex(a.target as string, a.index as number);
          break;
        case "collection.next":
          this.collectionNext(a.target as string);
          break;
        case "collection.previous":
          this.collectionPrevious(a.target as string);
          break;
        case "collection.panMap":
          this.panMap(a.target as string, a.dx as number, a.dy as number);
          break;
        case "collection.zoomMap":
          this.zoomMap(a.target as string, a.factor as number);
          break;
        case "collection.scrollToDate":
          this.scrollTimelineToDate(a.target as string, a.date as string);
          break;
        case "collection.pauseSlideshow":
          this.pauseCollection(a.target as string);
          break;
        case "collection.resumeSlideshow":
          this.resumeCollection(a.target as string);
          break;
        case "remote.send": {
          const endpoint = (this.doc.remoteEndpoints || []).find((r) => r.id === a.target);
          if (!endpoint) { this.cb.onRemoteError?.(a.target as string, `no remoteEndpoint with id "${a.target}"`); break; }
          if (!this.cb.httpFetch) break;
          const res = await this.cb.httpFetch({
            url: `http://${endpoint.host}:${endpoint.port}/remote-action`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { do: a.do },
          });
          if (!res.ok) this.cb.onRemoteError?.(a.target as string, res.error || `remote Player at ${endpoint.host}:${endpoint.port} did not respond`);
          break;
        }
        case "data.write":
        case "device.send":
        case "media":
          break;
        case "delay":
          await new Promise((r) => setTimeout(r, (a.ms as number) || 0));
          break;
        case "if":
          if (evalExpr(a.when as string, sc)) await this.runActions(a.then as IsxAction[], eventCtx);
          else if (a.else) await this.runActions(a.else as IsxAction[], eventCtx);
          break;
        case "script":
          this.runScript(a.source as string, eventCtx.__elementId as string | undefined);
          break;
        default:
          break;
      }
    }
  }

  private scriptDisabled = false;
  private runScript(source: string, elementId: string | undefined) {
    if (this.scriptDisabled) return;
    try {
      const setSelfProp = (k: string, v: unknown) => {
        if (!elementId) return;
        const o = this.override(elementId);
        o.props = { ...o.props, [k]: v };
      };
      const self = new Proxy({}, { set: (_t, k, v) => { setSelfProp(String(k), v); return true; } });
      // eslint-disable-next-line no-new-func
      const fn = new Function("self", "vars", "data", `"use strict";\n${source}`);
      fn(self, this.variables, this.data);
      this.notify();
    } catch (e) {
      this.scriptDisabled = true;
      this.cb.onScriptBlocked?.(elementId, String(e));
    }
  }
}
