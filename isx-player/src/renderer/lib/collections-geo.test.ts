import { projectMapPoint, panToCenter, clampZoom, dateToTimestamp, computeTimelineWindow, timelinePositionX, recenterTimelineWindow, DEFAULT_MAP_VIEW } from "./collections-geo";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

console.log("--- projectMapPoint ---");
{
  const p = projectMapPoint(0, 0, DEFAULT_MAP_VIEW, 1000, 800);
  check("top-left corner (0,0) at default view maps to pixel (0,0)", p.x === 0 && p.y === 0, JSON.stringify(p));
}
{
  const p = projectMapPoint(1, 1, DEFAULT_MAP_VIEW, 1000, 800);
  check("bottom-right corner (1,1) at default view maps to (containerW, containerH)", p.x === 1000 && p.y === 800, JSON.stringify(p));
}
{
  const p = projectMapPoint(0.5, 0.5, DEFAULT_MAP_VIEW, 1000, 800);
  check("center (0.5,0.5) at default view maps to container center", p.x === 500 && p.y === 400, JSON.stringify(p));
}
{
  const p = projectMapPoint(0.5, 0.5, { panX: 0, panY: 0, zoom: 3 }, 1000, 800);
  check("center point is INVARIANT under zoom (standard map UX — zoom never moves the center)", p.x === 500 && p.y === 400, JSON.stringify(p));
}
{
  const p1 = projectMapPoint(0, 0.5, DEFAULT_MAP_VIEW, 1000, 800);
  const p2 = projectMapPoint(0, 0.5, { panX: 0, panY: 0, zoom: 2 }, 1000, 800);
  check("a point away from center moves further from center as zoom increases", Math.abs(p2.x - 500) > Math.abs(p1.x - 500), `p1.x=${p1.x} p2.x=${p2.x}`);
}
{
  const p = projectMapPoint(0.5, 0.5, { panX: 100, panY: -50, zoom: 1 }, 1000, 800);
  check("panning offsets every point by exactly the pan amount", p.x === 600 && p.y === 350, JSON.stringify(p));
}

console.log("\n--- panToCenter (inverse of projectMapPoint) ---");
{
  const view = { ...panToCenter(0.3, 0.7, 2, 1000, 800), zoom: 2 };
  const p = projectMapPoint(0.3, 0.7, view, 1000, 800);
  check("panToCenter produces a pan that puts the target point exactly at container center", Math.abs(p.x - 500) < 0.0001 && Math.abs(p.y - 400) < 0.0001, JSON.stringify(p));
}

console.log("\n--- clampZoom ---");
check("clamps below the minimum", clampZoom(0.1, 0.5, 4) === 0.5);
check("clamps above the maximum", clampZoom(10, 0.5, 4) === 4);
check("passes through an in-range value unchanged", clampZoom(2, 0.5, 4) === 2);

console.log("\n--- dateToTimestamp ---");
check("parses a valid ISO date", dateToTimestamp("2024-06-15") === new Date("2024-06-15").getTime());
check("throws a clear error on an invalid date string", (() => { try { dateToTimestamp("not a date"); return false; } catch (e) { return String(e).includes("invalid date"); } })());

console.log("\n--- computeTimelineWindow ---");
{
  const w = computeTimelineWindow([], "2024-01-01", "2024-12-31");
  check("explicit start/end wins outright", w.start === dateToTimestamp("2024-01-01") && w.end === dateToTimestamp("2024-12-31"));
}
{
  const w = computeTimelineWindow(["2024-03-01", "2024-06-15", "2024-09-01"]);
  check("auto-fit window covers the full span of child dates (with padding)", w.start < dateToTimestamp("2024-03-01") && w.end > dateToTimestamp("2024-09-01"), JSON.stringify(w));
}
{
  const w = computeTimelineWindow(["2024-06-15"]);
  check("a single child date still produces a valid, non-zero-width window", w.end > w.start, JSON.stringify(w));
}
{
  const w = computeTimelineWindow([]);
  check("no children and no explicit range still produces a sane fallback window", w.end > w.start);
}

console.log("\n--- timelinePositionX ---");
{
  const window = { start: dateToTimestamp("2024-01-01"), end: dateToTimestamp("2025-01-01") };
  const xStart = timelinePositionX("2024-01-01", window, 1000);
  const xEnd = timelinePositionX("2025-01-01", window, 1000);
  check("a date at the window's start maps to x=0", xStart === 0, `${xStart}`);
  check("a date at the window's end maps to x=containerWidth", xEnd === 1000, `${xEnd}`);
  const xMid = timelinePositionX("2024-07-02", window, 1000); // roughly the midpoint of a leap-ish year
  check("a date in the middle maps to roughly the middle of the container", xMid !== null && xMid > 400 && xMid < 600, `${xMid}`);
}
{
  const window = { start: dateToTimestamp("2024-01-01"), end: dateToTimestamp("2024-06-01") };
  const outside = timelinePositionX("2025-01-01", window, 1000);
  check("a date outside the visible window returns null (caller can hide it), not a garbage position", outside === null, `${outside}`);
}

console.log("\n--- recenterTimelineWindow (scrollToDate) ---");
{
  const window = { start: dateToTimestamp("2024-01-01"), end: dateToTimestamp("2024-01-11") }; // 10-day window
  const recentered = recenterTimelineWindow(window, "2024-06-15");
  const originalSpan = window.end - window.start;
  const newSpan = recentered.end - recentered.start;
  check("recentering preserves the window's duration (span), just moves it", Math.abs(newSpan - originalSpan) < 1, `orig=${originalSpan} new=${newSpan}`);
  check("the target date lands exactly at the center of the new window", Math.abs((recentered.start + recentered.end) / 2 - dateToTimestamp("2024-06-15")) < 1);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
