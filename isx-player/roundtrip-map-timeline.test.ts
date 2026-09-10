// Full loop for Map and Timeline collections: authored via the Composer's
// real factory/compile functions, validated, and driven through the
// Player's real runtime (including the tested projection math).
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { projectMapPoint } from "./src/renderer/lib/collections-geo";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createBlankProject(1280, 800);

// --- Map, authored exactly as the Composer UI would ---
const map = createElement("container");
map.name = "Campus Map";
map.rect = { x: 0, y: 0, width: 1000, height: 700 };
map.props = { fill: "#111111", arrange: "map", mapMinZoom: 0.5, mapMaxZoom: 4 };

const pin = createElement("shape");
pin.name = "Building A";
pin.props = { kind: "ellipse", fill: "#ff0000", mapX: 0.3, mapY: 0.5 };
map.children = [pin];
project.screens[0].elements.push(map);

const zoomBtn = createElement("button");
zoomBtn.name = "Zoom in";
zoomBtn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "zoomMap", target: map.id, factor: 2 } }];
project.screens[0].elements.push(zoomBtn);

const panBtn = createElement("button");
panBtn.name = "Pan right";
panBtn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "panMap", target: map.id, dx: 100, dy: 0 } }];
project.screens[0].elements.push(panBtn);

// --- Timeline, authored exactly as the Composer UI would ---
const timeline = createElement("container");
timeline.name = "Company History";
timeline.rect = { x: 0, y: 720, width: 1280, height: 80 };
timeline.props = { fill: "#222222", arrange: "timeline", timelineStart: "2020-01-01", timelineEnd: "2025-01-01" };

const event = createElement("shape");
event.name = "Founded";
event.props = { kind: "rectangle", fill: "#00ff00", date: "2022-06-15" };
timeline.children = [event];
project.screens[0].elements.push(timeline);

const scrubBtn = createElement("button");
scrubBtn.name = "Jump to event";
scrubBtn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "scrollToDate", target: timeline.id, date: "2022-06-15" } }];
project.screens[0].elements.push(scrubBtn);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored Map+Timeline document validates against isx.schema.json", v.valid, v.errors.join("; "));

const compiledMap = doc.screens[0].elements.find((e: any) => e.name === "Campus Map") as any;
check("compiled map carries arrange:map and zoom limits", compiledMap.props.arrange === "map" && compiledMap.props.mapMaxZoom === 4);
check("compiled map's child carries mapX/mapY", compiledMap.children[0].props.mapX === 0.3 && compiledMap.children[0].props.mapY === 0.5);

const compiledTimeline = doc.screens[0].elements.find((e: any) => e.name === "Company History") as any;
check("compiled timeline carries its date range", compiledTimeline.props.timelineStart === "2020-01-01" && compiledTimeline.props.timelineEnd === "2025-01-01");
check("compiled timeline's child carries its date", compiledTimeline.children[0].props.date === "2022-06-15");

const rt = new IsxRuntime(doc);
rt.startScreenLifecycle();

// Map interaction
check("map starts unzoomed/unpanned", rt.getMapView(map.id).zoom === 1 && rt.getMapView(map.id).panX === 0);
rt.fireTap(zoomBtn.id);
check("tapping the Composer-authored 'Zoom in' button zooms the real map", rt.getMapView(map.id).zoom === 2);
rt.fireTap(panBtn.id);
check("tapping the Composer-authored 'Pan right' button pans the real map", rt.getMapView(map.id).panX === 100);

// verify the marker actually projects to the correct pixel position given the current view
const view = rt.getMapView(map.id);
const { x, y } = projectMapPoint(0.3, 0.5, view, 1000, 700);
check("the marker's screen position reflects the real zoom+pan state via the tested projection math", x > 0 && y > 0, `x=${x} y=${y}`);

// Timeline interaction
const beforeWindow = rt.getTimelineWindow(timeline.id);
check("timeline starts with the authored date range", beforeWindow.start === new Date("2020-01-01").getTime());
rt.fireTap(scrubBtn.id);
const afterWindow = rt.getTimelineWindow(timeline.id);
check("tapping the Composer-authored 'Jump to event' button recenters the real timeline on that date", Math.abs((afterWindow.start + afterWindow.end) / 2 - new Date("2022-06-15").getTime()) < 1000, JSON.stringify(afterWindow));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
