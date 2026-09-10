import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IsxRuntime, type IsxDoc, type IsxElement } from "./lib/runtime";
import { validateIsx } from "./lib/validate";
import { evalExpr as evalBinding } from "./lib/expr";
import { insertAtCursor, backspaceAtCursor, keyboardLayoutFor, keyRows, EMAIL_EXTRA_KEYS } from "./lib/keyboard";
import { projectMapPoint, timelinePositionX, type MapView, type TimelineWindow } from "./lib/collections-geo";
import sampleRaw from "./samples/kiosk-demo.isx?raw";
const sampleDoc: IsxDoc = JSON.parse(sampleRaw);

const hasBridge = typeof window !== "undefined" && !!window.player;

type LoadState = { doc: IsxDoc | null; sourcePath: string | null; error: string | null };

export default function App() {
  const [load, setLoad] = useState<LoadState>({ doc: sampleDoc, sourcePath: "bundled sample", error: null });
  const [, force] = useState(0);
  const rerender = useCallback(() => force((v) => v + 1), []);
  const [toast, setToast] = useState<string | null>(null);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [focusedInput, setFocusedInput] = useState<{ elementId: string; variableId: string; mode: string; ref: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const [kbShift, setKbShift] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scale, setScale] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<IsxRuntime | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => (load.doc ? validateIsx(load.doc) : { valid: false, errors: ["no document loaded"] }), [load.doc]);

  const httpFetch = hasBridge
    ? window.player!.httpFetch
    : async (opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }) => {
        try {
          const res = await fetch(opts.url, { method: opts.method || "GET", headers: opts.headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
          const text = await res.text();
          let json: unknown = null;
          try { json = JSON.parse(text); } catch { /* not json */ }
          return { ok: res.ok, status: res.status, json, text };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      };

  // (re)build the runtime whenever a new, valid document loads
  useEffect(() => {
    runtimeRef.current?.dispose();
    if (!load.doc || !validation.valid) { runtimeRef.current = null; rerender(); return; }
    const rt = new IsxRuntime(load.doc, {
      onToast: (m) => { setToast(m); window.setTimeout(() => setToast(null), 1900); },
      onScriptBlocked: () => rerender(),
      onDataError: (sourceId, error) => { setToast(`Data source "${sourceId}" failed: ${error}`); window.setTimeout(() => setToast(null), 3500); },
      onRemoteError: (targetId, error) => { setToast(`Remote action to "${targetId}" failed: ${error}`); window.setTimeout(() => setToast(null), 3500); },
      httpFetch,
      basePath: load.sourcePath && load.sourcePath !== "bundled sample" ? load.sourcePath : null,
      readLocalData: hasBridge
        ? (opts) => window.player!.readLocalData(opts)
        : async () => ({ ok: false, error: "local data sources (csv/json/sqlite) need the desktop app — not available in browser preview" }),
    });
    rt.subscribe(rerender);
    runtimeRef.current = rt;
    rt.startScreenLifecycle();
    rerender();
    return () => rt.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.doc]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !load.doc) return;
    const compute = () => {
      const availW = el.clientWidth;
      const availH = el.clientHeight;
      const { width, height } = load.doc!.stage;
      setScale(Math.min(availW / width, availH / height));
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [load.doc]);

  const applyLoadedText = (text: string, sourcePath: string) => {
    try {
      const parsed = JSON.parse(text);
      if (parsed.format !== "isx") throw new Error('Missing "format": "isx" — this is not an .isx document.');
      setLoad({ doc: parsed, sourcePath, error: null });
    } catch (e) {
      setLoad((l) => ({ ...l, error: (e as Error).message }));
    }
  };

  const openDialog = async () => {
    if (hasBridge) {
      const res = await window.player!.openDialog();
      if (res.ok && res.contents) applyLoadedText(res.contents, res.path || "");
    } else {
      fileInputRef.current?.click();
    }
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => applyLoadedText(String(r.result), f.name);
    r.readAsText(f);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => applyLoadedText(String(r.result), f.name);
    r.readAsText(f);
  };
  const loadSample = () => setLoad({ doc: sampleDoc, sourcePath: "bundled sample", error: null });

  useEffect(() => {
    if (!hasBridge) return;
    const offs = [
      window.player!.onMenu("menu:open", openDialog),
      window.player!.onMenu("menu:sample", loadSample),
      window.player!.onMenu("menu:reload", () => setLoad((l) => ({ ...l }))),
      window.player!.onOpenFile((p) => applyLoadedText(p.contents, p.path)),
      window.player!.onRemoteAction((actions) => {
        void runtimeRef.current?.runActions(actions as any, { remote: true });
      }),
    ];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rt = runtimeRef.current;

  const dragRef = useRef<{ id: string; kind: "move" | "resize" | "rotate"; pointerId: number; startClientX: number; startClientY: number; startRect: { x: number; y: number; width: number; height: number }; startRotation: number; moved: boolean } | null>(null);

  const onElementPointerDown = (e: React.PointerEvent, el: IsxElement, kind: "move" | "resize" | "rotate") => {
    if (!rt) return;
    const mode = el.container?.mode;
    if (!mode || mode === "static") return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id: el.id, kind, pointerId: e.pointerId,
      startClientX: e.clientX, startClientY: e.clientY,
      startRect: rt.effectiveRect(el.id), startRotation: rt.effectiveRotation(el.id),
      moved: false,
    };
    rt.startManipulation(el.id);
  };
  const onElementPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !rt || e.pointerId !== d.pointerId) return;
    const dx = (e.clientX - d.startClientX) / scale;
    const dy = (e.clientY - d.startClientY) / scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "move") {
      rt.updateManipulation(d.id, { x: d.startRect.x + dx, y: d.startRect.y + dy });
    } else if (d.kind === "resize") {
      rt.updateManipulation(d.id, { width: Math.max(10, d.startRect.width + dx), height: Math.max(10, d.startRect.height + dy) });
    } else if (d.kind === "rotate") {
      rt.updateManipulation(d.id, { rotation: d.startRotation + dx / 2 });
    }
  };
  const onElementPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !rt || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    rt.endManipulation(d.id);
    if (!d.moved && d.kind === "move") rt.fireTap(d.id); // a manipulable element that wasn't actually dragged still counts as a tap
  };

  /** Computes the effective props (overrides + bindings applied) for an element. */
  const effectiveProps = (el: IsxElement): any => {
    const o = rt?.overrides[el.id];
    const p: any = { ...el.props, ...(o?.props || {}) };
    if (el.bindings && rt) {
      const sc = rt.scope();
      for (const k in el.bindings) {
        try { p[k] = evalBinding(el.bindings[k], sc); } catch { /* leave prop as authored on eval error */ }
      }
    }
    return p;
  };

  /** The visual content for an element's TYPE, independent of how it's positioned (absolute rect, or a grid/carousel cell). */
  const renderInnerContent = (el: IsxElement, p: any, manipulable: boolean): React.ReactNode => {
    if (!rt) return null;
    if (el.type === "text") {
      return <div style={{ width: "100%", height: "100%", display: "flex", whiteSpace: "pre-wrap", color: p.color, fontSize: p.size, fontWeight: p.weight, textAlign: p.align, lineHeight: 1.25, justifyContent: p.align === "center" ? "center" : p.align === "right" ? "flex-end" : "flex-start" }}>{p.text}</div>;
    }
    if (el.type === "button") {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: p.bg, color: p.color, fontSize: p.size, fontWeight: 700, borderRadius: p.radius, cursor: "pointer", boxShadow: "0 6px 20px rgba(34,211,238,.22)" }}>
          {p.label}
        </div>
      );
    }
    if (el.type === "shape") {
      return <div style={{ width: "100%", height: "100%", background: p.fill, borderRadius: p.kind === "ellipse" ? "50%" : p.radius, border: p.strokeWidth ? `${p.strokeWidth}px solid ${p.stroke}` : "none" }} />;
    }
    if (el.type === "container") {
      const arrange = p.arrange || "free";
      if (arrange === "grid") return renderGridChildren(el, p);
      if (arrange === "carousel" || arrange === "slideshow" || arrange === "swap") return renderCarouselChildren(el, p);
      if (arrange === "picker") return renderPickerChildren(el, p);
      if (arrange === "map") return renderMapChildren(el, p);
      if (arrange === "timeline") return renderTimelineChildren(el, p);
      return <div style={{ position: "relative", width: "100%", height: "100%", background: p.fill }}>{(el.children || []).map((c) => <React.Fragment key={c.id}>{renderElement(c)}</React.Fragment>)}</div>;
    }
    if (el.type === "image") {
      const src = rt.resolveAssetSrc(p);
      return src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: p.fit || "cover", borderRadius: p.radius }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", borderRadius: p.radius, display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>image</div>;
    }
    if (el.type === "video") {
      const src = rt.resolveAssetSrc(p);
      return src ? <video src={src} autoPlay={!!p.autoplay} loop={!!p.loop} muted={!!p.muted} controls={p.controls !== false} style={{ width: "100%", height: "100%", background: "#000" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>video</div>;
    }
    if (el.type === "input") {
      const bindVar = p.bind as string | undefined;
      const value = bindVar ? String(rt.variables[bindVar] ?? "") : "";
      const commit = (v: string) => { if (bindVar) rt.setVariableFromInput(el.id, bindVar, v); };
      const onFocusField = (ref: HTMLInputElement | HTMLTextAreaElement) => {
        if (blurTimeoutRef.current) { clearTimeout(blurTimeoutRef.current); blurTimeoutRef.current = null; }
        if (keyboardEnabled && bindVar) setFocusedInput({ elementId: el.id, variableId: bindVar, mode: p.mode || "text", ref });
      };
      const onBlurField = () => {
        blurTimeoutRef.current = setTimeout(() => setFocusedInput(null), 150); // delay lets a virtual key's mousedown register first
      };
      const commonStyle: React.CSSProperties = { width: "100%", height: "100%", background: "#0b0f14", border: "1px solid #2b3a4a", borderRadius: 8, color: "#e6edf3", fontSize: 18, padding: "0 12px", fontFamily: "inherit" };
      if (p.mode === "multiline") {
        return <textarea defaultValue={value} placeholder={p.placeholder} style={{ ...commonStyle, padding: 12, resize: "none" }}
          onFocus={(e) => onFocusField(e.currentTarget)} onBlur={onBlurField} onChange={(e) => commit(e.currentTarget.value)} />;
      }
      return <input type={p.mode === "password" ? "password" : p.mode === "number" ? "text" : p.mode === "email" ? "email" : "text"}
        defaultValue={value} placeholder={p.placeholder} style={commonStyle}
        onFocus={(e) => onFocusField(e.currentTarget)} onBlur={onBlurField} onChange={(e) => commit(e.currentTarget.value)} />;
    }
    if (el.type === "pdf") {
      const src = rt.resolveAssetSrc(p);
      return src ? <embed src={src} type="application/pdf" style={{ width: "100%", height: "100%" }} /> : <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b7183", fontSize: 13 }}>PDF</div>;
    }
    if (el.type === "dataList") {
      const arr = (rt.data[p.source as string] as any[]) || [];
      return <div style={{ display: "flex", flexDirection: p.direction === "vertical" ? "column" : "row", gap: p.gap || 8, width: "100%", height: "100%", overflow: "hidden" }}>{arr.map((it, i) => <div key={i} style={{ background: "#152230", border: "1px solid #22384a", borderRadius: 10, color: "#a9d7dd", fontSize: 16, padding: "0 16px", display: "flex", alignItems: "center", minWidth: 100, height: "100%" }}>{it?.name ?? `Item ${i + 1}`}</div>)}</div>;
    }
    return <div style={{ width: "100%", height: "100%", border: "1px dashed #2b3a4a", color: "#5b7183", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{el.type}</div>;
  };

  /** A grid cell for an indexed 'grid'-arranged container child: ignores the child's own x/y, sized by the grid track. */
  const renderGridCell = (child: IsxElement): React.ReactNode => {
    if (!rt || !rt.isVisible(child.id)) return <div key={child.id} />;
    const p = effectiveProps(child);
    const opacity = rt.effectiveOpacity(child.id);
    const eff = rt.effectiveEffects(child.id);
    const filters = effectFilters(eff);
    const press = child.type !== "container" ? pressHandlers(child.id) : {};
    return (
      <div key={child.id} style={{ position: "relative", opacity, filter: filters }} {...press}>
        {renderInnerContent(child, p, false)}
      </div>
    );
  };

  const renderGridChildren = (el: IsxElement, p: any): React.ReactNode => {
    const columns = Math.max(1, p.columns || 3);
    const gap = p.gap ?? 8;
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gridAutoRows: "1fr", gap, width: "100%", height: "100%", overflow: "auto" }}>
        {(el.children || []).map(renderGridCell)}
      </div>
    );
  };

  /** Only the focused child renders, full-size, with prev/next paging controls. */
  const carouselPrevIndexRef = useRef<Map<string, number>>(new Map());
  const renderCarouselChildren = (el: IsxElement, p: any): React.ReactNode => {
    if (!rt) return null;
    const isSlideshow = p.arrange === "slideshow";
    const isSwap = p.arrange === "swap";
    const children = el.children || [];
    const idx = Math.min(rt.getFocusIndex(el.id), Math.max(0, children.length - 1));
    const current = children[idx];
    const durationMs = p.slideDurationMs ?? 5000;
    const prevIdx = carouselPrevIndexRef.current.get(el.id);
    const goingForward = prevIdx === undefined ? true : idx > prevIdx || (prevIdx === children.length - 1 && idx === 0);
    carouselPrevIndexRef.current.set(el.id, idx);
    const swapStyle = p.transitionStyle || "fade";
    const swapAnimClass = isSwap
      ? swapStyle === "flip" ? (goingForward ? "p-swap-flip-in" : "p-swap-flip-in-rev")
        : swapStyle === "slide" ? (goingForward ? "p-swap-slide-in" : "p-swap-slide-in-rev")
        : "p-slide-fade-in"
      : undefined;
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", perspective: isSwap && swapStyle === "flip" ? 1200 : undefined }}>
        {current && (() => {
          const cp = effectiveProps(current);
          const opacity = rt.effectiveOpacity(current.id);
          const eff = rt.effectiveEffects(current.id);
          const press = current.type !== "container" ? pressHandlers(current.id) : {};
          const kenBurns = isSlideshow && p.kenBurns !== false;
          return rt.isVisible(current.id) ? (
            <div key={`${current.id}-${idx}`} className={swapAnimClass} style={{ position: "absolute", inset: 0, opacity, filter: effectFilters(eff), overflow: "hidden", animation: isSlideshow && p.transition !== "none" ? `p-slide-fade-in ${Math.min(800, durationMs * 0.2)}ms ease` : undefined, animationDuration: isSwap ? "400ms" : undefined }}>
              <div style={{ width: "100%", height: "100%", animation: kenBurns ? `p-ken-burns-${idx % 4} ${durationMs}ms ease-in-out forwards` : undefined }} {...press}>
                {renderInnerContent(current, cp, false)}
              </div>
            </div>
          ) : null;
        })()}
        {!isSlideshow && children.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); rt.collectionPrevious(el.id); }} className="p-carousel-nav prev" aria-label="Previous">‹</button>
            <button onClick={(e) => { e.stopPropagation(); rt.collectionNext(el.id); }} className="p-carousel-nav next" aria-label="Next">›</button>
            <div className="p-carousel-dots">
              {children.map((c, i) => <span key={c.id} className={i === idx ? "on" : ""} onClick={(e) => { e.stopPropagation(); rt.collectionScrollToIndex(el.id, i); }} />)}
            </div>
          </>
        )}
      </div>
    );
  };

  const [pickerDrag, setPickerDrag] = useState<{ id: string; startX: number; deltaX: number } | null>(null);
  const renderPickerChildren = (el: IsxElement, p: any): React.ReactNode => {
    if (!rt) return null;
    const children = el.children || [];
    const idx = Math.min(rt.getFocusIndex(el.id), Math.max(0, children.length - 1));
    const itemW = p.itemWidth || 150;
    const itemH = p.itemHeight || el.layout.height * 0.8;
    const gap = p.gap ?? 16;
    const step = itemW + gap;
    const centerX = el.layout.width / 2;
    const centerY = el.layout.height / 2;
    const liveDelta = pickerDrag?.id === el.id ? pickerDrag.deltaX : 0;

    const onPointerDown = (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setPickerDrag({ id: el.id, startX: e.clientX, deltaX: 0 });
    };
    const onPointerMove = (e: React.PointerEvent) => {
      setPickerDrag((d) => (d && d.id === el.id ? { ...d, deltaX: (e.clientX - d.startX) / scale } : d));
    };
    const onPointerUp = () => {
      if (pickerDrag?.id === el.id) {
        if (pickerDrag.deltaX > step / 3) rt.collectionPrevious(el.id);
        else if (pickerDrag.deltaX < -step / 3) rt.collectionNext(el.id);
      }
      setPickerDrag(null);
    };

    return (
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "grab" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {children.map((c, i) => {
          if (!rt.isVisible(c.id)) return null;
          const offset = i - idx;
          const x = centerX + offset * step + liveDelta - itemW / 2;
          const isFocused = offset === 0;
          const cp = effectiveProps(c);
          const press = c.type !== "container" ? pressHandlers(c.id) : {};
          return (
            <div key={c.id} style={{
              position: "absolute", left: x, top: centerY - itemH / 2, width: itemW, height: itemH,
              transform: `scale(${isFocused ? 1 : 0.8})`, opacity: isFocused ? 1 : 0.55,
              transition: pickerDrag ? undefined : "left 0.25s ease, transform 0.25s ease, opacity 0.25s ease",
              zIndex: isFocused ? 2 : 1,
            }} {...press}>
              {renderInnerContent(c, cp, false)}
            </div>
          );
        })}
      </div>
    );
  };

  const mapDragRef = useRef<{ id: string; lastX: number; lastY: number } | null>(null);
  const timelineDragRef = useRef<{ id: string; lastX: number } | null>(null);

  const renderMapChildren = (el: IsxElement, p: any): React.ReactNode => {
    if (!rt) return null;
    const view = rt.getMapView(el.id);
    const w = el.layout.width, h = el.layout.height;
    const bgSrc = rt.resolveAssetSrc({ assetId: p.mapImageAssetId, uri: p.mapImageUri });
    const onWheel = (e: React.WheelEvent) => { e.preventDefault(); rt.zoomMap(el.id, e.deltaY < 0 ? 1.1 : 1 / 1.1); };
    const onPointerDown = (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      mapDragRef.current = { id: el.id, lastX: e.clientX, lastY: e.clientY };
    };
    const onPointerMove = (e: React.PointerEvent) => {
      const d = mapDragRef.current;
      if (!d || d.id !== el.id) return;
      rt.panMap(el.id, (e.clientX - d.lastX) / scale, (e.clientY - d.lastY) / scale);
      d.lastX = e.clientX; d.lastY = e.clientY;
    };
    const onPointerUp = () => { mapDragRef.current = null; };
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#0a0e13", cursor: "grab" }}
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {bgSrc && (
          <img src={bgSrc} alt="" style={{ position: "absolute", left: -w / 2 * (view.zoom - 1) + view.panX, top: -h / 2 * (view.zoom - 1) + view.panY, width: w * view.zoom, height: h * view.zoom, pointerEvents: "none" }} />
        )}
        {(el.children || []).map((c) => {
          if (!rt.isVisible(c.id)) return null;
          const cp = effectiveProps(c);
          const mapX = cp.mapX ?? 0.5, mapY = cp.mapY ?? 0.5;
          const { x, y } = projectMapPoint(mapX, mapY, view, w, h);
          const cw = c.layout.width, ch = c.layout.height;
          return (
            <div key={c.id} style={{ position: "absolute", left: x - cw / 2, top: y - ch / 2, width: cw, height: ch }}
              onPointerDown={(e) => e.stopPropagation()}>
              {renderInnerContent(c, cp, false)}
            </div>
          );
        })}
        <div className="p-map-zoom">
          <button onClick={(e) => { e.stopPropagation(); rt.zoomMap(el.id, 1.25); }}>+</button>
          <button onClick={(e) => { e.stopPropagation(); rt.zoomMap(el.id, 0.8); }}>−</button>
        </div>
      </div>
    );
  };

  const renderTimelineChildren = (el: IsxElement, p: any): React.ReactNode => {
    if (!rt) return null;
    const window = rt.getTimelineWindow(el.id);
    const w = el.layout.width;
    const onPointerDown = (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      timelineDragRef.current = { id: el.id, lastX: e.clientX };
    };
    const onPointerMove = (e: React.PointerEvent) => {
      const d = timelineDragRef.current;
      if (!d || d.id !== el.id) return;
      const dxPx = (e.clientX - d.lastX) / scale;
      const span = window.end - window.start;
      rt.shiftTimelineWindow(el.id, -(dxPx / w) * span);
      d.lastX = e.clientX;
    };
    const onPointerUp = () => { timelineDragRef.current = null; };
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: p.fill, cursor: "grab" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div className="p-timeline-axis" />
        {(el.children || []).map((c) => {
          if (!rt.isVisible(c.id)) return null;
          const cp = effectiveProps(c);
          if (!cp.date) return null;
          const x = timelinePositionX(cp.date, window, w);
          if (x === null) return null;
          const cw = c.layout.width, ch = c.layout.height;
          return (
            <div key={c.id} style={{ position: "absolute", left: x - cw / 2, top: el.layout.height / 2 - ch / 2, width: cw, height: ch }}
              onPointerDown={(e) => e.stopPropagation()}>
              {renderInnerContent(c, cp, false)}
            </div>
          );
        })}
      </div>
    );
  };

  const effectFilters = (eff: { blur: number; grayscale: number; sepia: number; hueRotation: number; brightness: number }): string | undefined => {
    const filters: string[] = [];
    if (eff.blur) filters.push(`blur(${eff.blur * 0.15}px)`);
    if (eff.grayscale) filters.push(`grayscale(${eff.grayscale}%)`);
    if (eff.sepia) filters.push(`sepia(${eff.sepia}%)`);
    if (eff.hueRotation) filters.push(`hue-rotate(${eff.hueRotation}deg)`);
    if (eff.brightness !== 100) filters.push(`brightness(${eff.brightness}%)`);
    return filters.length ? filters.join(" ") : undefined;
  };

  const activePointersRef = useRef<Map<string, Set<number>>>(new Map());
  const wentMultiTouchRef = useRef<Set<string>>(new Set());

  const pressHandlers = (elementId: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (!rt) return;
      const set = activePointersRef.current.get(elementId) || (activePointersRef.current.set(elementId, new Set()), activePointersRef.current.get(elementId)!);
      set.add(e.pointerId);
      if (set.size === 1) rt.pressStart(elementId, e.clientX, e.clientY);
      if (set.size >= 2) wentMultiTouchRef.current.add(elementId);
      rt.multiTouchStart(elementId, e.pointerId, e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => { rt?.multiTouchMove(elementId, e.pointerId, e.clientX, e.clientY); },
    onPointerUp: (e: React.PointerEvent) => {
      if (!rt) return;
      const set = activePointersRef.current.get(elementId);
      set?.delete(e.pointerId);
      rt.multiTouchEnd(elementId, e.pointerId);
      if (!set || set.size > 0) return; // more fingers still down — gesture continues
      const wasMulti = wentMultiTouchRef.current.has(elementId);
      wentMultiTouchRef.current.delete(elementId);
      const consumed = rt.pressEnd(elementId, e.clientX, e.clientY);
      if (!consumed && !wasMulti) rt.fireTap(elementId); // a 2-finger gesture's release never falls through to a tap
    },
  });

  const renderElement = (el: IsxElement): React.ReactNode => {
    if (!rt) return null;
    if (!rt.isVisible(el.id)) return null;
    const p = effectiveProps(el);
    const rect = rt.effectiveRect(el.id);
    const rotation = rt.effectiveRotation(el.id);
    const opacity = rt.effectiveOpacity(el.id);
    const eff = rt.effectiveEffects(el.id);
    const z = rt.effectiveZ(el.id);
    const filters = effectFilters(eff);

    const manipulable = !!el.container && el.container.mode !== "static";
    const box: React.CSSProperties = {
      position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: z,
      opacity, transform: rotation ? `rotate(${rotation}deg)` : undefined,
      filter: filters,
      cursor: manipulable ? "grab" : undefined,
      touchAction: manipulable ? "none" : undefined,
      outline: manipulable ? "1px dashed rgba(34,211,238,.35)" : undefined,
    };
    const inner = renderInnerContent(el, p, manipulable);

    const chrome = manipulable ? (
      <>
        {el.container?.allowResize !== false && (
          <div onPointerDown={(e) => onElementPointerDown(e, el, "resize")} onPointerMove={onElementPointerMove} onPointerUp={onElementPointerUp}
            style={{ position: "absolute", right: -8, bottom: -8, width: 16, height: 16, background: "#22d3ee", borderRadius: 4, cursor: "nwse-resize", touchAction: "none" }} />
        )}
        {el.container?.allowRotate !== false && (
          <div onPointerDown={(e) => onElementPointerDown(e, el, "rotate")} onPointerMove={onElementPointerMove} onPointerUp={onElementPointerUp}
            style={{ position: "absolute", left: "50%", top: -22, width: 14, height: 14, marginLeft: -7, background: "#f5a524", borderRadius: "50%", cursor: "grab", touchAction: "none" }} />
        )}
        {(el.container?.showMaximizeButton || el.container?.showMinimizeButton) && (
          <div style={{ position: "absolute", top: -26, right: 0, display: "flex", gap: 4 }}>
            {el.container?.showMinimizeButton && (
              <button onClick={(e) => { e.stopPropagation(); rt.runActions([{ type: "containerState", target: el.id, op: "toggleMinimize" }]); }}
                style={{ width: 20, height: 20, fontSize: 11, background: "#182531", color: "#dfe8f0", border: "1px solid #2b3a4a", borderRadius: 4, cursor: "pointer" }}>–</button>
            )}
            {el.container?.showMaximizeButton && (
              <button onClick={(e) => { e.stopPropagation(); rt.runActions([{ type: "containerState", target: el.id, op: "toggleMaximize" }]); }}
                style={{ width: 20, height: 20, fontSize: 11, background: "#182531", color: "#dfe8f0", border: "1px solid #2b3a4a", borderRadius: 4, cursor: "pointer" }}>▢</button>
            )}
          </div>
        )}
      </>
    ) : null;

    const genericPress: { onPointerDown?: (e: React.PointerEvent) => void; onPointerMove?: (e: React.PointerEvent) => void; onPointerUp?: (e: React.PointerEvent) => void } = !manipulable && el.type !== "container" ? pressHandlers(el.id) : {};
    return (
      <div key={el.id} style={box}
        onPointerDown={manipulable ? (e) => onElementPointerDown(e, el, "move") : genericPress.onPointerDown}
        onPointerMove={manipulable ? onElementPointerMove : genericPress.onPointerMove}
        onPointerUp={manipulable ? onElementPointerUp : genericPress.onPointerUp}>
        {inner}
        {chrome}
      </div>
    );
  };

  const deviceBindings = load.doc?.hardware || [];
  const stage = load.doc?.stage;

  return (
    <div className="p-root" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <style>{CSS}</style>
      <header className="p-top">
        <div className="p-brand">
          <span className="p-logo" />
          <span className="p-title">ISX <b>Player</b></span>
          {load.doc && <span className="p-badge">schema {load.doc.schemaVersion}</span>}
        </div>
        <div className="p-actions">
          <button className={`p-btn ${keyboardEnabled ? "on" : ""}`} onClick={() => setKeyboardEnabled((v) => !v)} title="Toggle the on-screen virtual keyboard — turn off if this device has its own">
            ⌨ Keyboard {keyboardEnabled ? "On" : "Off"}
          </button>
          <button className="p-btn" onClick={loadSample}>Bundled Sample</button>
          <button className="p-btn" onClick={openDialog}>Open .isx…</button>
          <input ref={fileInputRef} type="file" accept=".isx,.json,application/json" hidden onChange={onFileInput} />
        </div>
      </header>

      <div className="p-meta">
        <span><b>{load.doc?.meta?.name || "No document"}</b></span>
        <span>source: {load.sourcePath || "—"}</span>
        {stage && <span>{stage.width}×{stage.height}</span>}
        <span className={validation.valid ? "ok" : "bad"}>{validation.valid ? "✓ schema valid" : `✗ ${validation.errors.length} error(s)`}</span>
        {!hasBridge && <span className="p-devwarn">browser preview — Open uses file picker, not native dialog</span>}
      </div>

      {load.error && <div className="p-err">Could not load document: {load.error}</div>}
      {!validation.valid && load.doc && (
        <div className="p-err">
          Document loaded but failed schema validation — refusing to run it:
          <ul>{validation.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {rt && (
        <>
          <div className="p-canvas" ref={wrapRef}>
            <div className="p-wrap" style={{ width: stage!.width * scale, height: stage!.height * scale }}>
              <div className="p-stage" style={{ width: stage!.width, height: stage!.height, transform: `scale(${scale})`, background: rt.screen.background || stage!.background }}>
                {rt.screen.elements.map((el) => renderElement(el))}
                {toast && <div className="p-toast">{toast}</div>}
              </div>
            </div>
          </div>

          {deviceBindings.length > 0 && (
            <div className="p-devbar">
              <span className="p-devlabel">Simulate hardware</span>
              {deviceBindings.map((h) => (
                <button key={h.id} className="p-chip" onClick={() => rt.fireDeviceEvent(h.id, { tagId: "TAG-" + Math.floor(Math.random() * 9000 + 1000) })}>
                  {h.name || h.id} <em>{h.channel}</em>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {dragOver && <div className="p-dropveil">Drop an .isx file to run it</div>}
      {focusedInput && rt && (
        <VirtualKeyboard
          focused={focusedInput}
          shift={kbShift}
          setShift={setKbShift}
          onDone={() => setFocusedInput(null)}
          onKeyPress={(text) => {
            const ref = focusedInput.ref;
            const r = insertAtCursor(ref.value, ref.selectionStart ?? ref.value.length, ref.selectionEnd ?? ref.value.length, text);
            ref.value = r.value;
            ref.setSelectionRange(r.selectionStart, r.selectionEnd);
            rt.setVariableFromInput(focusedInput.elementId, focusedInput.variableId, r.value);
          }}
          onBackspace={() => {
            const ref = focusedInput.ref;
            const r = backspaceAtCursor(ref.value, ref.selectionStart ?? ref.value.length, ref.selectionEnd ?? ref.value.length);
            ref.value = r.value;
            ref.setSelectionRange(r.selectionStart, r.selectionEnd);
            rt.setVariableFromInput(focusedInput.elementId, focusedInput.variableId, r.value);
          }}
        />
      )}
    </div>
  );
}

function VirtualKeyboard({ focused, shift, setShift, onKeyPress, onBackspace, onDone }: {
  focused: { mode: string; ref: HTMLInputElement | HTMLTextAreaElement };
  shift: boolean;
  setShift: (v: boolean | ((p: boolean) => boolean)) => void;
  onKeyPress: (text: string) => void;
  onBackspace: () => void;
  onDone: () => void;
}) {
  const layout = keyboardLayoutFor(focused.mode);
  const rows = keyRows(layout, shift);
  // onMouseDown + preventDefault (not onClick) so the field never loses focus when a key is tapped —
  // this is the standard virtual-keyboard pattern; onClick would blur the input first.
  const press = (text: string) => (e: React.MouseEvent) => { e.preventDefault(); onKeyPress(text); };
  return (
    <div className="p-keyboard" onMouseDown={(e) => e.preventDefault()}>
      {rows.map((row, i) => (
        <div className="p-kb-row" key={i}>
          {row.split("").map((k) => <button key={k} onMouseDown={press(k)}>{k}</button>)}
        </div>
      ))}
      {layout === "email" && (
        <div className="p-kb-row">{EMAIL_EXTRA_KEYS.map((k) => <button key={k} onMouseDown={press(k)}>{k}</button>)}</div>
      )}
      <div className="p-kb-row p-kb-bottom">
        {layout === "qwerty" && <button className="p-kb-wide" onMouseDown={(e) => { e.preventDefault(); setShift((v) => !v); }}>{shift ? "⇧ ABC" : "⇧ abc"}</button>}
        {layout !== "numeric" && <button className="p-kb-space" onMouseDown={press(" ")}>Space</button>}
        {layout === "numeric" && <button className="p-kb-wide" onMouseDown={press(".")}>.</button>}
        <button className="p-kb-wide" onMouseDown={(e) => { e.preventDefault(); onBackspace(); }}>⌫</button>
        <button className="p-kb-wide p-kb-done" onMouseDown={(e) => { e.preventDefault(); onDone(); }}>Done</button>
      </div>
    </div>
  );
}

const CSS = `
.p-root{--bg:#0b0f14;--panel:#0f151c;--panel2:#131b24;--line:#1e2937;--line2:#26333f;--txt:#dfe8f0;--muted:#7d8fa1;--accent:#22d3ee;--danger:#ff6b6b;
font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--txt);background:var(--bg);height:100vh;display:flex;flex-direction:column;position:relative;overflow:hidden}
.p-root *{box-sizing:border-box}
.p-top{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex:none}
.p-brand{display:flex;align-items:center;gap:9px}
.p-logo{width:16px;height:16px;border-radius:5px;background:conic-gradient(from 210deg,var(--accent),#1179a8,var(--accent));box-shadow:0 0 12px rgba(34,211,238,.5)}
.p-title{font-size:15px;font-weight:500}.p-title b{font-weight:800}
.p-badge{font-size:11px;color:var(--muted);border:1px solid var(--line2);border-radius:20px;padding:2px 9px;margin-left:4px}
.p-actions{display:flex;gap:8px}
.p-btn{background:var(--panel2);border:1px solid var(--line2);color:var(--txt);padding:7px 13px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.p-btn:hover{border-color:var(--accent)}
.p-btn.on{border-color:var(--accent);color:var(--accent)}
.p-keyboard{position:fixed;left:0;right:0;bottom:0;background:#10161d;border-top:1px solid var(--line2);padding:10px 14px 14px;z-index:80;box-shadow:0 -10px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:6px;align-items:center}
.p-kb-row{display:flex;gap:6px;justify-content:center}
.p-kb-row button{min-width:34px;height:40px;background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:7px;font-size:15px;cursor:pointer;padding:0 8px}
.p-kb-row button:active{background:var(--accent);color:#04121a}
.p-kb-bottom{width:100%;max-width:640px}
.p-kb-space{flex:1;max-width:320px}
.p-kb-wide{min-width:64px}
.p-kb-done{background:var(--accent);color:#04121a;font-weight:700}
.p-map-zoom{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:4px;z-index:5}
.p-map-zoom button{width:32px;height:32px;background:rgba(8,14,20,.8);border:1px solid var(--line2);color:var(--txt);border-radius:6px;font-size:18px;cursor:pointer}
.p-map-zoom button:hover{border-color:var(--accent)}
.p-timeline-axis{position:absolute;left:0;right:0;top:50%;height:2px;background:var(--line2);pointer-events:none}
@keyframes p-slide-fade-in{from{opacity:0}to{opacity:1}}
@keyframes p-ken-burns-0{from{transform:scale(1) translate(0,0)}to{transform:scale(1.15) translate(-2%,-2%)}}
@keyframes p-ken-burns-1{from{transform:scale(1.15) translate(2%,2%)}to{transform:scale(1) translate(0,0)}}
@keyframes p-ken-burns-2{from{transform:scale(1) translate(0,0)}to{transform:scale(1.15) translate(2%,-2%)}}
@keyframes p-ken-burns-3{from{transform:scale(1.15) translate(-2%,2%)}to{transform:scale(1) translate(0,0)}}
@keyframes p-swap-flip-in{from{transform:rotateY(-90deg);opacity:0.3}to{transform:rotateY(0deg);opacity:1}}
@keyframes p-swap-flip-in-rev{from{transform:rotateY(90deg);opacity:0.3}to{transform:rotateY(0deg);opacity:1}}
@keyframes p-swap-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes p-swap-slide-in-rev{from{transform:translateX(-100%)}to{transform:translateX(0)}}
.p-swap-flip-in,.p-swap-flip-in-rev{animation-name:p-swap-flip-in;animation-fill-mode:both;transform-style:preserve-3d}
.p-swap-flip-in-rev{animation-name:p-swap-flip-in-rev}
.p-swap-slide-in,.p-swap-slide-in-rev{animation-name:p-swap-slide-in;animation-fill-mode:both}
.p-swap-slide-in-rev{animation-name:p-swap-slide-in-rev}
.p-meta{display:flex;gap:16px;padding:8px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);flex-wrap:wrap;align-items:center;flex:none}
.p-meta b{color:var(--txt)}
.p-meta .ok{color:#5ee6a8}.p-meta .bad{color:var(--danger)}
.p-devwarn{color:#f5a524}
.p-err{margin:10px 14px 0;padding:10px 12px;background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.35);border-radius:9px;font-size:12.5px;color:#ffb3b3;flex:none}
.p-err ul{margin:6px 0 0;padding-left:18px}
.p-canvas{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:18px;background:radial-gradient(circle at 50% 0%,#111a24,#0b0f14 60%);overflow:hidden}
.p-wrap{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line2);box-shadow:0 24px 60px rgba(0,0,0,.5);flex:none}
.p-stage{position:absolute;top:0;left:0;transform-origin:top left}
.p-toast{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);background:rgba(8,14,20,.95);border:1px solid var(--accent);color:var(--txt);padding:14px 28px;border-radius:12px;font-size:22px;font-weight:600;box-shadow:0 10px 40px rgba(34,211,238,.3)}
.p-devbar{display:flex;align-items:center;gap:8px;padding:10px 14px;flex-wrap:wrap;border-top:1px solid var(--line);flex:none;max-height:96px;overflow-y:auto}
.p-carousel-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;background:rgba(8,14,20,.7);border:1px solid rgba(34,211,238,.4);color:#e6edf3;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5}
.p-carousel-nav.prev{left:10px}.p-carousel-nav.next{right:10px}
.p-carousel-nav:hover{background:rgba(34,211,238,.25)}
.p-carousel-dots{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:5}
.p-carousel-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer}
.p-carousel-dots span.on{background:var(--accent)}
.p-devlabel{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-right:4px}
.p-chip{background:var(--panel2);border:1px solid var(--line2);color:var(--txt);border-radius:20px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;gap:7px;align-items:center}
.p-chip:hover{border-color:var(--accent)}
.p-chip em{font-style:normal;font-size:10px;color:var(--muted);border:1px solid var(--line2);border-radius:10px;padding:1px 6px}
.p-dropveil{position:fixed;inset:0;background:rgba(11,15,20,.85);border:3px dashed var(--accent);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--accent);z-index:50;pointer-events:none}
`;
