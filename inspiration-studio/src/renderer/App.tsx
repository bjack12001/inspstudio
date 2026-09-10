import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ActionModel, ElementType, StudioAsset, StudioElement, StudioEvent, StudioProject, StudioScreen, TriggerType } from "./lib/types";
import { createDemoProject, createElement, uid, createBlankProject, rescaleProjectToStage, STAGE_PRESETS } from "./lib/factory";
import { toIsxDocument } from "./lib/compile";
import { validateIsx } from "./lib/validate";

type Mode = "edit" | "preview";
type Tab = "inspect" | "layers" | "screens" | "data" | "code";

const hasBridge = typeof window !== "undefined" && !!window.studio;

function findElementDeep(elements: StudioElement[], id: string | null): StudioElement | undefined {
  if (!id) return undefined;
  for (const e of elements) {
    if (e.id === id) return e;
    if (e.children) { const c = findElementDeep(e.children, id); if (c) return c; }
  }
  return undefined;
}

function updateElementDeep(elements: StudioElement[], id: string, fn: (e: StudioElement) => StudioElement): StudioElement[] {
  return elements.map((e) => {
    if (e.id === id) return fn(e);
    if (e.children) return { ...e, children: updateElementDeep(e.children, id, fn) };
    return e;
  });
}

function removeElementDeep(elements: StudioElement[], id: string): StudioElement[] {
  return elements.filter((e) => e.id !== id).map((e) => (e.children ? { ...e, children: removeElementDeep(e.children, id) } : e));
}

function addChildDeep(elements: StudioElement[], parentId: string, child: StudioElement): StudioElement[] {
  return elements.map((e) => {
    if (e.id === parentId) return { ...e, children: [...(e.children || []), child] };
    if (e.children) return { ...e, children: addChildDeep(e.children, parentId, child) };
    return e;
  });
}

function firstTapAction(el: StudioElement): ActionModel | undefined {
  return el.events?.find((e) => e.trigger === "tap")?.action;
}

function flattenElements(elements: StudioElement[]): StudioElement[] {
  const out: StudioElement[] = [];
  const walk = (els: StudioElement[]) => els.forEach((e) => { out.push(e); if (e.children) walk(e.children); });
  walk(elements);
  return out;
}

export default function App() {
  const [project, setProject] = useState<StudioProject>(createDemoProject);
  const [screenId, setScreenId] = useState(project.entryScreen);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [tab, setTab] = useState<Tab>("inspect");
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, { rect?: StudioElement["rect"]; rotation?: number; opacity?: number; effects?: Partial<StudioElement["effects"]>; z?: number; containerState?: "normal" | "minimized" | "maximized"; focusIndex?: number }>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [stageDialog, setStageDialog] = useState<{ mode: "create" | "edit" } | null>(null);

  const stageWrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; kind: "move" | "resize"; pointerId: number; startX: number; startY: number; orig: StudioElement["rect"] } | null>(null);

  const screen = project.screens.find((s) => s.id === screenId) || project.screens[0];
  const selected = findElementDeep(screen.elements, selectedId) || null;
  const allElementsFlat = flattenElements(screen.elements);

  const doc = toIsxDocument(project);
  const docStr = JSON.stringify(doc, null, 2);
  const validation = validateIsx(doc);

  // responsive scale — fits by BOTH width and height, so portrait/4K/any resolution renders correctly
  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      setScale(Math.min(availW / project.stage.width, availH / project.stage.height));
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [project.stage.width, project.stage.height]);

  useEffect(() => {
    if (mode === "preview") { setHidden({}); setPreviewOverrides({}); }
  }, [mode]);

  // ---- project mutation helpers ----
  const updateScreen = useCallback((sid: string, fn: (s: StudioScreen) => StudioScreen) => {
    setProject((p) => ({ ...p, screens: p.screens.map((s) => (s.id === sid ? fn(s) : s)) }));
  }, []);

  const patchElement = useCallback((id: string, fn: (e: StudioElement) => StudioElement) => {
    updateScreen(screenId, (s) => ({ ...s, elements: updateElementDeep(s.elements, id, fn) }));
  }, [screenId, updateScreen]);

  const addElement = (type: ElementType) => {
    const el = createElement(type);
    updateScreen(screenId, (s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedId(el.id);
    setTab("inspect");
  };

  const addChild = (parentId: string, type: ElementType) => {
    const el = createElement(type);
    updateScreen(screenId, (s) => ({ ...s, elements: addChildDeep(s.elements, parentId, el) }));
    setSelectedId(el.id);
  };

  const addAsset = (asset: Omit<StudioAsset, "id">): string => {
    const id = uid("asset");
    setProject((p) => ({ ...p, assets: [...p.assets, { id, ...asset }] }));
    return id;
  };

  const removeSelected = () => {
    if (!selectedId) return;
    updateScreen(screenId, (s) => ({ ...s, elements: removeElementDeep(s.elements, selectedId) }));
    setSelectedId(null);
  };

  const reorder = (id: string, dir: 1 | -1) => {
    updateScreen(screenId, (s) => {
      const i = s.elements.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.elements.length) return s;
      const arr = [...s.elements];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...s, elements: arr };
    });
  };

  const addScreen = () => {
    const id = uid("screen");
    const newScreen: StudioScreen = { id, name: "New Screen", background: "#0b0f14", elements: [] };
    setProject((p) => ({ ...p, screens: [...p.screens, newScreen] }));
    setScreenId(id);
  };

  const removeScreen = (id: string) => {
    if (project.screens.length <= 1) return;
    if (id === project.entryScreen) { setStatus("Can't delete the entry screen — set another screen as entry first."); return; }
    setProject((p) => ({ ...p, screens: p.screens.filter((s) => s.id !== id) }));
    if (screenId === id) setScreenId(project.screens[0].id);
  };

  // ---- drag / resize ----
  const onElemPointerDown = (e: React.PointerEvent, el: StudioElement, kind: "move" | "resize") => {
    if (mode !== "edit") return;
    e.stopPropagation();
    setSelectedId(el.id);
    setTab("inspect");
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id: el.id, kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, orig: { ...el.rect } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    patchElement(d.id, (el) => ({
      ...el,
      rect:
        d.kind === "move"
          ? { ...el.rect, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) }
          : { ...el.rect, width: Math.max(40, Math.round(d.orig.width + dx)), height: Math.max(30, Math.round(d.orig.height + dy)) },
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && e.pointerId === dragRef.current.pointerId) dragRef.current = null;
  };

  // ---- preview action engine ----
  const runAction = (action: ActionModel | undefined, elements: StudioElement[]) => {
    if (!action || action.type === "none") return;
    const findEl = (id: string) => findElementDeep(elements, id);
    const ov = (id: string) => previewOverrides[id] || {};
    const effRect = (id: string) => ov(id).rect || findEl(id)?.rect || { x: 0, y: 0, width: 0, height: 0 };
    const effRotation = (id: string) => ov(id).rotation ?? findEl(id)?.rotation ?? 0;
    const effEffects = (id: string) => ({ ...findEl(id)?.effects, ...ov(id).effects });
    const focusIndex = (id: string) => ov(id).focusIndex ?? 0;
    const setFocus = (id: string, raw: number) => {
      const target = findEl(id);
      const children = target?.children || [];
      if (!children.length) return;
      const loop = !!(target?.props as any)?.loop;
      const idx = loop ? ((raw % children.length) + children.length) % children.length : Math.max(0, Math.min(children.length - 1, raw));
      setPreviewOverrides((o) => ({ ...o, [id]: { ...o[id], focusIndex: idx } }));
    };

    if (action.type === "showMessage") showToast(action.message);
    if (action.type === "toggleVisibility") setHidden((h) => ({ ...h, [action.target]: !h[action.target] }));
    if (action.type === "navigate") setScreenId(action.screen);
    if (action.type === "moveTo") setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], rect: { ...effRect(action.target), x: action.x, y: action.y } } }));
    if (action.type === "resizeToFactor") {
      const original = findEl(action.target)?.rect;
      if (original) setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], rect: { ...effRect(action.target), width: original.width * action.factor, height: original.height * action.factor } } }));
    }
    if (action.type === "rotateBy") setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], rotation: effRotation(action.target) + action.angleOffset } }));
    if (action.type === "setOpacity") setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], opacity: action.opacity } }));
    if (action.type === "bringToFront") setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], z: 999 } }));
    if (action.type === "sendToBack") setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], z: -999 } }));
    if (action.type === "applyEffects") {
      const { type, target, ...fields } = action;
      setPreviewOverrides((o) => ({ ...o, [target]: { ...o[target], effects: { ...effEffects(target), ...fields } } }));
    }
    if (action.type === "containerState") {
      const cur = ov(action.target).containerState || "normal";
      const original = findEl(action.target)?.rect;
      const next = action.op === "maximize" ? "maximized" : action.op === "minimize" ? "minimized" : action.op === "normal" ? "normal"
        : action.op === "toggleMaximize" ? (cur === "maximized" ? "normal" : "maximized") : (cur === "minimized" ? "normal" : "minimized");
      if (!original) return;
      const rect = next === "maximized" ? { x: 0, y: 0, width: project.stage.width, height: project.stage.height }
        : next === "minimized" ? { x: 12, y: project.stage.height - 108, width: 96, height: 96 }
        : original;
      setPreviewOverrides((o) => ({ ...o, [action.target]: { ...o[action.target], containerState: next, rect } }));
    }
    if (action.type === "collectionNext") setFocus(action.target, focusIndex(action.target) + 1);
    if (action.type === "collectionPrevious") setFocus(action.target, focusIndex(action.target) - 1);
    if (action.type === "collectionScrollToIndex") setFocus(action.target, action.index);
    // setVariable preview omitted here — bindings evaluate in the real Player
  };
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  // ---- file I/O ----
  const persist = async (saveAs: boolean) => {
    const payload = JSON.stringify({ studioVersion: 1, project }, null, 2);
    if (hasBridge) {
      const res = await window.studio!.saveProject({ path: saveAs ? null : filePath, contents: payload });
      if (res.ok && res.path) { setFilePath(res.path); setStatus(`Saved to ${res.path}`); }
      else if (!res.canceled) setStatus("Save failed.");
    } else {
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}.isxproj`; a.click();
      URL.revokeObjectURL(url);
      setStatus("Downloaded .isxproj (browser preview mode — no filesystem access).");
    }
  };

  const openProject = async () => {
    if (hasBridge) {
      const res = await window.studio!.openProject();
      if (res.ok && res.contents) {
        try {
          const parsed = JSON.parse(res.contents);
          setProject(parsed.project);
          setFilePath(res.path || null);
          setScreenId(parsed.project.entryScreen);
          setStatus(`Opened ${res.path}`);
        } catch { setStatus("Could not parse project file."); }
      }
    } else {
      setStatus("Open requires the desktop app (Electron) — not available in browser preview.");
    }
  };

  const exportIsx = async () => {
    if (!validation.valid) { setStatus(`Export blocked: ${validation.errors.length} schema error(s) — see the .isx tab.`); setTab("code"); return; }
    const contents = docStr;
    if (hasBridge) {
      const res = await window.studio!.exportIsx({ suggestedName: `${project.id}.isx`, contents });
      if (res.ok && res.path) setStatus(`Exported ${res.path}`);
    } else {
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${project.id}.isx`; a.click();
      URL.revokeObjectURL(url);
      setStatus("Downloaded .isx (browser preview mode).");
    }
  };

  // wire native menu -> actions (desktop only)
  useEffect(() => {
    if (!hasBridge) return;
    const offs = [
      window.studio!.onMenu("menu:save", () => persist(false)),
      window.studio!.onMenu("menu:save-as", () => persist(true)),
      window.studio!.onMenu("menu:open", () => openProject()),
      window.studio!.onMenu("menu:export", () => exportIsx()),
      window.studio!.onMenu("menu:new", () => setStageDialog({ mode: "create" })),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filePath]);

  /** Simplified visual content for a child inside a Grid/Carousel-arranged container — sized by its cell/slide, not its own x/y. */
  /** Resolves an element's props (assetId or a raw uri) to a usable src — a data: URI for embedded assets, or the raw uri for external references. */
  const assetSrc = (p: any): string => {
    if (p.assetId) {
      const asset = project.assets.find((a) => a.id === p.assetId);
      if (asset) return `data:${asset.mimeType};base64,${asset.data}`;
    }
    return p.uri || "";
  };

  const renderChildVisual = (c: StudioElement): React.ReactNode => {
    const p = c.props as any;
    const eff = c.effects;
    const filters: string[] = [];
    if (eff.blur) filters.push(`blur(${eff.blur * 0.15}px)`);
    if (eff.grayscale) filters.push(`grayscale(${eff.grayscale}%)`);
    if (eff.sepia) filters.push(`sepia(${eff.sepia}%)`);
    if (eff.hueRotation) filters.push(`hue-rotate(${eff.hueRotation}deg)`);
    if (eff.brightness !== 100) filters.push(`brightness(${eff.brightness}%)`);
    const wrap: React.CSSProperties = { width: "100%", height: "100%", filter: filters.length ? filters.join(" ") : undefined };
    let content: React.ReactNode;
    if (c.type === "text") content = <div style={{ width: "100%", height: "100%", display: "flex", whiteSpace: "pre-wrap", color: p.color, fontSize: p.size, fontWeight: p.weight, textAlign: p.align, lineHeight: 1.2, justifyContent: p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start" }}>{p.text}</div>;
    else if (c.type === "button") content = <div onClick={(e) => { if (mode === "preview") { e.stopPropagation(); runAction(firstTapAction(c), screen.elements); } }} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: p.bg, color: p.color, fontSize: p.size, fontWeight: 700, borderRadius: p.radius, cursor: "pointer" }}>{p.label}</div>;
    else if (c.type === "shape") content = <div style={{ width: "100%", height: "100%", background: p.fill, borderRadius: p.radius, border: p.strokeWidth ? `${p.strokeWidth}px solid ${p.stroke}` : "none" }} />;
    else if (c.type === "image") { const src = assetSrc(p); content = src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: p.fit, borderRadius: p.radius }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 12 }}>image</div>; }
    else if (c.type === "video") { const src = assetSrc(p); content = src ? <video src={src} controls muted style={{ width: "100%", height: "100%", background: "#000" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 12 }}>video</div>; }
    else if (c.type === "pdf") { const src = assetSrc(p); content = src ? <embed src={src} type="application/pdf" style={{ width: "100%", height: "100%" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 12 }}>PDF</div>; }
    else if (c.type === "input") content = <input disabled placeholder={p.placeholder} style={{ width: "100%", height: "100%", background: "#0b0f14", border: "1px solid #2b3a4a", borderRadius: 8, color: "#e6edf3", fontSize: 14, padding: "0 8px" }} />;
    else content = <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 11 }}>nested {c.type}</div>;
    return <div style={wrap}>{content}</div>;
  };

  const renderElement = (el: StudioElement) => {
    const isSel = mode === "edit" && el.id === selectedId;
    const isHidden = mode === "preview" ? hidden[el.id] ?? !el.visible : !el.visible && mode === "edit" ? false : false;
    if (mode === "preview" && !el.visible && !hidden[el.id]) {
      // stays hidden until toggled
    }
    const effectiveHidden = mode === "preview" ? (el.id in hidden ? hidden[el.id] : !el.visible) : false;
    if (effectiveHidden) return null;

    const ov = mode === "preview" ? previewOverrides[el.id] : undefined;
    const rect = ov?.rect || el.rect;
    const rotation = ov?.rotation ?? el.rotation;
    const opacity = ov?.opacity ?? 1;
    const eff = { ...el.effects, ...ov?.effects };
    const z = ov?.z ?? el.z;
    const filters: string[] = [];
    if (eff.blur) filters.push(`blur(${eff.blur * 0.15}px)`);
    if (eff.grayscale) filters.push(`grayscale(${eff.grayscale}%)`);
    if (eff.sepia) filters.push(`sepia(${eff.sepia}%)`);
    if (eff.hueRotation) filters.push(`hue-rotate(${eff.hueRotation}deg)`);
    if (eff.brightness !== 100) filters.push(`brightness(${eff.brightness}%)`);
    const base: React.CSSProperties = {
      position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: z,
      cursor: mode === "edit" ? "grab" : "default", userSelect: "none",
      opacity,
      transform: rotation ? `rotate(${rotation}deg)` : undefined,
      filter: filters.length ? filters.join(" ") : undefined,
      outline: mode === "edit" && el.container.mode !== "static" ? "1px dashed rgba(34,211,238,.35)" : undefined,
      transition: mode === "preview" ? "left .2s, top .2s, width .2s, height .2s, transform .2s, opacity .2s, filter .2s" : undefined,
    };
    let inner: React.ReactNode = null;
    const p = el.props as any;

    if (el.type === "text") {
      inner = <div style={{ width: "100%", height: "100%", display: "flex", whiteSpace: "pre-wrap", color: p.color, fontSize: p.size, fontWeight: p.weight, textAlign: p.align, lineHeight: 1.2, justifyContent: p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start" }}>{p.text}</div>;
    } else if (el.type === "button") {
      inner = (
        <div onClick={(e) => { if (mode === "preview") { e.stopPropagation(); runAction(firstTapAction(el), screen.elements); } }}
          style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: p.bg, color: p.color, fontSize: p.size, fontWeight: 700, borderRadius: p.radius, cursor: mode === "preview" ? "pointer" : "grab" }}>
          {p.label}
        </div>
      );
    } else if (el.type === "shape") {
      inner = <div style={{ width: "100%", height: "100%", background: p.fill, borderRadius: p.radius, border: p.strokeWidth ? `${p.strokeWidth}px solid ${p.stroke}` : "none" }} />;
    } else if (el.type === "image") {
      const src = assetSrc(p);
      inner = src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: p.fit, borderRadius: p.radius }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", borderRadius: p.radius, display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>image</div>;
    } else if (el.type === "video") {
      const src = assetSrc(p);
      inner = src ? <video src={src} controls={p.controls !== false} autoPlay={!!p.autoplay} loop={!!p.loop} muted={!!p.muted} style={{ width: "100%", height: "100%", background: "#000" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>video</div>;
    } else if (el.type === "input") {
      const commonStyle: React.CSSProperties = { width: "100%", height: "100%", background: "#0b0f14", border: "1px solid #2b3a4a", borderRadius: 8, color: "#e6edf3", fontSize: 16, padding: p.mode === "multiline" ? 10 : "0 10px", fontFamily: "inherit", pointerEvents: mode === "preview" ? "auto" : "none" };
      inner = p.mode === "multiline"
        ? <textarea defaultValue="" placeholder={p.placeholder} style={{ ...commonStyle, resize: "none" }} />
        : <input type={p.mode === "password" ? "password" : "text"} defaultValue="" placeholder={p.placeholder} style={commonStyle} />;
    } else if (el.type === "pdf") {
      const src = assetSrc(p);
      inner = src ? <embed src={src} type="application/pdf" style={{ width: "100%", height: "100%" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>PDF</div>;
    } else if (el.type === "container") {
      const arrange = p.arrange || "free";
      if (arrange === "grid") {
        const columns = Math.max(1, p.columns ?? 3);
        const gap = p.gap ?? 8;
        inner = (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gridAutoRows: "1fr", gap, width: "100%", height: "100%", overflow: "auto", background: p.fill === "transparent" ? "none" : p.fill }}>
            {(el.children || []).map((c) => <div key={c.id} onPointerDown={(ev) => { ev.stopPropagation(); setSelectedId(c.id); setTab("inspect"); }} style={{ position: "relative", outline: c.id === selectedId ? "2px solid #22d3ee" : "1px dashed rgba(255,255,255,.12)", cursor: "pointer" }}>{renderChildVisual(c)}</div>)}
          </div>
        );
      } else if (arrange === "carousel" || arrange === "slideshow" || arrange === "swap") {
        const children = el.children || [];
        const idx = Math.min(previewOverrides[el.id]?.focusIndex ?? 0, Math.max(0, children.length - 1));
        const current = children[idx];
        inner = (
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: p.fill === "transparent" ? "none" : p.fill }}
            onPointerDown={(ev) => { if (current) { ev.stopPropagation(); setSelectedId(current.id); setTab("inspect"); } }}>
            {current && <div style={{ position: "absolute", inset: 0 }}>{renderChildVisual(current)}</div>}
            {children.length > 1 && (
              <>
                <button onClick={(ev) => { ev.stopPropagation(); const n = p.loop ? (idx - 1 + children.length) % children.length : Math.max(0, idx - 1); setPreviewOverrides((o) => ({ ...o, [el.id]: { ...o[el.id], focusIndex: n } })); }} className="nx-carousel-nav prev">‹</button>
                <button onClick={(ev) => { ev.stopPropagation(); const n = p.loop ? (idx + 1) % children.length : Math.min(children.length - 1, idx + 1); setPreviewOverrides((o) => ({ ...o, [el.id]: { ...o[el.id], focusIndex: n } })); }} className="nx-carousel-nav next">›</button>
                <div className="nx-carousel-dots">{children.map((c, i) => <span key={c.id} className={i === idx ? "on" : ""} />)}</div>
              </>
            )}
          </div>
        );
      } else if (arrange === "picker") {
        const children = el.children || [];
        const idx = Math.min(previewOverrides[el.id]?.focusIndex ?? 0, Math.max(0, children.length - 1));
        const itemW = p.itemWidth ?? 150, itemH = p.itemHeight ?? 150, gap = p.gap ?? 16;
        const step = itemW + gap;
        const centerX = el.rect.width / 2, centerY = el.rect.height / 2;
        inner = (
          <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: p.fill === "transparent" ? "none" : p.fill }}>
            {children.map((c, i) => {
              const offset = i - idx;
              const x = centerX + offset * step - itemW / 2;
              const focused = offset === 0;
              return (
                <div key={c.id} onPointerDown={(ev) => { ev.stopPropagation(); setSelectedId(c.id); setTab("inspect"); }}
                  style={{ position: "absolute", left: x, top: centerY - itemH / 2, width: itemW, height: itemH, transform: `scale(${focused ? 1 : 0.8})`, opacity: focused ? 1 : 0.55, cursor: "pointer" }}>
                  {renderChildVisual(c)}
                </div>
              );
            })}
          </div>
        );
      } else {
        inner = <div style={{ position: "relative", width: "100%", height: "100%", background: p.fill === "transparent" ? "none" : p.fill }}>{(el.children || []).map((c) => <React.Fragment key={c.id}>{renderElement(c)}</React.Fragment>)}</div>;
      }
    }

    return (
      <div key={el.id} style={base} onPointerDown={(e) => onElemPointerDown(e, el, "move")} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {inner}
        {isSel && (
          <>
            <div style={{ position: "absolute", inset: -2, border: "2px solid #22d3ee", borderRadius: 6, pointerEvents: "none" }} />
            <div onPointerDown={(e) => onElemPointerDown(e, el, "resize")} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              style={{ position: "absolute", right: -8, bottom: -8, width: 18, height: 18, background: "#22d3ee", borderRadius: 4, cursor: "nwse-resize", touchAction: "none" }} />
          </>
        )}
      </div>
    );
  };

  const renderLayerRow = (els: StudioElement[], depth: number): React.ReactNode =>
    els.map((el) => (
      <React.Fragment key={el.id}>
        <div className={`nx-layer ${el.id === selectedId ? "on" : ""}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => { setSelectedId(el.id); setTab("inspect"); }}>
          <span className="ly-type">{el.type}{el.type === "container" && (el.props as any)?.arrange && (el.props as any).arrange !== "free" ? ` · ${(el.props as any).arrange}` : ""}</span>
          <span className="ly-name">{el.name}</span>
          {depth === 0 && (
            <span className="ly-ord">
              <button onClick={(e) => { e.stopPropagation(); reorder(el.id, 1); }}>↑</button>
              <button onClick={(e) => { e.stopPropagation(); reorder(el.id, -1); }}>↓</button>
            </span>
          )}
        </div>
        {el.children && el.children.length > 0 && renderLayerRow(el.children, depth + 1)}
      </React.Fragment>
    ));

  const live = mode === "preview";

  return (
    <div className="nx-root">
      <header className="nx-top">
        <div className="nx-brand">
          <span className="nx-logo" />
          <span className="nx-title">Inspiration <b>Studio</b></span>
          <span className={`nx-state ${live ? "on" : ""}`}><i /> {live ? "Previewing" : "Editing"}</span>
          {!hasBridge && <span className="nx-devwarn">browser preview — file I/O limited</span>}
        </div>
        <div className="nx-actions">
          <div className="nx-seg">
            <button className={!live ? "act" : ""} onClick={() => setMode("edit")}>Edit</button>
            <button className={live ? "act" : ""} onClick={() => setMode("preview")}>Preview</button>
          </div>
          <button className="nx-btn" onClick={() => setStageDialog({ mode: "create" })}>New</button>
          <button className="nx-btn" onClick={openProject}>Open</button>
          <button className="nx-btn" onClick={() => persist(false)}>Save</button>
          <button className="nx-btn" onClick={exportIsx}>Export .isx</button>
        </div>
      </header>

      {status && <div className="nx-status">{status}</div>}

      <div className="nx-body">
        {!live && (
          <div className="nx-rail">
            {(["text", "button", "shape", "image", "video", "pdf", "input", "container"] as ElementType[]).map((t) => (
              <button key={t} className="nx-tool" onClick={() => addElement(t)}>
                <span className="g">{t[0].toUpperCase()}</span><span className="l">{t}</span>
              </button>
            ))}
          </div>
        )}

        <div className="nx-canvas-area" ref={stageWrapRef} onPointerDown={() => { if (!live) setSelectedId(null); }}>
          <div className="nx-stage-wrap" style={{ width: project.stage.width * scale, height: project.stage.height * scale }}>
            <div className={`nx-stage ${live ? "live" : ""}`} style={{ width: project.stage.width, height: project.stage.height, transform: `scale(${scale})`, background: screen.background }}>
              {screen.elements.map(renderElement)}
              {toast && <div className="nx-toast">{toast}</div>}
            </div>
          </div>
          <div className="nx-stagemeta">
            <span>{project.stage.width}×{project.stage.height}</span>
            <span>{screen.elements.length} elements</span>
            <span>screen: {screen.name}</span>
            <span className={validation.valid ? "ok" : "bad"}>{validation.valid ? "✓ schema valid" : `✗ ${validation.errors.length} schema error(s)`}</span>
            <button className="nx-btn sm" onClick={() => setStageDialog({ mode: "edit" })}>⚙ Resolution</button>
          </div>
        </div>

        <div className="nx-panel">
          <div className="nx-tabs">
            {(["inspect", "layers", "screens", "data", "code"] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{k === "code" ? ".isx" : k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          <div className="nx-panel-body">
            {tab === "inspect" && (selected ? <Inspector el={selected} patch={patchElement} elements={allElementsFlat} screens={project.screens} dataSources={project.dataSources} assets={project.assets} remoteEndpoints={project.remoteEndpoints} onAddAsset={addAsset} onDelete={removeSelected} onAddChild={addChild} /> : <div className="nx-empty">Select an element on the canvas to edit it.</div>)}
            {tab === "layers" && (
              <div className="nx-layers">
                {renderLayerRow(screen.elements.slice().reverse(), 0)}
              </div>
            )}
            {tab === "screens" && (
              <div className="nx-layers">
                {project.screens.map((s) => (
                  <div key={s.id} className={`nx-layer ${s.id === screenId ? "on" : ""}`} onClick={() => setScreenId(s.id)}>
                    <span className="ly-type">{s.id === project.entryScreen ? "entry" : "screen"}</span>
                    <span className="ly-name">{s.name}</span>
                    <span className="ly-ord"><button onClick={(e) => { e.stopPropagation(); removeScreen(s.id); }}>✕</button></span>
                  </div>
                ))}
                <button className="nx-btn sm" style={{ marginTop: 8 }} onClick={addScreen}>+ Add screen</button>
              </div>
            )}
            {tab === "data" && (
              <>
                <DataSourcesEditor project={project} setProject={setProject} />
                <div className="nx-divider" />
                <RemoteEndpointsEditor project={project} setProject={setProject} />
              </>
            )}
            {tab === "code" && (
              <div className="nx-code">
                <div className="nx-code-bar">
                  <span className={validation.valid ? "ok" : "bad"}>{validation.valid ? "Valid against isx.schema.json v1.0" : `${validation.errors.length} error(s)`}</span>
                </div>
                {!validation.valid && (
                  <ul className="nx-errs">{validation.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
                )}
                <pre>{docStr}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {stageDialog && (
        <StageSettingsDialog
          mode={stageDialog.mode}
          initial={stageDialog.mode === "edit" ? project.stage : { width: 1920, height: 1080, background: "#0b0f14" }}
          onCancel={() => setStageDialog(null)}
          onConfirm={(width, height, background, rescale) => {
            if (stageDialog.mode === "create") {
              const p = createBlankProject(width, height, background);
              setProject(p);
              setScreenId(p.entryScreen);
              setFilePath(null);
              setSelectedId(null);
            } else {
              setProject((prev) => (rescale ? rescaleProjectToStage({ ...prev, stage: { ...prev.stage, background } }, width, height) : { ...prev, stage: { width, height, background } }));
            }
            setStageDialog(null);
          }}
        />
      )}
    </div>
  );
}

function StageSettingsDialog({ mode, initial, onCancel, onConfirm }: {
  mode: "create" | "edit";
  initial: { width: number; height: number; background: string };
  onCancel: () => void;
  onConfirm: (width: number, height: number, background: string, rescaleExisting: boolean) => void;
}) {
  const [width, setWidth] = useState(initial.width);
  const [height, setHeight] = useState(initial.height);
  const [background, setBackground] = useState(initial.background);
  const [rescale, setRescale] = useState(true);
  const num = (v: string) => (Number.isFinite(+v) && +v > 0 ? +v : 1);
  const resolutionChanged = mode === "edit" && (width !== initial.width || height !== initial.height);

  return (
    <div className="nx-modal-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="nx-modal">
        <h3>{mode === "create" ? "New Project — Screen Resolution" : "Project Settings — Resolution"}</h3>
        <p className="hint">
          {mode === "create"
            ? "Set the target display's resolution first. The workspace scales to this, and the exported .isx carries the same resolution — the Player auto-scales to fit whatever screen it runs on."
            : "Changing resolution updates the workspace and the exported .isx. Existing elements can be scaled proportionally to match."}
        </p>
        <div className="nx-presets">
          {STAGE_PRESETS.map((p) => (
            <button key={p.label} className={`nx-preset-btn ${width === p.width && height === p.height ? "on" : ""}`}
              onClick={() => { setWidth(p.width); setHeight(p.height); }}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="nx-grid2">
          <label className="nx-field"><span>Width (px)</span><input type="number" value={width} onChange={(e) => setWidth(num(e.target.value))} /></label>
          <label className="nx-field"><span>Height (px)</span><input type="number" value={height} onChange={(e) => setHeight(num(e.target.value))} /></label>
          <label className="nx-field"><span>Background</span><input value={background} onChange={(e) => setBackground(e.target.value)} /></label>
        </div>
        {resolutionChanged && (
          <label className="nx-field-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={rescale} onChange={(e) => setRescale(e.target.checked)} />
            <span>Proportionally scale existing elements to the new resolution</span>
          </label>
        )}
        <div className="nx-modal-actions">
          <button className="nx-btn" onClick={onCancel}>Cancel</button>
          <button className="nx-btn" style={{ background: "var(--accent)", color: "#04121a", borderColor: "var(--accent)" }}
            onClick={() => onConfirm(width, height, background, resolutionChanged && rescale)}>
            {mode === "create" ? "Create Project" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Inspector({ el, patch, elements, screens, dataSources, assets, remoteEndpoints, onAddAsset, onDelete, onAddChild }: { el: StudioElement; patch: (id: string, fn: (e: StudioElement) => StudioElement) => void; elements: StudioElement[]; screens: StudioScreen[]; dataSources: StudioProject["dataSources"]; assets: StudioProject["assets"]; remoteEndpoints: StudioProject["remoteEndpoints"]; onAddAsset: (a: Omit<StudioAsset, "id">) => string; onDelete: () => void; onAddChild: (parentId: string, type: ElementType) => void }) {
  const setProp = (k: string, v: unknown) => patch(el.id, (e) => ({ ...e, props: { ...e.props, [k]: v } }));
  const setField = <K extends keyof StudioElement>(k: K, v: StudioElement[K]) => patch(el.id, (e) => ({ ...e, [k]: v }));
  const setContainer = (patchC: Partial<StudioElement["container"]>) => patch(el.id, (e) => ({ ...e, container: { ...e.container, ...patchC } }));
  const setEffects = (patchE: Partial<StudioElement["effects"]>) => patch(el.id, (e) => ({ ...e, effects: { ...e.effects, ...patchE } }));
  const num = (v: string) => (Number.isFinite(+v) ? +v : 0);
  const p = el.props as any;
  const c = el.container;

  return (
    <div className="nx-insp">
      <label className="nx-field"><span>Name</span><input value={el.name} onChange={(e) => setField("name", e.target.value)} /></label>
      <div className="nx-grid2">
        <label className="nx-field"><span>X</span><input type="number" value={el.rect.x} onChange={(e) => setField("rect", { ...el.rect, x: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Y</span><input type="number" value={el.rect.y} onChange={(e) => setField("rect", { ...el.rect, y: num(e.target.value) })} /></label>
        <label className="nx-field"><span>W</span><input type="number" value={el.rect.width} onChange={(e) => setField("rect", { ...el.rect, width: num(e.target.value) })} /></label>
        <label className="nx-field"><span>H</span><input type="number" value={el.rect.height} onChange={(e) => setField("rect", { ...el.rect, height: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Rotation°</span><input type="number" value={el.rotation} onChange={(e) => setField("rotation", num(e.target.value))} /></label>
        <label className="nx-field"><span>Z</span><input type="number" value={el.z} onChange={(e) => setField("z", num(e.target.value))} /></label>
      </div>
      <div className="nx-divider" />

      {el.type === "text" && (
        <>
          <label className="nx-field"><span>Text</span><textarea rows={3} value={p.text} onChange={(e) => setProp("text", e.target.value)} /></label>
          <div className="nx-grid2">
            <label className="nx-field"><span>Size</span><input type="number" value={p.size} onChange={(e) => setProp("size", num(e.target.value))} /></label>
            <label className="nx-field"><span>Color</span><input value={p.color} onChange={(e) => setProp("color", e.target.value)} /></label>
          </div>
          <BindingField label="text" value={el.bindings?.text || ""} onChange={(v) => patch(el.id, (ee) => ({ ...ee, bindings: { ...ee.bindings, text: v } }))} />
        </>
      )}

      {el.type === "button" && (
        <>
          <label className="nx-field"><span>Label</span><input value={p.label} onChange={(e) => setProp("label", e.target.value)} /></label>
          <BindingField label="label" value={el.bindings?.label || ""} onChange={(v) => patch(el.id, (ee) => ({ ...ee, bindings: { ...ee.bindings, label: v } }))} />
        </>
      )}


      {el.type === "shape" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Fill</span><input value={p.fill} onChange={(e) => setProp("fill", e.target.value)} /></label>
          <label className="nx-field"><span>Radius</span><input type="number" value={p.radius} onChange={(e) => setProp("radius", num(e.target.value))} /></label>
        </div>
      )}

      {el.type === "image" && (
        <AssetPicker kind="image" props={p} setProp={setProp} assets={assets} onAddAsset={onAddAsset} />
      )}

      {el.type === "video" && (
        <>
          <AssetPicker kind="video" props={p} setProp={setProp} assets={assets} onAddAsset={onAddAsset} />
          <div className="nx-grid2">
            <label className="nx-field-row"><input type="checkbox" checked={!!p.autoplay} onChange={(e) => setProp("autoplay", e.target.checked)} /><span>Autoplay</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={!!p.loop} onChange={(e) => setProp("loop", e.target.checked)} /><span>Loop</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={!!p.muted} onChange={(e) => setProp("muted", e.target.checked)} /><span>Muted</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={p.controls !== false} onChange={(e) => setProp("controls", e.target.checked)} /><span>Show controls</span></label>
          </div>
        </>
      )}

      {el.type === "pdf" && (
        <AssetPicker kind="pdf" props={p} setProp={setProp} assets={assets} onAddAsset={onAddAsset} />
      )}

      {el.type === "input" && (
        <>
          <label className="nx-field"><span>Mode</span>
            <select value={p.mode || "text"} onChange={(e) => setProp("mode", e.target.value)}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="email">Email</option>
              <option value="password">Password</option>
              <option value="multiline">Multiline</option>
            </select>
          </label>
          <label className="nx-field"><span>Placeholder</span><input value={p.placeholder || ""} onChange={(e) => setProp("placeholder", e.target.value)} /></label>
          <label className="nx-field"><span>Bind to variable</span><input value={p.bind || ""} onChange={(e) => setProp("bind", e.target.value)} placeholder="e.g. userName" /></label>
          <p className="nx-hint">Typing in this field (in the real Player) updates the named variable live — an on-screen keyboard appears automatically on touch devices, toggleable in the Player.</p>
        </>
      )}

      {el.type === "container" && (
        <>
          <label className="nx-field"><span>Fill</span><input value={p.fill ?? "transparent"} onChange={(e) => setProp("fill", e.target.value)} /></label>
          <label className="nx-field"><span>Layout</span>
            <select value={p.arrange || "free"} onChange={(e) => setProp("arrange", e.target.value)}>
              <option value="free">Free — children keep their own position (Group)</option>
              <option value="grid">Grid — wraps children into columns (Asset Grid)</option>
              <option value="carousel">Carousel — one child at a time, paged</option>
              <option value="swap">Swap — like Carousel with a fade/slide/flip transition</option>
              <option value="slideshow">Slide Show — auto-advances with a Ken Burns pan/zoom effect</option>
              <option value="picker">Item Picker — scrollable strip, focused item centered with neighbors peeking</option>
              <option value="map">Map — children positioned over a background image, with pan/zoom</option>
              <option value="timeline">Timeline — children positioned by date along a horizontal axis</option>
            </select>
          </label>
          {p.arrange === "grid" && (
            <div className="nx-grid2">
              <label className="nx-field"><span>Columns</span><input type="number" min="1" value={p.columns ?? 3} onChange={(e) => setProp("columns", num(e.target.value))} /></label>
              <label className="nx-field"><span>Gap</span><input type="number" min="0" value={p.gap ?? 8} onChange={(e) => setProp("gap", num(e.target.value))} /></label>
            </div>
          )}
          {p.arrange === "carousel" && (
            <label className="nx-field-row"><input type="checkbox" checked={!!p.loop} onChange={(e) => setProp("loop", e.target.checked)} /><span>Loop past the ends</span></label>
          )}
          {p.arrange === "swap" && (
            <>
              <label className="nx-field"><span>Transition</span>
                <select value={p.transitionStyle || "fade"} onChange={(e) => setProp("transitionStyle", e.target.value)}>
                  <option value="fade">Fade</option>
                  <option value="slide">Slide</option>
                  <option value="flip">Flip</option>
                </select>
              </label>
              <label className="nx-field-row"><input type="checkbox" checked={!!p.loop} onChange={(e) => setProp("loop", e.target.checked)} /><span>Loop past the ends</span></label>
            </>
          )}
          {p.arrange === "picker" && (
            <div className="nx-grid2">
              <label className="nx-field"><span>Item width</span><input type="number" min="1" value={p.itemWidth ?? 150} onChange={(e) => setProp("itemWidth", num(e.target.value))} /></label>
              <label className="nx-field"><span>Item height</span><input type="number" min="1" value={p.itemHeight ?? 150} onChange={(e) => setProp("itemHeight", num(e.target.value))} /></label>
              <label className="nx-field"><span>Gap</span><input type="number" min="0" value={p.gap ?? 16} onChange={(e) => setProp("gap", num(e.target.value))} /></label>
            </div>
          )}
          {p.arrange === "slideshow" && (
            <>
              <div className="nx-grid2">
                <label className="nx-field"><span>Seconds per slide</span><input type="number" min="1" step="0.5" value={(p.slideDurationMs ?? 5000) / 1000} onChange={(e) => setProp("slideDurationMs", Math.max(100, num(e.target.value) * 1000))} /></label>
                <label className="nx-field"><span>Transition</span>
                  <select value={p.transition || "fade"} onChange={(e) => setProp("transition", e.target.value)}>
                    <option value="fade">Fade</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </div>
              <div className="nx-grid2">
                <label className="nx-field-row"><input type="checkbox" checked={p.kenBurns !== false} onChange={(e) => setProp("kenBurns", e.target.checked)} /><span>Ken Burns pan/zoom</span></label>
                <label className="nx-field-row"><input type="checkbox" checked={!!p.loop} onChange={(e) => setProp("loop", e.target.checked)} /><span>Loop</span></label>
              </div>
            </>
          )}
          {p.arrange === "map" && (
            <>
              <AssetPicker kind="image" props={p} setProp={setProp} assets={assets} onAddAsset={onAddAsset} assetIdKey="mapImageAssetId" uriKey="mapImageUri" />
              <div className="nx-grid2">
                <label className="nx-field"><span>Min zoom</span><input type="number" step="0.1" min="0.1" value={p.mapMinZoom ?? 0.5} onChange={(e) => setProp("mapMinZoom", num(e.target.value))} /></label>
                <label className="nx-field"><span>Max zoom</span><input type="number" step="0.1" min="0.1" value={p.mapMaxZoom ?? 4} onChange={(e) => setProp("mapMaxZoom", num(e.target.value))} /></label>
              </div>
              <p className="nx-hint">Each child needs Map X/Y (0-1) set below, in its own "Collection position" section.</p>
            </>
          )}
          {p.arrange === "timeline" && (
            <>
              <div className="nx-grid2">
                <label className="nx-field"><span>Start date (optional)</span><input type="date" value={p.timelineStart || ""} onChange={(e) => setProp("timelineStart", e.target.value || undefined)} /></label>
                <label className="nx-field"><span>End date (optional)</span><input type="date" value={p.timelineEnd || ""} onChange={(e) => setProp("timelineEnd", e.target.value || undefined)} /></label>
              </div>
              <p className="nx-hint">Leave both blank to auto-fit around the children's own dates. Each child needs a Date set below, in its own "Collection position" section.</p>
            </>
          )}
          <div className="nx-secttl" style={{ marginTop: 8 }}>Children ({el.children?.length || 0})</div>
          <div className="nx-grid2">
            {(["text", "button", "shape", "image", "video", "pdf", "input"] as ElementType[]).map((t) => (
              <button key={t} className="nx-btn sm" onClick={() => onAddChild(el.id, t)}>+ {t}</button>
            ))}
          </div>
        </>
      )}

      <div className="nx-divider" />
      {el.type !== "container" && (
        <>
          <div className="nx-divider" />
          <div className="nx-secttl">Collection position (optional — used if this is inside a Map or Timeline)</div>
          <div className="nx-grid2">
            <label className="nx-field"><span>Map X (0-1)</span><input type="number" step="0.01" min="0" max="1" value={p.mapX ?? ""} onChange={(e) => setProp("mapX", e.target.value === "" ? undefined : num(e.target.value))} /></label>
            <label className="nx-field"><span>Map Y (0-1)</span><input type="number" step="0.01" min="0" max="1" value={p.mapY ?? ""} onChange={(e) => setProp("mapY", e.target.value === "" ? undefined : num(e.target.value))} /></label>
            <label className="nx-field" style={{ gridColumn: "1 / -1" }}><span>Date (for Timeline)</span><input type="date" value={p.date || ""} onChange={(e) => setProp("date", e.target.value || undefined)} /></label>
          </div>
        </>
      )}

      <EventsEditor el={el} patch={patch} elements={elements} screens={screens} dataSources={dataSources} remoteEndpoints={remoteEndpoints} />

      <div className="nx-divider" />
      <div className="nx-secttl">Container behavior</div>
      <label className="nx-field"><span>Mode</span>
        <select value={c.mode} onChange={(e) => setContainer({ mode: e.target.value as any })}>
          <option value="static">Static (fixed, default)</option>
          <option value="free">Free (user can drag/resize/rotate)</option>
          <option value="pinnable">Pinnable (user can toggle Free ↔ Static)</option>
        </select>
      </label>
      {c.mode !== "static" && (
        <>
          <div className="nx-grid2">
            <label className="nx-field-row"><input type="checkbox" checked={c.allowMove} onChange={(e) => setContainer({ allowMove: e.target.checked })} /><span>Allow move</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={c.allowResize} onChange={(e) => setContainer({ allowResize: e.target.checked })} /><span>Allow resize</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={c.allowRotate} onChange={(e) => setContainer({ allowRotate: e.target.checked })} /><span>Allow rotate</span></label>
            <label className="nx-field"><span>Move direction</span>
              <select value={c.moveDirection} onChange={(e) => setContainer({ moveDirection: e.target.value as any })}>
                <option value="any">Any</option><option value="horizontal">Horizontal only</option><option value="vertical">Vertical only</option>
              </select>
            </label>
          </div>
          <div className="nx-grid2">
            <label className="nx-field"><span>Min width</span><input type="number" value={c.minWidth ?? ""} onChange={(e) => setContainer({ minWidth: e.target.value === "" ? undefined : num(e.target.value) })} /></label>
            <label className="nx-field"><span>Min height</span><input type="number" value={c.minHeight ?? ""} onChange={(e) => setContainer({ minHeight: e.target.value === "" ? undefined : num(e.target.value) })} /></label>
            <label className="nx-field"><span>Max width</span><input type="number" value={c.maxWidth ?? ""} onChange={(e) => setContainer({ maxWidth: e.target.value === "" ? undefined : num(e.target.value) })} /></label>
            <label className="nx-field"><span>Max height</span><input type="number" value={c.maxHeight ?? ""} onChange={(e) => setContainer({ maxHeight: e.target.value === "" ? undefined : num(e.target.value) })} /></label>
          </div>
          <div className="nx-grid2">
            <label className="nx-field-row"><input type="checkbox" checked={c.showMaximizeButton} onChange={(e) => setContainer({ showMaximizeButton: e.target.checked })} /><span>Show maximize button</span></label>
            <label className="nx-field-row"><input type="checkbox" checked={c.showMinimizeButton} onChange={(e) => setContainer({ showMinimizeButton: e.target.checked })} /><span>Show minimize button</span></label>
          </div>
        </>
      )}

      <div className="nx-divider" />
      <div className="nx-secttl">Effects</div>
      <div className="nx-grid2">
        <label className="nx-field"><span>Blur</span><input type="number" min="0" max="100" value={el.effects.blur} onChange={(e) => setEffects({ blur: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Grayscale</span><input type="number" min="0" max="100" value={el.effects.grayscale} onChange={(e) => setEffects({ grayscale: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Sepia</span><input type="number" min="0" max="100" value={el.effects.sepia} onChange={(e) => setEffects({ sepia: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Hue rotation°</span><input type="number" value={el.effects.hueRotation} onChange={(e) => setEffects({ hueRotation: num(e.target.value) })} /></label>
        <label className="nx-field"><span>Brightness</span><input type="number" min="0" value={el.effects.brightness} onChange={(e) => setEffects({ brightness: num(e.target.value) })} /></label>
      </div>

      <div className="nx-divider" />
      <label className="nx-field-row"><input type="checkbox" checked={el.visible} onChange={(e) => setField("visible", e.target.checked)} /><span>Visible by default</span></label>
      <button className="nx-danger" onClick={onDelete}>Delete element</button>
    </div>
  );
}

// ---- ActionEditor: the "Do" configuration reused by every event on every element ----
function ActionEditor({ action, onChange, elements, screens, ownerId, dataSources, remoteEndpoints }: { action: ActionModel; onChange: (a: ActionModel) => void; elements: StudioElement[]; screens: StudioScreen[]; ownerId: string; dataSources: StudioProject["dataSources"]; remoteEndpoints: StudioProject["remoteEndpoints"] }) {
  const num = (v: string) => (Number.isFinite(+v) ? +v : 0);
  const collections = elements.filter((x) => x.type === "container" && ["grid", "carousel"].includes((x.props as any)?.arrange));
  const maps = elements.filter((x) => x.type === "container" && (x.props as any)?.arrange === "map");
  const timelines = elements.filter((x) => x.type === "container" && (x.props as any)?.arrange === "timeline");
  const slideshows = elements.filter((x) => x.type === "container" && (x.props as any)?.arrange === "slideshow");
  const firstOther = elements.find((x) => x.id !== ownerId)?.id || "";
  const firstCollection = collections[0]?.id || "";

  return (
    <div className="nx-action-editor">
      <label className="nx-field">
        <span>Do</span>
        <select value={action.type} onChange={(e) => {
          const t = e.target.value as ActionModel["type"];
          if (t === "none") onChange({ type: "none" });
          else if (t === "navigate") onChange({ type: "navigate", screen: screens[0]?.id || "" });
          else if (t === "toggleVisibility") onChange({ type: "toggleVisibility", target: firstOther });
          else if (t === "showMessage") onChange({ type: "showMessage", message: "Hello" });
          else if (t === "setVariable") onChange({ type: "setVariable", variable: "count", expr: "count + 1" });
          else if (t === "moveTo") onChange({ type: "moveTo", target: firstOther, x: 0, y: 0 });
          else if (t === "resizeToFactor") onChange({ type: "resizeToFactor", target: firstOther, factor: 1.5 });
          else if (t === "rotateBy") onChange({ type: "rotateBy", target: firstOther, angleOffset: 15 });
          else if (t === "bringToFront") onChange({ type: "bringToFront", target: firstOther });
          else if (t === "sendToBack") onChange({ type: "sendToBack", target: firstOther });
          else if (t === "setOpacity") onChange({ type: "setOpacity", target: firstOther, opacity: 0.5 });
          else if (t === "applyEffects") onChange({ type: "applyEffects", target: firstOther, grayscale: 50 });
          else if (t === "containerState") onChange({ type: "containerState", target: firstOther, op: "toggleMaximize" });
          else if (t === "collectionNext") onChange({ type: "collectionNext", target: firstCollection });
          else if (t === "collectionPrevious") onChange({ type: "collectionPrevious", target: firstCollection });
          else if (t === "collectionScrollToIndex") onChange({ type: "collectionScrollToIndex", target: firstCollection, index: 0 });
          else if (t === "dataQuery") onChange({ type: "dataQuery", source: dataSources[0]?.id || "", into: "rows" });
          else if (t === "remoteSend") onChange({ type: "remoteSend", target: remoteEndpoints[0]?.id || "", action: { type: "none" } });
          else if (t === "panMap") onChange({ type: "panMap", target: maps[0]?.id || "", dx: 50, dy: 0 });
          else if (t === "zoomMap") onChange({ type: "zoomMap", target: maps[0]?.id || "", factor: 1.25 });
          else if (t === "scrollToDate") onChange({ type: "scrollToDate", target: timelines[0]?.id || "", date: new Date().toISOString().slice(0, 10) });
          else if (t === "pauseSlideshow") onChange({ type: "pauseSlideshow", target: slideshows[0]?.id || "" });
          else if (t === "resumeSlideshow") onChange({ type: "resumeSlideshow", target: slideshows[0]?.id || "" });
        }}>
          <option value="none">Nothing</option>
          <optgroup label="Navigation & state">
            <option value="navigate">Go to screen</option>
            <option value="toggleVisibility">Toggle element visibility</option>
            <option value="setVariable">Set variable</option>
            <option value="showMessage">Show message</option>
          </optgroup>
          <optgroup label="Position, size & orientation">
            <option value="moveTo">Move to position</option>
            <option value="resizeToFactor">Resize to factor</option>
            <option value="rotateBy">Rotate by</option>
            <option value="bringToFront">Bring to front</option>
            <option value="sendToBack">Send to back</option>
          </optgroup>
          <optgroup label="Visual effects">
            <option value="setOpacity">Set opacity</option>
            <option value="applyEffects">Apply effects (blur/grayscale/etc.)</option>
          </optgroup>
          <optgroup label="Container (Free / Pinnable elements)">
            <option value="containerState">Maximize / minimize</option>
          </optgroup>
          <optgroup label="Collections (Grid / Carousel containers)">
            <option value="collectionNext">Next item</option>
            <option value="collectionPrevious">Previous item</option>
            <option value="collectionScrollToIndex">Scroll to item index</option>
          </optgroup>
          <optgroup label="Data">
            <option value="dataQuery">Query a data source into a variable</option>
          </optgroup>
          <optgroup label="Remote (another running Player)">
            <option value="remoteSend">Send an action to a remote Player</option>
          </optgroup>
          <optgroup label="Map / Timeline collections">
            <option value="panMap">Pan the map</option>
            <option value="zoomMap">Zoom the map</option>
            <option value="scrollToDate">Scroll the timeline to a date</option>
            <option value="pauseSlideshow">Pause a Slide Show</option>
            <option value="resumeSlideshow">Resume a Slide Show</option>
          </optgroup>
        </select>
      </label>
      {action.type === "navigate" && (
        <label className="nx-field"><span>Screen</span>
          <select value={action.screen} onChange={(e) => onChange({ type: "navigate", screen: e.target.value })}>
            {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {"target" in action && ["toggleVisibility", "moveTo", "resizeToFactor", "rotateBy", "bringToFront", "sendToBack", "setOpacity", "applyEffects", "containerState"].includes(action.type) && (
        <label className="nx-field"><span>Target element</span>
          <select value={(action as any).target} onChange={(e) => onChange({ ...(action as any), target: e.target.value })}>
            {elements.filter((x) => x.id !== ownerId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      )}
      {"target" in action && ["collectionNext", "collectionPrevious", "collectionScrollToIndex"].includes(action.type) && (
        <label className="nx-field"><span>Collection</span>
          <select value={(action as any).target} onChange={(e) => onChange({ ...(action as any), target: e.target.value })}>
            {collections.length === 0 && <option value="">— no Grid/Carousel containers yet —</option>}
            {collections.map((x) => <option key={x.id} value={x.id}>{x.name} ({(x.props as any).arrange})</option>)}
          </select>
        </label>
      )}
      {action.type === "showMessage" && (
        <label className="nx-field"><span>Message</span><input value={action.message} onChange={(e) => onChange({ type: "showMessage", message: e.target.value })} /></label>
      )}
      {action.type === "setVariable" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Variable</span><input value={action.variable} onChange={(e) => onChange({ ...action, variable: e.target.value })} /></label>
          <label className="nx-field"><span>Expression</span><input value={action.expr} onChange={(e) => onChange({ ...action, expr: e.target.value })} /></label>
        </div>
      )}
      {action.type === "moveTo" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>X</span><input type="number" value={action.x} onChange={(e) => onChange({ ...action, x: num(e.target.value) })} /></label>
          <label className="nx-field"><span>Y</span><input type="number" value={action.y} onChange={(e) => onChange({ ...action, y: num(e.target.value) })} /></label>
        </div>
      )}
      {action.type === "resizeToFactor" && (
        <label className="nx-field"><span>Factor (1 = original size)</span><input type="number" step="0.1" value={action.factor} onChange={(e) => onChange({ ...action, factor: num(e.target.value) })} /></label>
      )}
      {action.type === "rotateBy" && (
        <label className="nx-field"><span>Angle offset°</span><input type="number" value={action.angleOffset} onChange={(e) => onChange({ ...action, angleOffset: num(e.target.value) })} /></label>
      )}
      {action.type === "setOpacity" && (
        <label className="nx-field"><span>Opacity (0–1)</span><input type="number" step="0.05" min="0" max="1" value={action.opacity} onChange={(e) => onChange({ ...action, opacity: num(e.target.value) })} /></label>
      )}
      {action.type === "applyEffects" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Blur</span><input type="number" value={action.blur ?? 0} onChange={(e) => onChange({ ...action, blur: num(e.target.value) })} /></label>
          <label className="nx-field"><span>Grayscale</span><input type="number" value={action.grayscale ?? 0} onChange={(e) => onChange({ ...action, grayscale: num(e.target.value) })} /></label>
        </div>
      )}
      {action.type === "containerState" && (
        <label className="nx-field"><span>Operation</span>
          <select value={action.op} onChange={(e) => onChange({ ...action, op: e.target.value as any })}>
            <option value="toggleMaximize">Toggle maximize</option>
            <option value="toggleMinimize">Toggle minimize</option>
            <option value="maximize">Maximize</option>
            <option value="minimize">Minimize</option>
            <option value="normal">Restore to normal</option>
          </select>
        </label>
      )}
      {action.type === "collectionScrollToIndex" && (
        <label className="nx-field"><span>Index (0-based)</span><input type="number" min="0" value={action.index} onChange={(e) => onChange({ ...action, index: num(e.target.value) })} /></label>
      )}
      {action.type === "dataQuery" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Data source</span>
            <select value={action.source} onChange={(e) => onChange({ ...action, source: e.target.value })}>
              {dataSources.length === 0 && <option value="">— no data sources yet, add one in the Data tab —</option>}
              {dataSources.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.kind})</option>)}
            </select>
          </label>
          <label className="nx-field"><span>Into variable</span><input value={action.into} onChange={(e) => onChange({ ...action, into: e.target.value })} /></label>
          {(() => {
            const src = dataSources.find((d) => d.id === action.source);
            const isSql = src?.kind === "sqlite";
            const isExcel = src?.kind === "excel";
            return (
              <label className="nx-field" style={{ gridColumn: "1 / -1" }}>
                <span>{isSql ? "SQL query (required for SQLite)" : isExcel ? "Sheet name (optional — defaults to the first sheet)" : "Query (optional)"}</span>
                <textarea rows={2} value={action.query || ""} onChange={(e) => onChange({ ...action, query: e.target.value })} placeholder={isSql ? "SELECT * FROM products WHERE in_stock = 1" : isExcel ? "Sheet1" : ""} />
              </label>
            );
          })()}
        </div>
      )}
      {action.type === "remoteSend" && (
        <div className="nx-remote-nest">
          <label className="nx-field"><span>Remote Player</span>
            <select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value })}>
              {remoteEndpoints.length === 0 && <option value="">— no remote endpoints yet, add one in the Data tab —</option>}
              {remoteEndpoints.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.host}:{r.port})</option>)}
            </select>
          </label>
          <div className="nx-secttl" style={{ fontSize: 10 }}>Action to run on the REMOTE Player</div>
          <ActionEditor action={action.action} onChange={(a) => onChange({ ...action, action: a })} elements={elements} screens={screens} ownerId={ownerId} dataSources={dataSources} remoteEndpoints={remoteEndpoints} />
        </div>
      )}
      {action.type === "panMap" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Map</span>
            <select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value })}>
              {maps.length === 0 && <option value="">— no Map containers yet —</option>}
              {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div />
          <label className="nx-field"><span>Pan X (px)</span><input type="number" value={action.dx} onChange={(e) => onChange({ ...action, dx: num(e.target.value) })} /></label>
          <label className="nx-field"><span>Pan Y (px)</span><input type="number" value={action.dy} onChange={(e) => onChange({ ...action, dy: num(e.target.value) })} /></label>
        </div>
      )}
      {action.type === "zoomMap" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Map</span>
            <select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value })}>
              {maps.length === 0 && <option value="">— no Map containers yet —</option>}
              {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="nx-field"><span>Zoom factor (1 = no change, &gt;1 = zoom in)</span><input type="number" step="0.1" value={action.factor} onChange={(e) => onChange({ ...action, factor: num(e.target.value) })} /></label>
        </div>
      )}
      {action.type === "scrollToDate" && (
        <div className="nx-grid2">
          <label className="nx-field"><span>Timeline</span>
            <select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value })}>
              {timelines.length === 0 && <option value="">— no Timeline containers yet —</option>}
              {timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="nx-field"><span>Date</span><input type="date" value={action.date} onChange={(e) => onChange({ ...action, date: e.target.value })} /></label>
        </div>
      )}
      {(action.type === "pauseSlideshow" || action.type === "resumeSlideshow") && (
        <label className="nx-field"><span>Slide Show</span>
          <select value={action.target} onChange={(e) => onChange({ ...action, target: e.target.value })}>
            {slideshows.length === 0 && <option value="">— no Slide Show containers yet —</option>}
            {slideshows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

const ALWAYS_TRIGGERS: { value: TriggerType; label: string }[] = [
  { value: "tap", label: "Tap" },
  { value: "doubleTap", label: "Double tap" },
  { value: "longPress", label: "Long press" },
  { value: "swipe", label: "Swipe" },
  { value: "isShown", label: "Is shown" },
  { value: "isHidden", label: "Is hidden" },
  { value: "movedIntoFocus", label: "Moved into focus (collection item)" },
  { value: "movedOutOfFocus", label: "Moved out of focus (collection item)" },
  { value: "pinch", label: "Pinch (two-finger)" },
  { value: "rotate", label: "Rotate (two-finger)" },
  { value: "hasBeenInactive", label: "Has been inactive" },
  { value: "userActivityDetected", label: "User activity detected" },
  { value: "timer", label: "Timer (repeating)" },
  { value: "drop", label: "Something dropped on this" },
];
const MANIPULABLE_TRIGGERS: { value: TriggerType; label: string }[] = [
  { value: "startsToBeManipulated", label: "Starts to be manipulated" },
  { value: "isManipulated", label: "Is manipulated (dragging)" },
  { value: "isMaximized", label: "Is maximized" },
  { value: "isMinimized", label: "Is minimized" },
  { value: "isUnmaximized", label: "Is un-maximized" },
  { value: "isUnminimized", label: "Is un-minimized" },
  { value: "isDroppedOn", label: "Is dropped on…" },
  { value: "isDraggedOver", label: "Is dragged over…" },
  { value: "isDraggedAwayFrom", label: "Is dragged away from…" },
];
const TRIGGER_LABELS = Object.fromEntries([...ALWAYS_TRIGGERS, ...MANIPULABLE_TRIGGERS].map((t) => [t.value, t.label]));

// ---- EventsEditor: universal multi-trigger authoring surface for any element ----
function EventsEditor({ el, patch, elements, screens, dataSources, remoteEndpoints }: { el: StudioElement; patch: (id: string, fn: (e: StudioElement) => StudioElement) => void; elements: StudioElement[]; screens: StudioScreen[]; dataSources: StudioProject["dataSources"]; remoteEndpoints: StudioProject["remoteEndpoints"] }) {
  const availableTriggers = [...ALWAYS_TRIGGERS, ...(el.container.mode !== "static" ? MANIPULABLE_TRIGGERS : [])];
  const [pendingTrigger, setPendingTrigger] = useState<TriggerType>(availableTriggers[0].value);
  const events = el.events || [];

  const setEvents = (fn: (evts: StudioEvent[]) => StudioEvent[]) => patch(el.id, (e) => ({ ...e, events: fn(e.events || []) }));
  const updateEvent = (id: string, fn: (e: StudioEvent) => StudioEvent) => setEvents((evts) => evts.map((e) => (e.id === id ? fn(e) : e)));
  const removeEvent = (id: string) => setEvents((evts) => evts.filter((e) => e.id !== id));

  const addEvent = () => {
    const trigger = pendingTrigger;
    const newEvt: StudioEvent = { id: uid("evt"), trigger, action: { type: "none" } };
    if (trigger === "swipe") newEvt.direction = "any";
    if (["isDroppedOn", "isDraggedOver", "isDraggedAwayFrom"].includes(trigger)) newEvt.target = elements.find((x) => x.id !== el.id)?.id || "";
    if (trigger === "hasBeenInactive" || trigger === "userActivityDetected") newEvt.durationMs = 3000;
    if (trigger === "timer") { newEvt.durationMs = 1000; newEvt.repeatIndefinitely = true; }
    setEvents((evts) => [...evts, newEvt]);
  };

  return (
    <>
      <div className="nx-secttl">Events ({events.length})</div>
      {events.map((evt) => (
        <div key={evt.id} className="nx-event-card">
          <div className="nx-event-head">
            <span className="nx-event-trigger">{TRIGGER_LABELS[evt.trigger] || evt.trigger}</span>
            <button className="nx-btn sm" onClick={() => removeEvent(evt.id)}>✕</button>
          </div>
          {evt.trigger === "swipe" && (
            <label className="nx-field"><span>Direction</span>
              <select value={evt.direction || "any"} onChange={(e) => updateEvent(evt.id, (ev) => ({ ...ev, direction: e.target.value as any }))}>
                <option value="any">Any</option><option value="left">Left</option><option value="right">Right</option><option value="up">Up</option><option value="down">Down</option>
              </select>
            </label>
          )}
          {["isDroppedOn", "isDraggedOver", "isDraggedAwayFrom"].includes(evt.trigger) && (
            <label className="nx-field"><span>Target zone</span>
              <select value={evt.target || ""} onChange={(e) => updateEvent(evt.id, (ev) => ({ ...ev, target: e.target.value }))}>
                {elements.filter((x) => x.id !== el.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          {(evt.trigger === "hasBeenInactive" || evt.trigger === "userActivityDetected") && (
            <label className="nx-field"><span>{evt.trigger === "hasBeenInactive" ? "Idle duration (ms)" : "Delay before arming (ms)"}</span>
              <input type="number" min="0" value={evt.durationMs || 0} onChange={(e) => updateEvent(evt.id, (ev) => ({ ...ev, durationMs: Number(e.target.value) || 0 }))} />
            </label>
          )}
          {evt.trigger === "timer" && (
            <div className="nx-grid2">
              <label className="nx-field"><span>Interval (ms)</span><input type="number" min="1" value={evt.durationMs || 1000} onChange={(e) => updateEvent(evt.id, (ev) => ({ ...ev, durationMs: Number(e.target.value) || 1000 }))} /></label>
              <label className="nx-field-row"><input type="checkbox" checked={evt.repeatIndefinitely !== false} onChange={(e) => updateEvent(evt.id, (ev) => ({ ...ev, repeatIndefinitely: e.target.checked }))} /><span>Repeat</span></label>
            </div>
          )}
          <div className="nx-secttl" style={{ fontSize: 10, marginTop: 6 }}>Then</div>
          <ActionEditor action={evt.action} onChange={(a) => updateEvent(evt.id, (ev) => ({ ...ev, action: a }))} elements={elements} screens={screens} ownerId={el.id} dataSources={dataSources} remoteEndpoints={remoteEndpoints} />
        </div>
      ))}
      <div className="nx-grid2" style={{ marginTop: 8 }}>
        <select value={pendingTrigger} onChange={(e) => setPendingTrigger(e.target.value as TriggerType)}>
          {availableTriggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="nx-btn sm" onClick={addEvent}>+ Add event</button>
      </div>
    </>
  );
}

// ---- DataSourcesEditor: authoring surface for the project's dataSources ----
function DataSourcesEditor({ project, setProject }: { project: StudioProject; setProject: React.Dispatch<React.SetStateAction<StudioProject>> }) {
  const update = (fn: (list: StudioProject["dataSources"]) => StudioProject["dataSources"]) =>
    setProject((p) => ({ ...p, dataSources: fn(p.dataSources) }));

  const addSource = () => {
    update((list) => [...list, { id: uid("data"), name: "New source", kind: "csv", uri: "./data.csv" }]);
  };
  const removeSource = (id: string) => update((list) => list.filter((d) => d.id !== id));
  const patchSource = (id: string, fn: (d: StudioProject["dataSources"][number]) => StudioProject["dataSources"][number]) =>
    update((list) => list.map((d) => (d.id === id ? fn(d) : d)));

  return (
    <div className="nx-layers">
      <p className="nx-hint">Data sources feed <code>dataQuery</code> actions and <code>dataList</code> elements. CSV and JSON read real local files in the desktop Player; SQLite/Excel aren't implemented in the Player yet.</p>
      {project.dataSources.length === 0 && <div className="nx-empty">No data sources yet.</div>}
      {project.dataSources.map((d) => (
        <div key={d.id} className="nx-event-card">
          <div className="nx-event-head">
            <input value={d.name} onChange={(e) => patchSource(d.id, (dd) => ({ ...dd, name: e.target.value }))} style={{ background: "transparent", border: "none", color: "var(--txt)", fontWeight: 700, fontSize: 12, width: "60%" }} />
            <button className="nx-btn sm" onClick={() => removeSource(d.id)}>✕</button>
          </div>
          <div className="nx-grid2">
            <label className="nx-field"><span>Kind</span>
              <select value={d.kind} onChange={(e) => patchSource(d.id, (dd) => ({ ...dd, kind: e.target.value as any }))}>
                <option value="csv">CSV (real)</option>
                <option value="json">JSON (real)</option>
                <option value="rest">REST (real fetch)</option>
                <option value="sqlite">SQLite (real — requires a query)</option>
                <option value="excel">Excel (real — .xlsx/.xls)</option>
              </select>
            </label>
            <label className="nx-field"><span>{d.kind === "rest" ? "URL" : "File path"}</span>
              <input value={d.uri} onChange={(e) => patchSource(d.id, (dd) => ({ ...dd, uri: e.target.value }))} placeholder={d.kind === "rest" ? "https://api.example.com/products" : "./products.csv"} />
            </label>
          </div>
          <div className="nx-hint" style={{ fontSize: 10 }}>id: {d.id}</div>
        </div>
      ))}
      <button className="nx-btn sm" style={{ marginTop: 4 }} onClick={addSource}>+ Add data source</button>
    </div>
  );
}

// ---- BindingField: an expression input with no-code "insert converter" helpers ----
const CONVERTER_PRESETS: { label: string; wrap: (inner: string) => string }[] = [
  { label: "Round to 2 decimals", wrap: (inner) => `round(${inner || "0"}, 2)` },
  { label: "Number format ($, 2 decimals)", wrap: (inner) => `numberFormat(${inner || "0"}, 2, '$', '')` },
  { label: "Uppercase", wrap: (inner) => `upper(${inner || "''"})` },
  { label: "Lowercase", wrap: (inner) => `lower(${inner || "''"})` },
  { label: "Trim whitespace", wrap: (inner) => `trim(${inner || "''"})` },
  { label: "Date format (YYYY-MM-DD)", wrap: (inner) => `dateFormat(${inner || "now()"}, 'YYYY-MM-DD')` },
  { label: "Time format (HH:mm:ss)", wrap: (inner) => `dateFormat(${inner || "now()"}, 'HH:mm:ss')` },
  { label: "Linear map (0–1 → 0–100)", wrap: (inner) => `linear(${inner || "0"}, 0, 1, 0, 100)` },
  { label: "Concat with text", wrap: (inner) => `concat('', ${inner || "''"})` },
  { label: "Clamp with min/max", wrap: (inner) => `max(0, min(100, ${inner || "0"}))` },
];

function BindingField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [preset, setPreset] = useState(CONVERTER_PRESETS[0].label);
  const insert = () => {
    const p = CONVERTER_PRESETS.find((c) => c.label === preset);
    if (!p) return;
    onChange(p.wrap(value.trim()));
  };
  return (
    <div className="nx-binding-field">
      <label className="nx-field"><span>Binding for "{label}" (optional expression)</span>
        <input placeholder="e.g. 'Taps: ' + count" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div className="nx-grid2" style={{ marginTop: 4 }}>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {CONVERTER_PRESETS.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
        <button className="nx-btn sm" onClick={insert} title="Wraps the current expression with this converter — composable, so you can stack several">+ Insert converter</button>
      </div>
    </div>
  );
}

// ---- AssetPicker: choose a local image/video/PDF and embed it into the project ----
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};
const ACCEPT_BY_KIND: Record<"image" | "video" | "pdf", string> = {
  image: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml",
  video: "video/mp4,video/webm,video/quicktime",
  pdf: "application/pdf",
};

function AssetPicker({ kind, props, setProp, assets, onAddAsset, assetIdKey = "assetId", uriKey = "uri" }: {
  kind: "image" | "video" | "pdf";
  props: any;
  setProp: (k: string, v: unknown) => void;
  assets: StudioProject["assets"];
  onAddAsset: (a: Omit<StudioAsset, "id">) => string;
  assetIdKey?: string;
  uriKey?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const current = props[assetIdKey] ? assets.find((a) => a.id === props[assetIdKey]) : undefined;

  const embed = (name: string, mimeType: string, data: string, bytes: number) => {
    const id = onAddAsset({ name, kind, mimeType, data, bytes });
    setProp(assetIdKey, id);
    setProp(uriKey, undefined);
  };

  const choose = async () => {
    if (hasBridge) {
      const res = await window.studio!.pickAsset([kind]);
      if (res.ok && res.data) embed(res.name || "asset", res.mimeType || "application/octet-stream", res.data, res.bytes || 0);
    } else {
      fileInputRef.current?.click();
    }
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    const mimeType = f.type || MIME_BY_EXT[ext] || "application/octet-stream";
    const r = new FileReader();
    r.onload = () => {
      const base64 = String(r.result).split(",")[1] || "";
      embed(f.name, mimeType, base64, f.size);
    };
    r.readAsDataURL(f);
  };

  return (
    <div className="nx-asset-picker">
      <div className="nx-field"><span>{kind === "pdf" ? "PDF file" : kind === "video" ? "Video file" : "Image file"}</span></div>
      {current ? (
        <div className="nx-asset-current">
          <span className="nx-asset-name">{current.name}</span>
          <span className="nx-asset-meta">{(current.bytes / 1024).toFixed(0)} KB · embedded</span>
        </div>
      ) : props[uriKey] ? (
        <div className="nx-asset-current"><span className="nx-asset-name">{props[uriKey]}</span><span className="nx-asset-meta">external URL</span></div>
      ) : (
        <div className="nx-empty" style={{ padding: "6px 0" }}>No file chosen.</div>
      )}
      <div className="nx-grid2" style={{ marginTop: 6 }}>
        <button className="nx-btn sm" onClick={choose}>Choose file…</button>
        <input value={props[uriKey] || ""} onChange={(e) => setProp(uriKey, e.target.value)} placeholder="…or paste an external URL" />
      </div>
      <input ref={fileInputRef} type="file" accept={ACCEPT_BY_KIND[kind]} hidden onChange={onFileInput} />
      <p className="nx-hint" style={{ marginTop: 6 }}>Choosing a file embeds it directly into the project — the exported .isx is fully self-contained and will run on the Player without the original file present.</p>
    </div>
  );
}

// ---- RemoteEndpointsEditor: authoring surface for other Player instances this project can control ----
function RemoteEndpointsEditor({ project, setProject }: { project: StudioProject; setProject: React.Dispatch<React.SetStateAction<StudioProject>> }) {
  const update = (fn: (list: StudioProject["remoteEndpoints"]) => StudioProject["remoteEndpoints"]) =>
    setProject((p) => ({ ...p, remoteEndpoints: fn(p.remoteEndpoints) }));

  const addEndpoint = () => {
    update((list) => [...list, { id: uid("remote"), name: "Display 2", host: "192.168.1.50", port: 9494 }]);
  };
  const removeEndpoint = (id: string) => update((list) => list.filter((r) => r.id !== id));
  const patchEndpoint = (id: string, fn: (r: StudioProject["remoteEndpoints"][number]) => StudioProject["remoteEndpoints"][number]) =>
    update((list) => list.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <div className="nx-layers">
      <p className="nx-hint">Remote endpoints are other Player instances on the network. A <code>Send to remote Player</code> action tells one of them to run its own actions — the sender never needs to know the target's document, only its address and which of the target's own screens/variables it's addressing. Each Player listens on port 9494 by default.</p>
      {project.remoteEndpoints.length === 0 && <div className="nx-empty">No remote endpoints yet.</div>}
      {project.remoteEndpoints.map((r) => (
        <div key={r.id} className="nx-event-card">
          <div className="nx-event-head">
            <input value={r.name} onChange={(e) => patchEndpoint(r.id, (rr) => ({ ...rr, name: e.target.value }))} style={{ background: "transparent", border: "none", color: "var(--txt)", fontWeight: 700, fontSize: 12, width: "60%" }} />
            <button className="nx-btn sm" onClick={() => removeEndpoint(r.id)}>✕</button>
          </div>
          <div className="nx-grid2">
            <label className="nx-field"><span>Host / IP</span><input value={r.host} onChange={(e) => patchEndpoint(r.id, (rr) => ({ ...rr, host: e.target.value }))} placeholder="192.168.1.50" /></label>
            <label className="nx-field"><span>Port</span><input type="number" value={r.port} onChange={(e) => patchEndpoint(r.id, (rr) => ({ ...rr, port: Number(e.target.value) || 9494 }))} /></label>
          </div>
          <div className="nx-hint" style={{ fontSize: 10 }}>id: {r.id}</div>
        </div>
      ))}
      <button className="nx-btn sm" style={{ marginTop: 4 }} onClick={addEndpoint}>+ Add remote endpoint</button>
    </div>
  );
}
