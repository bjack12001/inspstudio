import type { StudioElement, StudioProject, ElementType, ActionModel } from "./types";
import { DEFAULT_CONTAINER, DEFAULT_EFFECTS } from "./types";

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}${Date.now().toString(36).slice(-3)}`;
}

const DEFAULTS: Record<ElementType, () => Omit<StudioElement, "id" | "rotation" | "container" | "effects" | "events">> = {
  text: () => ({
    type: "text",
    name: "Text",
    rect: { x: 120, y: 100, width: 420, height: 90 },
    z: 1,
    visible: true,
    props: { text: "Headline text", size: 44, color: "#e6edf3", weight: 700, align: "left" },
  }),
  button: () => ({
    type: "button",
    name: "Button",
    rect: { x: 120, y: 260, width: 260, height: 84 },
    z: 2,
    visible: true,
    props: { label: "Tap me", bg: "#22d3ee", color: "#04121a", size: 22, radius: 12 },
  }),
  shape: () => ({
    type: "shape",
    name: "Panel",
    rect: { x: 120, y: 380, width: 380, height: 220 },
    z: 0,
    visible: true,
    props: { kind: "rectangle", fill: "#182531", stroke: "#2b3a4a", strokeWidth: 1, radius: 16 },
  }),
  image: () => ({
    type: "image",
    name: "Image",
    rect: { x: 640, y: 120, width: 460, height: 300 },
    z: 1,
    visible: true,
    props: { uri: "", fit: "cover", radius: 12 },
  }),
  video: () => ({
    type: "video",
    name: "Video",
    rect: { x: 640, y: 120, width: 460, height: 260 },
    z: 1,
    visible: true,
    props: { uri: "", autoplay: false, loop: false, muted: false, controls: true },
  }),
  pdf: () => ({
    type: "pdf",
    name: "PDF",
    rect: { x: 640, y: 120, width: 460, height: 600 },
    z: 1,
    visible: true,
    props: { uri: "" },
  }),
  input: () => ({
    type: "input",
    name: "Text field",
    rect: { x: 140, y: 300, width: 340, height: 56 },
    z: 1,
    visible: true,
    props: { mode: "text", placeholder: "Enter text…", bind: "" },
  }),
  container: () => ({
    type: "container",
    name: "Group",
    rect: { x: 200, y: 200, width: 300, height: 200 },
    z: 1,
    visible: true,
    props: { fill: "transparent" },
    children: [],
  }),
};

export function createElement(type: ElementType): StudioElement {
  return { id: uid(type), rotation: 0, container: { ...DEFAULT_CONTAINER }, effects: { ...DEFAULT_EFFECTS }, events: [], ...DEFAULTS[type]() };
}

/** Convenience for demo/seed data: gives an element a single "tap" event with the given action. */
export function withTapAction(el: StudioElement, action: ActionModel): StudioElement {
  return { ...el, events: [{ id: uid("evt"), trigger: "tap", action }] };
}

export const STAGE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "1920×1080 — Full HD Landscape", width: 1920, height: 1080 },
  { label: "1080×1920 — Full HD Portrait", width: 1080, height: 1920 },
  { label: "3840×2160 — 4K Landscape", width: 3840, height: 2160 },
  { label: "2160×3840 — 4K Portrait", width: 2160, height: 3840 },
  { label: "1280×720 — HD Landscape", width: 1280, height: 720 },
  { label: "1024×768 — 4:3 Kiosk", width: 1024, height: 768 },
];

export function createBlankProject(width: number, height: number, background = "#0b0f14", name = "Untitled Project"): StudioProject {
  return {
    id: uid("project"),
    name,
    appVersion: "0.1.0",
    stage: { width, height, background },
    variables: [],
    dataSources: [],
    assets: [],
    remoteEndpoints: [],
    screens: [{ id: "home", name: "Home", background, elements: [] }],
    entryScreen: "home",
  };
}

function rescaleElement(el: StudioElement, fx: number, fy: number): StudioElement {
  return {
    ...el,
    rect: { x: el.rect.x * fx, y: el.rect.y * fy, width: el.rect.width * fx, height: el.rect.height * fy },
    container: {
      ...el.container,
      minWidth: el.container.minWidth !== undefined ? el.container.minWidth * fx : undefined,
      minHeight: el.container.minHeight !== undefined ? el.container.minHeight * fy : undefined,
      maxWidth: el.container.maxWidth !== undefined ? el.container.maxWidth * fx : undefined,
      maxHeight: el.container.maxHeight !== undefined ? el.container.maxHeight * fy : undefined,
    },
    children: el.children ? el.children.map((c) => rescaleElement(c, fx, fy)) : undefined,
  };
}

/** Proportionally rescales every element's position/size (and container min/max) to a new stage resolution. Rotation, effects, and variables are untouched. */
export function rescaleProjectToStage(project: StudioProject, newWidth: number, newHeight: number): StudioProject {
  const fx = newWidth / project.stage.width;
  const fy = newHeight / project.stage.height;
  return {
    ...project,
    stage: { ...project.stage, width: newWidth, height: newHeight },
    screens: project.screens.map((s) => ({ ...s, elements: s.elements.map((el) => rescaleElement(el, fx, fy)) })),
  };
}

export function createDemoProject(): StudioProject {
  const panel = createElement("shape");
  panel.name = "Details panel";
  panel.rect = { x: 760, y: 210, width: 380, height: 300 };
  panel.props = { kind: "rectangle", fill: "#122431", stroke: "#22d3ee", strokeWidth: 1, radius: 18 };
  panel.visible = false;

  const hint = createElement("text");
  hint.name = "Details copy";
  hint.rect = { x: 792, y: 250, width: 320, height: 220 };
  hint.props = { text: "Details panel\n\nThis element starts hidden. The button toggles it.", size: 22, color: "#cfe9ec", weight: 500, align: "left" };
  hint.z = 3;

  const title = createElement("text");
  title.name = "Title";
  title.rect = { x: 140, y: 150, width: 620, height: 90 };
  title.props = { text: "Product Kiosk", size: 56, color: "#e6edf3", weight: 800, align: "left" };

  const counter = createElement("text");
  counter.name = "Counter";
  counter.rect = { x: 140, y: 246, width: 620, height: 40 };
  counter.props = { text: "Taps: 0", size: 26, color: "#8ba0b3", weight: 500, align: "left" };
  counter.bindings = { text: "'Taps: ' + count" };

  const backdrop = createElement("shape");
  backdrop.name = "Backdrop";
  backdrop.rect = { x: 80, y: 90, width: 1120, height: 540 };
  backdrop.props = { kind: "rectangle", fill: "#0f1720", stroke: "#20303f", strokeWidth: 1, radius: 24 };
  backdrop.z = 0;

  let btn = createElement("button");
  btn.name = "Reveal button";
  btn.rect = { x: 140, y: 430, width: 260, height: 84 };
  btn.props = { label: "Reveal details", bg: "#22d3ee", color: "#04121a", size: 24, radius: 14 };
  btn = withTapAction(btn, { type: "toggleVisibility", target: panel.id });

  const home = {
    id: "home",
    name: "Home",
    background: "#0b0f14",
    elements: [backdrop, title, counter, panel, hint, btn],
  };

  let backBtn = createElement("button");
  backBtn.name = "Back";
  backBtn.rect = { x: 60, y: 60, width: 160, height: 64 };
  backBtn.props = { label: "Back", bg: "#182531", color: "#e6edf3", size: 20, radius: 10 };
  backBtn = withTapAction(backBtn, { type: "navigate", screen: "home" });

  const dTitle = createElement("text");
  dTitle.rect = { x: 140, y: 150, width: 900, height: 80 };
  dTitle.props = { text: "Details screen", size: 48, color: "#e6edf3", weight: 800, align: "left" };

  const details = { id: "details", name: "Details", background: "#0b0f14", elements: [backBtn, dTitle] };

  return {
    id: "kiosk-demo",
    name: "Product Kiosk Demo",
    appVersion: "0.1.0",
    stage: { width: 1280, height: 720, background: "#0b0f14" },
    variables: [{ id: "count", type: "number", initial: 0 }],
    dataSources: [],
    assets: [],
    remoteEndpoints: [],
    screens: [home, details],
    entryScreen: "home",
  };
}
