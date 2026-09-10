import type { StudioElement, StudioProject, ActionModel, ContainerModel, EffectsModel, StudioEvent } from "./types";
import { DEFAULT_CONTAINER, DEFAULT_EFFECTS } from "./types";

/** Maps an authoring-time action into the schema's action-object shape (no `on`/`type`-wrapper — the caller attaches that). */
function actionToIsxAction(action: ActionModel): Record<string, unknown> | null {
  switch (action.type) {
    case "none": return null;
    case "navigate": return { type: "navigate", screen: action.screen, transition: "fade" };
    case "setVariable": return { type: "setVariable", variable: action.variable, to: { expr: action.expr } };
    case "toggleVisibility": return { type: "toggleVisibility", target: action.target, to: "toggle" };
    case "showMessage": return { type: "showMessage", message: { value: action.message } };
    case "moveTo": return { type: "moveTo", target: action.target, x: action.x, y: action.y };
    case "resizeToFactor": return { type: "resizeToFactor", target: action.target, factor: action.factor };
    case "rotateBy": return { type: "rotateBy", target: action.target, angleOffset: action.angleOffset };
    case "bringToFront": return { type: "bringToFront", target: action.target };
    case "sendToBack": return { type: "sendToBack", target: action.target };
    case "setOpacity": return { type: "setOpacity", target: action.target, opacity: action.opacity };
    case "applyEffects": {
      const payload: Record<string, unknown> = { type: "applyEffects", target: action.target };
      for (const k of ["blur", "grayscale", "sepia", "hueRotation", "brightness"] as const) {
        if (action[k] !== undefined) payload[k] = action[k];
      }
      return payload;
    }
    case "containerState": return { type: "containerState", target: action.target, op: action.op };
    case "collectionNext": return { type: "collection.next", target: action.target };
    case "collectionPrevious": return { type: "collection.previous", target: action.target };
    case "collectionScrollToIndex": return { type: "collection.scrollToIndex", target: action.target, index: action.index };
    case "dataQuery": {
      const out: Record<string, unknown> = { type: "data.query", source: action.source, into: action.into };
      if (action.query) out.query = action.query;
      return out;
    }
    case "remoteSend": {
      const inner = actionToIsxAction(action.action);
      return inner ? { type: "remote.send", target: action.target, do: [inner] } : null;
    }
    case "panMap": return { type: "collection.panMap", target: action.target, dx: action.dx, dy: action.dy };
    case "zoomMap": return { type: "collection.zoomMap", target: action.target, factor: action.factor };
    case "scrollToDate": return { type: "collection.scrollToDate", target: action.target, date: action.date };
    case "pauseSlideshow": return { type: "collection.pauseSlideshow", target: action.target };
    case "resumeSlideshow": return { type: "collection.resumeSlideshow", target: action.target };
    default: return null;
  }
}

/** Maps one authoring-time StudioEvent (trigger + action) into a full .isx event object, or null if the action is "none". */
function studioEventToIsx(e: StudioEvent): Record<string, unknown> | null {
  const mapped = actionToIsxAction(e.action);
  if (!mapped) return null;
  const out: Record<string, unknown> = { on: e.trigger, do: [mapped] };
  if (e.direction) out.direction = e.direction;
  if (e.target) out.target = e.target;
  if (e.durationMs !== undefined) out.durationMs = e.durationMs;
  if (e.repeatIndefinitely !== undefined) out.repeatIndefinitely = e.repeatIndefinitely;
  if (e.trigger === "timer" && e.durationMs !== undefined) { out.intervalMs = e.durationMs; delete out.durationMs; }
  return out;
}

/** Only emit `container` when it differs from Static-default, to keep documents lean. */
function containerToIsx(c: ContainerModel): Record<string, unknown> | undefined {
  const isDefault = JSON.stringify(c) === JSON.stringify(DEFAULT_CONTAINER);
  if (isDefault) return undefined;
  const out: Record<string, unknown> = { mode: c.mode };
  if (c.mode === "static") return out; // mode changed to explicit "static" only — nothing else meaningful
  out.allowMove = c.allowMove;
  out.moveDirection = c.moveDirection;
  out.allowResize = c.allowResize;
  out.allowRotate = c.allowRotate;
  if (c.minWidth !== undefined) out.minWidth = c.minWidth;
  if (c.minHeight !== undefined) out.minHeight = c.minHeight;
  if (c.maxWidth !== undefined) out.maxWidth = c.maxWidth;
  if (c.maxHeight !== undefined) out.maxHeight = c.maxHeight;
  out.initialState = c.initialState;
  out.showMaximizeButton = c.showMaximizeButton;
  out.showMinimizeButton = c.showMinimizeButton;
  return out;
}

/** Only emit `effects` when at least one value differs from the neutral default. */
function effectsToIsx(e: EffectsModel): Record<string, unknown> | undefined {
  const isDefault = JSON.stringify(e) === JSON.stringify(DEFAULT_EFFECTS);
  return isDefault ? undefined : { ...e };
}

function elementToIsx(el: StudioElement): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    name: el.name,
    layout: { x: el.rect.x, y: el.rect.y, width: el.rect.width, height: el.rect.height, z: el.z, rotation: el.rotation },
    visible: el.visible,
    props: el.props,
  };
  const container = containerToIsx(el.container);
  if (container) out.container = container;
  const effects = effectsToIsx(el.effects);
  if (effects) out.effects = effects;
  if (el.bindings && Object.keys(el.bindings).length) out.bindings = el.bindings;
  const events = (el.events || []).map(studioEventToIsx).filter((e): e is Record<string, unknown> => e !== null);
  if (events.length) out.events = events;
  if (el.children && el.children.length) out.children = el.children.map(elementToIsx);
  return out;
}

/** The single authoritative StudioProject -> .isx compiler. Both Save and Export use this. */
export function toIsxDocument(project: StudioProject): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    format: "isx",
    schemaVersion: "1.3",
    meta: {
      id: project.id,
      name: project.name,
      appVersion: project.appVersion,
    },
    stage: {
      width: project.stage.width,
      height: project.stage.height,
      orientation: project.stage.width >= project.stage.height ? "landscape" : "portrait",
      background: project.stage.background,
      scaleMode: "fit",
    },
    variables: project.variables.map((v) => ({ id: v.id, type: v.type, initial: v.initial })),
    entryScreen: project.entryScreen,
    screens: project.screens.map((s) => ({
      id: s.id,
      name: s.name,
      background: s.background,
      elements: s.elements.map(elementToIsx),
    })),
  };
  if (project.dataSources.length) {
    doc.dataSources = project.dataSources.map((d) => ({ id: d.id, kind: d.kind, uri: d.uri, mode: "read" }));
  }
  if (project.assets.length) {
    doc.assets = project.assets.map((a) => ({ id: a.id, kind: a.kind, uri: a.name, mimeType: a.mimeType, data: a.data, bytes: a.bytes }));
  }
  if (project.remoteEndpoints.length) {
    doc.remoteEndpoints = project.remoteEndpoints.map((r) => ({ id: r.id, name: r.name, host: r.host, port: r.port }));
  }
  return doc;
}
