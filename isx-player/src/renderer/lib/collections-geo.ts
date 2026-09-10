// Pure, DOM-free math for the Map and Timeline collection arrangements.
// Kept separate from rendering so the actual positioning logic is
// directly unit-testable — the thing most likely to have an off-by-one
// or sign error is exactly the thing that should never need a running
// browser to verify.

export interface MapView {
  panX: number;
  panY: number;
  zoom: number;
}

export const DEFAULT_MAP_VIEW: MapView = { panX: 0, panY: 0, zoom: 1 };

export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, zoom));
}

/**
 * Projects a normalized (0-1) map coordinate to a pixel position within
 * the container, given the current pan/zoom. Zoom is anchored to the
 * container's CENTER (standard map behavior: the center point never
 * moves when you zoom, only when you pan).
 */
export function projectMapPoint(mapX: number, mapY: number, view: MapView, containerW: number, containerH: number): { x: number; y: number } {
  const baseX = mapX * containerW;
  const baseY = mapY * containerH;
  const cx = containerW / 2;
  const cy = containerH / 2;
  return {
    x: (baseX - cx) * view.zoom + cx + view.panX,
    y: (baseY - cy) * view.zoom + cy + view.panY,
  };
}

/** Inverse of projectMapPoint — given a desired screen position, what pan is needed to put mapX/mapY there (used by "center on marker" actions). */
export function panToCenter(mapX: number, mapY: number, zoom: number, containerW: number, containerH: number): { panX: number; panY: number } {
  const baseX = mapX * containerW;
  const baseY = mapY * containerH;
  const cx = containerW / 2;
  const cy = containerH / 2;
  // We want projectMapPoint(mapX, mapY, {panX,panY,zoom}, W, H) === {x: cx, y: cy}
  return {
    panX: cx - (baseX - cx) * zoom - cx,
    panY: cy - (baseY - cy) * zoom - cy,
  };
}

export function dateToTimestamp(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) throw new Error(`invalid date string: "${iso}"`);
  return t;
}

export interface TimelineWindow {
  start: number; // timestamp ms
  end: number;
}

/**
 * Computes the visible timeline window: explicit start/end win if given;
 * otherwise auto-fits to the children's own dates (with a little padding
 * so the first/last events aren't glued to the edges). Falls back to a
 * one-day window around "now" if there's nothing to go on at all.
 */
export function computeTimelineWindow(childDates: string[], explicitStart?: string, explicitEnd?: string): TimelineWindow {
  if (explicitStart && explicitEnd) {
    return { start: dateToTimestamp(explicitStart), end: dateToTimestamp(explicitEnd) };
  }
  const timestamps = childDates.map(dateToTimestamp).filter((t) => !isNaN(t));
  if (timestamps.length === 0) {
    const now = Date.now();
    return { start: now - 86400000, end: now + 86400000 };
  }
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  if (min === max) return { start: min - 86400000, end: max + 86400000 };
  const pad = (max - min) * 0.05;
  return { start: explicitStart ? dateToTimestamp(explicitStart) : min - pad, end: explicitEnd ? dateToTimestamp(explicitEnd) : max + pad };
}

/** X position (px) for a date within the visible window. Returns null if the date falls outside the window (caller can choose to hide/clip it). */
export function timelinePositionX(iso: string, window: TimelineWindow, containerWidth: number): number | null {
  const t = dateToTimestamp(iso);
  if (t < window.start || t > window.end) return null;
  return ((t - window.start) / (window.end - window.start)) * containerWidth;
}

/** Recenters the window on `iso`, keeping the same window WIDTH (duration) — this is what "scroll to date" does. */
export function recenterTimelineWindow(window: TimelineWindow, iso: string): TimelineWindow {
  const target = dateToTimestamp(iso);
  const halfSpan = (window.end - window.start) / 2;
  return { start: target - halfSpan, end: target + halfSpan };
}
