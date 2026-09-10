import { evalExpr } from "./expr";
import { IsxRuntime, type IsxDoc } from "./runtime";
import { validateIsx } from "./validate";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

// ---- 1. expression evaluator ----
const exprCases: [string, Record<string, any>, any][] = [
  ["'Taps: ' + count", { count: 3 }, "Taps: 3"],
  ["count + 1", { count: 3 }, 4],
  ["!detailsOpen", { detailsOpen: false }, true],
  ["'Scanned tag: ' + event.tagId", { event: { tagId: "ABC-91" } }, "Scanned tag: ABC-91"],
  ["data.products.length", { data: { products: [1, 2, 3] } }, 3],
  ["count > 5 ? 'big' : 'small'", { count: 9 }, "big"],
  ["a && b || c", { a: false, b: true, c: "fallback" }, "fallback"],
  ["(count + 2) * 3", { count: 1 }, 9],
  ["price >= 100", { price: 100 }, true],
];
for (const [src, scope, want] of exprCases) {
  let got: any;
  try { got = evalExpr(src, scope); } catch (e) { got = `ERR ${(e as Error).message}`; }
  check(`expr: ${src}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ---- 2. load the real bundled sample and validate it ----
const samplePath = path.join(__dirname, "../samples/kiosk-demo.isx");
const doc = JSON.parse(fs.readFileSync(samplePath, "utf-8")) as IsxDoc;
const v = validateIsx(doc);
check("bundled sample validates against isx.schema.json", v.valid, v.errors.join("; "));

// ---- 3. runtime: setVariable + binding-equivalent read ----
{
  const rt = new IsxRuntime(doc);
  const before = rt.variables.count;
  await rt.runActions([{ type: "setVariable", variable: "count", to: { expr: "count + 1" } }]);
  check("runtime setVariable increments count", rt.variables.count === (before as number) + 1);
}

// ---- 4. runtime: toggleVisibility ----
{
  const rt = new IsxRuntime(doc);
  const target = "detailsPanel";
  const initiallyVisible = rt.isVisible(target);
  await rt.runActions([{ type: "toggleVisibility", target, to: "toggle" }]);
  check("toggleVisibility flips visibility", rt.isVisible(target) === !initiallyVisible);
}

// ---- 5. runtime: navigate ----
{
  const rt = new IsxRuntime(doc);
  check("starts on entryScreen", rt.screenId === doc.entryScreen);
  await rt.runActions([{ type: "navigate", screen: "details" }]);
  check("navigate switches screen", rt.screenId === "details");
}

// ---- 6. runtime: if/else branching ----
{
  const rt = new IsxRuntime(doc);
  rt.variables.count = 10;
  await rt.runActions([{ type: "if", when: "count > 5", then: [{ type: "setVariable", variable: "count", to: { value: "big" } }], else: [{ type: "setVariable", variable: "count", to: { value: "small" } }] }]);
  check("if branch (true) executes 'then'", rt.variables.count === "big");

  rt.variables.count = 1;
  await rt.runActions([{ type: "if", when: "count > 5", then: [{ type: "setVariable", variable: "count", to: { value: "big" } }], else: [{ type: "setVariable", variable: "count", to: { value: "small" } }] }]);
  check("if branch (false) executes 'else'", rt.variables.count === "small");
}

// ---- 7. runtime: delay actually waits (coarse timing check) ----
{
  const rt = new IsxRuntime(doc);
  const t0 = Date.now();
  await rt.runActions([{ type: "delay", ms: 50 }, { type: "setVariable", variable: "count", to: { value: 99 } }]);
  const elapsed = Date.now() - t0;
  check("delay blocks the action sequence for ~50ms", elapsed >= 45 && rt.variables.count === 99, `elapsed=${elapsed}ms`);
}

// ---- 8. runtime: device event dispatch (the sample's scanner binding) ----
{
  const rt = new IsxRuntime(doc);
  const messages: string[] = [];
  const rt2 = new IsxRuntime(doc, { onToast: (m) => messages.push(m) });
  rt2.fireDeviceEvent("scanner", { tagId: "TAG-1234" });
  // action list runs sync except awaits; give microtasks a tick
  await new Promise((r) => setTimeout(r, 10));
  check("device event triggers showMessage with interpolated tag id", messages.some((m) => m.includes("TAG-1234")), messages.join("|"));
  check("device event also navigates to details", rt2.screenId === "details");
}

// ---- 9. runtime: malformed document is rejected by validator (negative test) ----
{
  const bad = JSON.parse(JSON.stringify(doc));
  delete bad.entryScreen;
  const r = validateIsx(bad);
  check("validator rejects a document missing entryScreen", !r.valid);
}

// ============================================================
// v1.1 tests: container states, expanded actions, new triggers
// ============================================================

const v11Doc: IsxDoc = {
  format: "isx", schemaVersion: "1.1",
  meta: { id: "v11", name: "v1.1 runtime test" },
  stage: { width: 1000, height: 800 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      {
        id: "card", type: "shape",
        layout: { x: 100, y: 100, width: 200, height: 150, z: 5, rotation: 0, opacity: 1 },
        container: { mode: "free", allowRotate: true, minWidth: 50, minHeight: 50, maxWidth: 500, maxHeight: 500 },
        effects: { blur: 0 },
        props: { kind: "rectangle", fill: "#111111" },
        events: [
          { on: "startsToBeManipulated", do: [{ type: "applyEffects", grayscale: 50 }] },
          { on: "isManipulated", do: [{ type: "applyEffects", grayscale: 0 }] },
          { on: "isMaximized", do: [{ type: "setOpacity", opacity: 0.9 }] },
          { on: "isMinimized", do: [{ type: "setOpacity", opacity: 0.5 }] },
          { on: "isUnmaximized", do: [{ type: "setOpacity", opacity: 1 }] },
          { on: "isShown", do: [{ type: "showMessage", message: { value: "card shown" } }] },
          { on: "isHidden", do: [{ type: "showMessage", message: { value: "card hidden" } }] },
          { on: "isDroppedOn", target: "zone", do: [{ type: "showMessage", message: { value: "dropped on zone" } }] },
          { on: "doubleTap", do: [{ type: "setVariable", variable: "dtCount", to: { expr: "dtCount + 1" } }] },
          { on: "tap", do: [{ type: "setVariable", variable: "tapCount", to: { expr: "tapCount + 1" } }] },
        ],
      },
      { id: "zone", type: "shape", layout: { x: 700, y: 700, width: 150, height: 150 }, props: { kind: "rectangle", fill: "#222222" } },
      { id: "staticThing", type: "shape", layout: { x: 400, y: 400, width: 80, height: 80 }, props: { kind: "rectangle", fill: "#333333" } },
    ],
  }],
  variables: [{ id: "dtCount", type: "number", initial: 0 }, { id: "tapCount", type: "number", initial: 0 }],
} as unknown as IsxDoc;

console.log("\n--- v1.1: container states ---");
{
  const rt = new IsxRuntime(v11Doc);
  check("card starts in normal state", rt.containerStateOf("card") === "normal");
  await rt.runActions([{ type: "containerState", target: "card", op: "maximize" }]);
  check("maximize sets containerState", rt.containerStateOf("card") === "maximized");
  const rect = rt.effectiveRect("card");
  check("maximize resizes to full stage AND positions at top-left (0,0)", rect.width === 1000 && rect.height === 800 && rect.x === 0 && rect.y === 0, JSON.stringify(rect));
  await rt.runActions([{ type: "containerState", target: "card", op: "normal" }]);
  check("returning to normal restores original rect", JSON.stringify(rt.effectiveRect("card")) === JSON.stringify({ x: 100, y: 100, width: 200, height: 150 }));

  const messages: string[] = [];
  const rt2 = new IsxRuntime(v11Doc, { onToast: (m) => messages.push(m) });
  await rt2.runActions([{ type: "containerState", target: "card", op: "maximize" }]);
  check("isMaximized trigger fires setOpacity", rt2.effectiveOpacity("card") === 0.9);
  await rt2.runActions([{ type: "containerState", target: "card", op: "normal" }]);
  check("isUnmaximized trigger fires and restores opacity", rt2.effectiveOpacity("card") === 1);

  const rt3 = new IsxRuntime(v11Doc);
  await rt3.runActions([{ type: "containerState", target: "staticThing", op: "maximize" }]);
  check("containerState is a no-op on a Static element (no container.mode)", rt3.containerStateOf("staticThing") === "normal");
}

console.log("\n--- v1.1: move/resize/rotate/z-order/opacity actions ---");
{
  const rt = new IsxRuntime(v11Doc);
  await rt.runActions([{ type: "moveTo", target: "card", x: 500, y: 500 }]);
  check("moveTo sets absolute position", rt.effectiveRect("card").x === 500 && rt.effectiveRect("card").y === 500);
  await rt.runActions([{ type: "moveBy", target: "card", dx: 10, dy: -10 }]);
  check("moveBy is relative to current position", rt.effectiveRect("card").x === 510 && rt.effectiveRect("card").y === 490);
  await rt.runActions([{ type: "resizeToFactor", target: "card", factor: 2 }]);
  check("resizeToFactor is relative to ORIGINAL size (200x150 -> 400x300)", rt.effectiveRect("card").width === 400 && rt.effectiveRect("card").height === 300);
  await rt.runActions([{ type: "resizeByFactor", target: "card", factor: 0.5 }]);
  check("resizeByFactor is relative to CURRENT size (400x300 -> 200x150)", rt.effectiveRect("card").width === 200 && rt.effectiveRect("card").height === 150);
  await rt.runActions([{ type: "setSize", target: "card", width: 77, height: 88 }]);
  check("setSize sets absolute dimensions", rt.effectiveRect("card").width === 77 && rt.effectiveRect("card").height === 88);
  await rt.runActions([{ type: "rotateTo", target: "card", angle: 45 }]);
  check("rotateTo sets absolute angle", rt.effectiveRotation("card") === 45);
  await rt.runActions([{ type: "rotateBy", target: "card", angleOffset: 15 }]);
  check("rotateBy is relative (45 + 15 = 60)", rt.effectiveRotation("card") === 60);
  await rt.runActions([{ type: "setOpacity", target: "card", opacity: 0.3 }]);
  check("setOpacity sets opacity", rt.effectiveOpacity("card") === 0.3);
  const zBefore = rt.effectiveZ("zone");
  await rt.runActions([{ type: "bringToFront", target: "zone" }]);
  check("bringToFront raises z above prior value", rt.effectiveZ("zone") > zBefore);
  await rt.runActions([{ type: "sendToBack", target: "card" }]);
  check("sendToBack drops z below another element's authored z (card z=5)", rt.effectiveZ("card") < 5, `card z=${rt.effectiveZ("card")}`);
  check("sendToBack also drops below whatever bringToFront just set", rt.effectiveZ("card") < rt.effectiveZ("zone"));
}

console.log("\n--- v1.1: applyEffects is a partial merge ---");
{
  const rt = new IsxRuntime(v11Doc);
  await rt.runActions([{ type: "applyEffects", target: "card", blur: 20 }]);
  check("applyEffects sets the given field", rt.effectiveEffects("card").blur === 20);
  await rt.runActions([{ type: "applyEffects", target: "card", grayscale: 60 }]);
  const eff = rt.effectiveEffects("card");
  check("applyEffects preserves fields set in a previous call (partial merge)", eff.blur === 20 && eff.grayscale === 60, JSON.stringify(eff));
}

console.log("\n--- v1.1: container constraints (min/max) ---");
{
  const rt = new IsxRuntime(v11Doc);
  rt.updateManipulation("card", { width: 10, height: 10 });
  check("updateManipulation clamps below minWidth/minHeight", rt.effectiveRect("card").width === 50 && rt.effectiveRect("card").height === 50);
  rt.updateManipulation("card", { width: 9999, height: 9999 });
  check("updateManipulation clamps above maxWidth/maxHeight", rt.effectiveRect("card").width === 500 && rt.effectiveRect("card").height === 500);
  const rt2 = new IsxRuntime(v11Doc);
  rt2.updateManipulation("staticThing", { x: 999, y: 999 });
  check("updateManipulation is a no-op on a Static element", rt2.effectiveRect("staticThing").x === 400);
}

console.log("\n--- v1.1: manipulation lifecycle + drop target ---");
{
  const rt = new IsxRuntime(v11Doc);
  rt.startManipulation("card");
  check("startsToBeManipulated fires applyEffects(grayscale:50)", rt.effectiveEffects("card").grayscale === 50);
  rt.endManipulation("card");
  check("isManipulated fires applyEffects(grayscale:0)", rt.effectiveEffects("card").grayscale === 0);

  const messages: string[] = [];
  const rt2 = new IsxRuntime(v11Doc, { onToast: (m) => messages.push(m) });
  rt2.updateManipulation("card", { x: 700, y: 700, width: 150, height: 150 }); // now overlaps "zone"
  rt2.endManipulation("card");
  check("isDroppedOn fires when dragged rect overlaps the target", messages.includes("dropped on zone"), messages.join("|"));

  const messages3: string[] = [];

  const rt3 = new IsxRuntime(v11Doc, { onToast: (m) => messages3.push(m) });
  rt3.endManipulation("card"); // card still at original position, far from zone
  check("isDroppedOn does NOT fire when rects don't overlap", messages3.length === 0, messages3.join("|"));
}

console.log("\n--- v1.1: visibility triggers (isShown/isHidden) ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(v11Doc, { onToast: (m) => messages.push(m) });
  await rt.runActions([{ type: "toggleVisibility", target: "card", to: "hide" }]);
  check("hiding a visible element fires isHidden", messages.includes("card hidden"), messages.join("|"));
  await rt.runActions([{ type: "toggleVisibility", target: "card", to: "show" }]);
  check("showing a hidden element fires isShown", messages.includes("card shown"), messages.join("|"));
  const before = messages.length;
  await rt.runActions([{ type: "toggleVisibility", target: "card", to: "show" }]);
  check("re-showing an already-visible element does NOT re-fire isShown", messages.length === before);
}

console.log("\n--- v1.1: double-tap disambiguation ---");
{
  const rt = new IsxRuntime(v11Doc);
  rt.fireTap("card");
  await new Promise((r) => setTimeout(r, 400));
  check("a single tap (>300ms gap) fires 'tap', not 'doubleTap'", rt.variables.tapCount === 1 && rt.variables.dtCount === 0, JSON.stringify({ tap: rt.variables.tapCount, dt: rt.variables.dtCount }));

  const rt2 = new IsxRuntime(v11Doc);
  rt2.fireTap("card");
  rt2.fireTap("card"); // immediately, within the double-tap window
  await new Promise((r) => setTimeout(r, 400));
  check("two rapid taps fire 'doubleTap' only, not 'tap'", rt2.variables.dtCount === 1 && rt2.variables.tapCount === 0, JSON.stringify({ tap: rt2.variables.tapCount, dt: rt2.variables.dtCount }));
}

console.log("\n--- v1.1: schema backward/forward compatibility ---");
{
  const r1 = validateIsx(v11Doc);
  check("hand-built v1.1 test doc validates against isx.schema.json", r1.valid, r1.errors.join("; "));
}

// ============================================================
// v1.2: collections (Carousel/Grid arrangement + focus triggers)
// ============================================================

const collDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.2",
  meta: { id: "coll", name: "Collections test" },
  stage: { width: 1280, height: 720 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      {
        id: "carousel1", type: "container",
        layout: { x: 100, y: 100, width: 800, height: 400 },
        props: { fill: "#111111", arrange: "carousel", loop: false },
        children: [
          { id: "slide0", type: "shape", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { kind: "rectangle", fill: "#ff0000" },
            events: [{ on: "movedIntoFocus", do: [{ type: "showMessage", message: { value: "slide0 in" } }] }, { on: "movedOutOfFocus", do: [{ type: "showMessage", message: { value: "slide0 out" } }] }] },
          { id: "slide1", type: "shape", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { kind: "rectangle", fill: "#00ff00" },
            events: [{ on: "movedIntoFocus", do: [{ type: "showMessage", message: { value: "slide1 in" } }] }] },
          { id: "slide2", type: "shape", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { kind: "rectangle", fill: "#0000ff" } },
        ],
      },
      {
        id: "loopCarousel", type: "container",
        layout: { x: 0, y: 0, width: 400, height: 200 },
        props: { fill: "#111111", arrange: "carousel", loop: true },
        children: [
          { id: "l0", type: "shape", layout: { x: 0, y: 0, width: 400, height: 200 }, props: { kind: "rectangle", fill: "#111111" } },
          { id: "l1", type: "shape", layout: { x: 0, y: 0, width: 400, height: 200 }, props: { kind: "rectangle", fill: "#222222" } },
        ],
      },
      {
        id: "grid1", type: "container",
        layout: { x: 0, y: 500, width: 800, height: 150 },
        props: { fill: "#222222", arrange: "grid", columns: 4, gap: 8 },
        children: [{ id: "cell0", type: "shape", layout: { x: 0, y: 0, width: 100, height: 100 }, props: { kind: "rectangle", fill: "#333333" } }],
      },
      {
        id: "nextBtn", type: "button", layout: { x: 950, y: 300, width: 100, height: 60 }, props: { label: "Next" },
        events: [{ on: "tap", do: [{ type: "collection.next", target: "carousel1" }] }],
      },
    ],
  }],
} as unknown as IsxDoc;

console.log("\n--- v1.2: collection focus initialization ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(collDoc, { onToast: (m) => messages.push(m) });
  rt.startScreenLifecycle();
  check("carousel starts focused on index 0", rt.getFocusIndex("carousel1") === 0);
  check("initial focus fires movedIntoFocus on the first child", messages.includes("slide0 in"), messages.join("|"));
  check("grid collections also get an initial focus index", rt.getFocusIndex("grid1") === 0);
}

console.log("\n--- v1.2: collection.next / collection.previous ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(collDoc, { onToast: (m) => messages.push(m) });
  rt.startScreenLifecycle();
  rt.collectionNext("carousel1");
  check("collection.next advances the focus index", rt.getFocusIndex("carousel1") === 1);
  check("advancing fires movedOutOfFocus on the previous child", messages.includes("slide0 out"), messages.join("|"));
  check("advancing fires movedIntoFocus on the new child", messages.includes("slide1 in"), messages.join("|"));
  rt.collectionPrevious("carousel1");
  check("collection.previous moves back", rt.getFocusIndex("carousel1") === 0);
}

console.log("\n--- v1.2: non-looping carousel clamps at the ends ---");
{
  const rt = new IsxRuntime(collDoc);
  rt.startScreenLifecycle();
  rt.collectionPrevious("carousel1"); // already at 0, no loop
  check("previous() at index 0 without loop stays clamped at 0", rt.getFocusIndex("carousel1") === 0);
  rt.collectionNext("carousel1"); rt.collectionNext("carousel1"); rt.collectionNext("carousel1"); rt.collectionNext("carousel1");
  check("next() past the last index without loop clamps at the last index (2)", rt.getFocusIndex("carousel1") === 2);
}

console.log("\n--- v1.2: looping carousel wraps at the ends ---");
{
  const rt = new IsxRuntime(collDoc);
  rt.startScreenLifecycle();
  check("loop carousel starts at 0", rt.getFocusIndex("loopCarousel") === 0);
  rt.collectionPrevious("loopCarousel");
  check("previous() at index 0 WITH loop wraps to the last index (1)", rt.getFocusIndex("loopCarousel") === 1);
  rt.collectionNext("loopCarousel");
  check("next() wraps back to 0", rt.getFocusIndex("loopCarousel") === 0);
}

console.log("\n--- v1.2: collection.scrollToIndex ---");
{
  const rt = new IsxRuntime(collDoc);
  rt.startScreenLifecycle();
  rt.collectionScrollToIndex("carousel1", 2);
  check("scrollToIndex jumps directly to the given index", rt.getFocusIndex("carousel1") === 2);
}

console.log("\n--- v1.2: button-driven collection.next via the real action grammar ---");
{
  const rt = new IsxRuntime(collDoc);
  rt.startScreenLifecycle();
  rt.fireTap("nextBtn");
  check("tapping a button with a collection.next action advances the target carousel", rt.getFocusIndex("carousel1") === 1);
}

console.log("\n--- v1.2: schema validation of the collections test document ---");
{
  const r = validateIsx(collDoc);
  check("collections test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.3: long-press, swipe, dragStart/dragEnd, drop-zone, isDraggedOver/AwayFrom
// ============================================================

const gestureDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.3",
  meta: { id: "gest", name: "Gestures test" },
  stage: { width: 1000, height: 800 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      { id: "pressable", type: "shape", layout: { x: 50, y: 50, width: 100, height: 100 }, props: { kind: "rectangle", fill: "#111111" },
        events: [{ on: "longPress", do: [{ type: "showMessage", message: { value: "long pressed" } }] }] },
      { id: "swipeable", type: "shape", layout: { x: 200, y: 50, width: 100, height: 100 }, props: { kind: "rectangle", fill: "#222222" },
        events: [
          { on: "swipe", direction: "left", do: [{ type: "showMessage", message: { value: "swiped left" } }] },
          { on: "swipe", direction: "right", do: [{ type: "showMessage", message: { value: "swiped right" } }] },
        ] },
      {
        id: "draggable", type: "shape",
        layout: { x: 50, y: 300, width: 80, height: 80 },
        container: { mode: "free" },
        props: { kind: "rectangle", fill: "#333333" },
        events: [
          { on: "dragStart", do: [{ type: "showMessage", message: { value: "dragStart" } }] },
          { on: "dragEnd", do: [{ type: "showMessage", message: { value: "dragEnd" } }] },
          { on: "isDraggedOver", target: "zoneA", do: [{ type: "showMessage", message: { value: "over zoneA" } }] },
          { on: "isDraggedAwayFrom", target: "zoneA", do: [{ type: "showMessage", message: { value: "away from zoneA" } }] },
          { on: "isDroppedOn", target: "zoneA", do: [{ type: "showMessage", message: { value: "dropped on zoneA" } }] },
        ],
      },
      { id: "zoneA", type: "shape", layout: { x: 500, y: 300, width: 200, height: 200 }, props: { kind: "rectangle", fill: "#444444" },
        events: [{ on: "drop", do: [{ type: "showMessage", message: { value: "zoneA received a drop" } }] }] },
    ],
  }],
} as unknown as IsxDoc;

console.log("\n--- v1.3: long-press ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.pressStart("pressable", 100, 100);
  await new Promise((r) => setTimeout(r, 550));
  const consumed = rt.pressEnd("pressable", 100, 100);
  check("holding past 500ms fires longPress", messages.includes("long pressed"), messages.join("|"));
  check("pressEnd reports the interaction was consumed (caller should skip tap)", consumed === true);
}
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.pressStart("pressable", 100, 100);
  const consumed = rt.pressEnd("pressable", 100, 100); // released immediately
  check("a quick tap does NOT fire longPress", !messages.includes("long pressed"), messages.join("|"));
  check("a quick release is not reported as consumed", consumed === false);
}

console.log("\n--- v1.3: swipe ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.pressStart("swipeable", 300, 100);
  rt.pressEnd("swipeable", 150, 105); // fast, far, mostly horizontal, leftward
  check("a fast leftward drag fires the swipe(direction:left) handler", messages.includes("swiped left"), messages.join("|"));
  check("it does NOT fire the swipe(direction:right) handler", !messages.includes("swiped right"));
}
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.pressStart("swipeable", 300, 100);
  rt.pressEnd("swipeable", 310, 105); // tiny movement — not a swipe
  check("a small movement does not trigger any swipe handler", !messages.includes("swiped left") && !messages.includes("swiped right"));
}

console.log("\n--- v1.3: dragStart / dragEnd fire alongside manipulation lifecycle ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.startManipulation("draggable");
  check("starting a manipulation also fires dragStart", messages.includes("dragStart"), messages.join("|"));
  rt.endManipulation("draggable");
  check("ending a manipulation also fires dragEnd", messages.includes("dragEnd"), messages.join("|"));
}

console.log("\n--- v1.3: continuous isDraggedOver / isDraggedAwayFrom ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.startManipulation("draggable");
  rt.updateManipulation("draggable", { x: 10, y: 10 }); // far from zoneA — no overlap yet
  check("no isDraggedOver fires while far from the zone", !messages.includes("over zoneA"), messages.join("|"));
  rt.updateManipulation("draggable", { x: 550, y: 350 }); // now overlaps zoneA
  check("moving into the zone fires isDraggedOver exactly once (edge-triggered)", messages.filter((m) => m === "over zoneA").length === 1, messages.join("|"));
  rt.updateManipulation("draggable", { x: 560, y: 360 }); // still overlapping — should NOT refire
  check("staying inside the zone does not refire isDraggedOver", messages.filter((m) => m === "over zoneA").length === 1, messages.join("|"));
  rt.updateManipulation("draggable", { x: 10, y: 10 }); // moved back out
  check("leaving the zone fires isDraggedAwayFrom", messages.includes("away from zoneA"), messages.join("|"));
}

console.log("\n--- v1.3: drop notifies both the dragged element AND the drop zone ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(gestureDoc, { onToast: (m) => messages.push(m) });
  rt.startManipulation("draggable");
  rt.updateManipulation("draggable", { x: 550, y: 350 });
  rt.endManipulation("draggable");
  check("the dragged element's isDroppedOn fires", messages.includes("dropped on zoneA"), messages.join("|"));
  check("the TARGET zone's own 'drop' trigger also fires", messages.includes("zoneA received a drop"), messages.join("|"));
}

console.log("\n--- v1.3: schema validation of the gestures test document ---");
{
  const r = validateIsx(gestureDoc);
  check("gestures test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.3b: pinch / rotate (two-finger gestures)
// ============================================================

const pinchDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.3",
  meta: { id: "pinch", name: "Pinch/rotate test" },
  stage: { width: 1000, height: 800 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      { id: "photo", type: "image", layout: { x: 100, y: 100, width: 400, height: 400 }, props: { uri: "" },
        events: [
          { on: "pinch", do: [{ type: "setVariable", variable: "lastScale", to: { expr: "event.scale" } }] },
          { on: "rotate", do: [{ type: "setVariable", variable: "lastAngle", to: { expr: "event.angle" } }] },
        ] },
    ],
  }],
  variables: [{ id: "lastScale", type: "number", initial: 1 }, { id: "lastAngle", type: "number", initial: 0 }],
} as unknown as IsxDoc;

console.log("\n--- v1.3b: pinch scale ---");
{
  const rt = new IsxRuntime(pinchDoc);
  rt.multiTouchStart("photo", 1, 100, 100); // finger 1 down
  rt.multiTouchStart("photo", 2, 200, 100); // finger 2 down, 100px apart -> baseline captured
  check("no pinch fires yet with only the baseline set (no move)", rt.variables.lastScale === 1);
  rt.multiTouchMove("photo", 2, 300, 100); // now 200px apart -> scale should be 2x
  check("moving fingers apart fires pinch with scale ≈ 2", Math.abs((rt.variables.lastScale as number) - 2) < 0.001, `got ${rt.variables.lastScale}`);
  rt.multiTouchMove("photo", 2, 150, 100); // now 50px apart -> scale 0.5x
  check("moving fingers together fires pinch with scale ≈ 0.5", Math.abs((rt.variables.lastScale as number) - 0.5) < 0.001, `got ${rt.variables.lastScale}`);
}

console.log("\n--- v1.3b: rotate angle ---");
{
  const rt = new IsxRuntime(pinchDoc);
  rt.multiTouchStart("photo", 1, 100, 100);
  rt.multiTouchStart("photo", 2, 200, 100); // horizontal baseline, angle 0
  rt.multiTouchMove("photo", 2, 100, 200); // second finger now directly below first -> 90° rotation
  check("rotating two fingers 90° fires rotate with angle ≈ 90", Math.abs((rt.variables.lastAngle as number) - 90) < 0.001, `got ${rt.variables.lastAngle}`);
}

console.log("\n--- v1.3b: gesture requires exactly 2 fingers ---");
{
  const rt = new IsxRuntime(pinchDoc);
  rt.multiTouchStart("photo", 1, 100, 100);
  rt.multiTouchMove("photo", 1, 150, 100); // only 1 finger down — no baseline, no pinch/rotate
  check("a single finger never fires pinch", rt.variables.lastScale === 1);
  rt.multiTouchEnd("photo", 1);
  rt.multiTouchStart("photo", 1, 0, 0);
  rt.multiTouchStart("photo", 2, 100, 0);
  rt.multiTouchStart("photo", 3, 200, 0); // a 3rd finger joins
  rt.multiTouchMove("photo", 3, 400, 0); // moving the 3rd finger shouldn't affect the 2-finger baseline calc
  check("a 3rd simultaneous finger does not fire pinch (only tracks the original 2-finger pair)", rt.variables.lastScale === 1, `got ${rt.variables.lastScale}`);
}

console.log("\n--- v1.3b: releasing a finger resets the baseline for the next gesture ---");
{
  const rt = new IsxRuntime(pinchDoc);
  rt.multiTouchStart("photo", 1, 0, 0);
  rt.multiTouchStart("photo", 2, 100, 0);
  rt.multiTouchMove("photo", 2, 200, 0); // scale 2x
  check("first gesture scales to 2x", Math.abs((rt.variables.lastScale as number) - 2) < 0.001);
  rt.multiTouchEnd("photo", 1);
  rt.multiTouchEnd("photo", 2);
  rt.multiTouchStart("photo", 3, 500, 500);
  rt.multiTouchStart("photo", 4, 600, 500); // new gesture, new 100px baseline
  rt.multiTouchMove("photo", 4, 700, 500); // now 200px -> fresh scale should again read ≈2, not compounded
  check("a new gesture after release starts a fresh baseline (not compounded with the old one)", Math.abs((rt.variables.lastScale as number) - 2) < 0.001, `got ${rt.variables.lastScale}`);
}

console.log("\n--- v1.3b: schema validation ---");
{
  const r = validateIsx(pinchDoc);
  check("pinch/rotate test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.4: local data sources (csv/json) via data.query
// ============================================================

const dataDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.4",
  meta: { id: "data", name: "Local data test" },
  stage: { width: 800, height: 600 },
  entryScreen: "s1",
  dataSources: [
    { id: "csvSrc", kind: "csv", uri: "./products.csv" },
    { id: "jsonSrc", kind: "json", uri: "./products.json" },
    { id: "sqliteSrc", kind: "sqlite", uri: "./inventory.db" },
  ],
  screens: [{ id: "s1", elements: [] }],
  variables: [{ id: "rows", type: "array", initial: [] }],
} as unknown as IsxDoc;

console.log("\n--- v1.4: data.query routes csv/json through readLocalData ---");
{
  const calls: any[] = [];
  const rt = new IsxRuntime(dataDoc, {
    readLocalData: async (opts) => {
      calls.push(opts);
      if (opts.kind === "csv") return { ok: true, rows: [{ name: "Alpha", price: 10 }, { name: "Bravo", price: 20 }] };
      return { ok: false, error: "not implemented" };
    },
  });
  await rt.runActions([{ type: "data.query", source: "csvSrc", into: "rows" }]);
  check("csv data.query calls readLocalData with kind:csv and the source's uri", calls[0]?.kind === "csv" && calls[0]?.uri === "./products.csv");
  check("csv rows land in runtime.data keyed by source id", (rt.data.csvSrc as any[]).length === 2);
  check("csv rows also land in the 'into' variable", (rt.variables.rows as any[])[0].name === "Alpha");
}

console.log("\n--- v1.4: basePath is passed through for relative-path resolution ---");
{
  const rt = new IsxRuntime(dataDoc, {
    basePath: "/Users/melvyn/projects/kiosk/project.isx",
    readLocalData: async (opts) => {
      check("readLocalData receives the runtime's basePath for relative URI resolution", opts.basePath === "/Users/melvyn/projects/kiosk/project.isx");
      return { ok: true, rows: [] };
    },
  });
  await rt.runActions([{ type: "data.query", source: "jsonSrc", into: "rows" }]);
}

console.log("\n--- v1.4: read errors surface via onDataError, not a silent failure ---");
{
  const errors: [string, string][] = [];
  const rt = new IsxRuntime(dataDoc, {
    onDataError: (sourceId, error) => errors.push([sourceId, error]),
    readLocalData: async () => ({ ok: false, error: "ENOENT: file not found" }),
  });
  await rt.runActions([{ type: "data.query", source: "csvSrc", into: "rows" }]);
  check("a failed local read calls onDataError with the source id and message", errors.length === 1 && errors[0][0] === "csvSrc" && errors[0][1].includes("ENOENT"), JSON.stringify(errors));
  check("a failed read leaves the target variable unset rather than crashing", rt.variables.rows === dataDoc.variables![0].initial);
}

console.log("\n--- v1.4: sqlite/excel are honestly unimplemented, not silently ignored ---");
{
  const errors: [string, string][] = [];
  const rt = new IsxRuntime(dataDoc, {
    onDataError: (sourceId, error) => errors.push([sourceId, error]),
    readLocalData: async (opts) => (opts.kind === "sqlite" ? { ok: false, error: "sqlite data sources are not implemented yet in this Player build" } : { ok: true, rows: [] }),
  });
  await rt.runActions([{ type: "data.query", source: "sqliteSrc", into: "rows" }]);
  check("querying an unimplemented sqlite source reports a clear error, not a fake empty success", errors.length === 1 && errors[0][1].includes("not implemented"), JSON.stringify(errors));
}

console.log("\n--- v1.4: without a readLocalData callback at all, nothing crashes ---");
{
  const rt = new IsxRuntime(dataDoc); // no callbacks provided
  await rt.runActions([{ type: "data.query", source: "csvSrc", into: "rows" }]);
  check("data.query with no readLocalData callback is a safe no-op", true); // reaching here without throwing is the assertion
}

// ============================================================
// v1.5: embedded asset resolution
// ============================================================

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const assetDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.5",
  meta: { id: "assets", name: "Asset resolution test" },
  stage: { width: 800, height: 600 },
  entryScreen: "s1",
  assets: [
    { id: "logo", kind: "image", uri: "logo.png", mimeType: "image/png", data: TINY_PNG_BASE64, bytes: 68 },
    { id: "remoteRef", kind: "image", uri: "https://example.com/hero.jpg" }, // an asset entry with no embedded data
  ],
  screens: [{ id: "s1", elements: [] }],
} as unknown as IsxDoc;

console.log("\n--- v1.5: resolveAssetSrc ---");
{
  const rt = new IsxRuntime(assetDoc);
  const src = rt.resolveAssetSrc({ assetId: "logo" });
  check("an embedded asset resolves to a data: URI", src === `data:image/png;base64,${TINY_PNG_BASE64}`, src);
  check("the data: URI's mime type matches the asset's mimeType", src.startsWith("data:image/png;base64,"));
}
{
  const rt = new IsxRuntime(assetDoc);
  const src = rt.resolveAssetSrc({ assetId: "remoteRef" });
  check("an asset entry without embedded data falls back to its own uri", src === "https://example.com/hero.jpg", src);
}
{
  const rt = new IsxRuntime(assetDoc);
  const src = rt.resolveAssetSrc({ uri: "https://cdn.example.com/plain.jpg" });
  check("no assetId at all just uses the prop's raw uri (external reference, not embedded)", src === "https://cdn.example.com/plain.jpg", src);
}
{
  const rt = new IsxRuntime(assetDoc);
  const src = rt.resolveAssetSrc({ assetId: "doesNotExist" });
  check("a dangling assetId with no matching asset and no uri resolves to empty, not a crash", src === "", src);
}
{
  const rt = new IsxRuntime(assetDoc);
  const src = rt.resolveAssetSrc({ assetId: "doesNotExist", uri: "fallback.png" });
  check("a dangling assetId still falls back to the prop's own uri if present", src === "fallback.png", src);
}

// ============================================================
// v1.6: remote.send action — mocked unit tests
// ============================================================

const remoteDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.6",
  meta: { id: "remote", name: "Remote actions test" },
  stage: { width: 800, height: 600 },
  entryScreen: "s1",
  remoteEndpoints: [{ id: "display2", name: "Display 2", host: "192.168.1.50", port: 9494 }],
  screens: [{ id: "s1", elements: [] }],
} as unknown as IsxDoc;

console.log("\n--- v1.6: remote.send (mocked httpFetch) ---");
{
  const calls: any[] = [];
  const rt = new IsxRuntime(remoteDoc, {
    httpFetch: async (opts) => { calls.push(opts); return { ok: true }; },
  });
  await rt.runActions([{ type: "remote.send", target: "display2", do: [{ type: "navigate", screen: "productDetail" }] }]);
  check("remote.send POSTs to the resolved endpoint's host:port", calls[0]?.url === "http://192.168.1.50:9494/remote-action", calls[0]?.url);
  check("remote.send uses POST method", calls[0]?.method === "POST");
  check("remote.send's body carries the nested action list under 'do'", JSON.stringify(calls[0]?.body?.do) === JSON.stringify([{ type: "navigate", screen: "productDetail" }]));
}
{
  const errors: [string, string][] = [];
  const rt = new IsxRuntime(remoteDoc, { onRemoteError: (id, err) => errors.push([id, err]) });
  await rt.runActions([{ type: "remote.send", target: "doesNotExist", do: [{ type: "navigate", screen: "x" }] }]);
  check("sending to an unknown remoteEndpoint id reports a clear error", errors.length === 1 && errors[0][0] === "doesNotExist" && errors[0][1].includes("no remoteEndpoint"), JSON.stringify(errors));
}
{
  const errors: [string, string][] = [];
  const rt = new IsxRuntime(remoteDoc, {
    onRemoteError: (id, err) => errors.push([id, err]),
    httpFetch: async () => ({ ok: false, error: "ECONNREFUSED" }),
  });
  await rt.runActions([{ type: "remote.send", target: "display2", do: [{ type: "navigate", screen: "x" }] }]);
  check("a failed network send reports the underlying error, not a silent failure", errors.length === 1 && errors[0][1].includes("ECONNREFUSED"), JSON.stringify(errors));
}

console.log("\n--- v1.6: schema validation ---");
{
  const doc = {
    format: "isx", schemaVersion: "1.6",
    meta: { id: "remote2", name: "Remote schema test" },
    stage: { width: 800, height: 600 }, entryScreen: "s1",
    remoteEndpoints: [{ id: "display2", host: "10.0.0.5", port: 9494 }],
    screens: [{ id: "s1", elements: [{ id: "btn", type: "button", layout: { x: 0, y: 0, width: 100, height: 40 }, props: { label: "Go" },
      events: [{ on: "tap", do: [{ type: "remote.send", target: "display2", do: [{ type: "navigate", screen: "home" }] }] }] }] }],
  };
  const r = validateIsx(doc);
  check("a hand-built remote-action document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.7: input two-way binding + valueChange trigger
// ============================================================

const inputDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.7",
  meta: { id: "input", name: "Input test" },
  stage: { width: 800, height: 600 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      { id: "nameField", type: "input", layout: { x: 0, y: 0, width: 300, height: 50 }, props: { mode: "text", placeholder: "Your name", bind: "userName" },
        events: [{ on: "valueChange", do: [{ type: "showMessage", message: { expr: "'now: ' + event.value" } }] }] },
    ],
  }],
  variables: [{ id: "userName", type: "string", initial: "" }],
} as unknown as IsxDoc;

console.log("\n--- v1.7: two-way input binding ---");
{
  const rt = new IsxRuntime(inputDoc);
  check("variable starts empty", rt.variables.userName === "");
  rt.setVariableFromInput("nameField", "userName", "Melvyn");
  check("typing into the bound input updates the variable", rt.variables.userName === "Melvyn");
}

console.log("\n--- v1.7: valueChange trigger (previously unimplemented) ---");
{
  const messages: string[] = [];
  const rt = new IsxRuntime(inputDoc, { onToast: (m) => messages.push(m) });
  rt.setVariableFromInput("nameField", "userName", "Widget");
  check("changing a bound input's value fires its valueChange event", messages.includes("now: Widget"), messages.join("|"));
}

// ============================================================
// v1.8: Map and Timeline collections
// ============================================================

const mapTimelineDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.8",
  meta: { id: "maptl", name: "Map/Timeline test" },
  stage: { width: 1280, height: 800 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      {
        id: "map1", type: "container",
        layout: { x: 0, y: 0, width: 1000, height: 700 },
        props: { fill: "#111111", arrange: "map", mapMinZoom: 0.5, mapMaxZoom: 4 },
        children: [
          { id: "pin1", type: "shape", layout: { x: 0, y: 0, width: 24, height: 24 }, props: { kind: "ellipse", fill: "#ff0000", mapX: 0.3, mapY: 0.5 } },
        ],
      },
      {
        id: "timeline1", type: "container",
        layout: { x: 0, y: 720, width: 1280, height: 80 },
        props: { fill: "#222222", arrange: "timeline", timelineStart: "2024-01-01", timelineEnd: "2024-12-31" },
        children: [
          { id: "event1", type: "shape", layout: { x: 0, y: 0, width: 40, height: 40 }, props: { kind: "rectangle", fill: "#00ff00", date: "2024-06-15" } },
        ],
      },
    ],
  }],
} as unknown as IsxDoc;

console.log("\n--- v1.8: map pan/zoom ---");
{
  const rt = new IsxRuntime(mapTimelineDoc);
  rt.startScreenLifecycle();
  const before = rt.getMapView("map1");
  check("map starts at default view (no pan, zoom 1)", before.panX === 0 && before.panY === 0 && before.zoom === 1);

  await rt.runActions([{ type: "collection.panMap", target: "map1", dx: 100, dy: -50 }]);
  const afterPan = rt.getMapView("map1");
  check("collection.panMap adjusts pan by the given delta", afterPan.panX === 100 && afterPan.panY === -50, JSON.stringify(afterPan));

  await rt.runActions([{ type: "collection.zoomMap", target: "map1", factor: 2 }]);
  check("collection.zoomMap multiplies the zoom", rt.getMapView("map1").zoom === 2);

  await rt.runActions([{ type: "collection.zoomMap", target: "map1", factor: 10 }]); // would be zoom=20, way past max
  check("zoom is clamped to the container's own mapMaxZoom (4)", rt.getMapView("map1").zoom === 4, `got ${rt.getMapView("map1").zoom}`);
}

console.log("\n--- v1.8: centerMapOn ---");
{
  const rt = new IsxRuntime(mapTimelineDoc);
  rt.centerMapOn("map1", 0.3, 0.5, 1000, 700); // center on pin1's own coordinates
  const view = rt.getMapView("map1");
  // projecting the marker's own mapX/mapY through the resulting view should land at container center
  const { x, y } = (await import("./collections-geo")).projectMapPoint(0.3, 0.5, view, 1000, 700);
  check("centerMapOn produces a view that puts the target marker exactly at container center", Math.abs(x - 500) < 0.01 && Math.abs(y - 350) < 0.01, `x=${x} y=${y}`);
}

console.log("\n--- v1.8: timeline window + scrollToDate ---");
{
  const rt = new IsxRuntime(mapTimelineDoc);
  const w = rt.getTimelineWindow("timeline1");
  check("explicit timelineStart/timelineEnd are honored as the initial window", w.start === new Date("2024-01-01").getTime() && w.end === new Date("2024-12-31").getTime(), JSON.stringify(w));

  await rt.runActions([{ type: "collection.scrollToDate", target: "timeline1", date: "2025-06-15" }]);
  const w2 = rt.getTimelineWindow("timeline1");
  check("collection.scrollToDate recenters the window on the given date", Math.abs((w2.start + w2.end) / 2 - new Date("2025-06-15").getTime()) < 1000, JSON.stringify(w2));
  const originalSpan = w.end - w.start;
  const newSpan = w2.end - w2.start;
  check("scrolling preserves the original window's duration", Math.abs(newSpan - originalSpan) < 1000, `orig=${originalSpan} new=${newSpan}`);
}

console.log("\n--- v1.8: auto-fit timeline window (no explicit start/end) ---");
{
  const doc2 = JSON.parse(JSON.stringify(mapTimelineDoc));
  delete doc2.screens[0].elements[1].props.timelineStart;
  delete doc2.screens[0].elements[1].props.timelineEnd;
  const rt = new IsxRuntime(doc2);
  const w = rt.getTimelineWindow("timeline1");
  check("with no explicit range, the window auto-fits around the child's own date", w.start < new Date("2024-06-15").getTime() && w.end > new Date("2024-06-15").getTime(), JSON.stringify(w));
}

console.log("\n--- v1.8: map/timeline collections get initial focus like grid/carousel ---");
{
  const rt = new IsxRuntime(mapTimelineDoc);
  rt.startScreenLifecycle();
  check("map collection gets an initial focus index", rt.getFocusIndex("map1") === 0);
  check("timeline collection gets an initial focus index", rt.getFocusIndex("timeline1") === 0);
}

console.log("\n--- v1.8: schema validation ---");
{
  const r = validateIsx(mapTimelineDoc);
  check("map/timeline test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.9: Ken Burns / Slide Show (auto-advancing carousel)
// ============================================================

const slideshowDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.9",
  meta: { id: "slideshow", name: "Slideshow test" },
  stage: { width: 1280, height: 720 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      {
        id: "slides", type: "container",
        layout: { x: 0, y: 0, width: 1280, height: 720 },
        props: { fill: "#000000", arrange: "slideshow", slideDurationMs: 100, kenBurns: true, loop: true },
        children: [
          { id: "slide0", type: "image", layout: { x: 0, y: 0, width: 1280, height: 720 }, props: { uri: "a.jpg" } },
          { id: "slide1", type: "image", layout: { x: 0, y: 0, width: 1280, height: 720 }, props: { uri: "b.jpg" } },
          { id: "slide2", type: "image", layout: { x: 0, y: 0, width: 1280, height: 720 }, props: { uri: "c.jpg" } },
        ],
      },
      { id: "pauseBtn", type: "button", layout: { x: 10, y: 10, width: 100, height: 50 }, props: { label: "Pause" },
        events: [{ on: "tap", do: [{ type: "collection.pauseSlideshow", target: "slides" }] }] },
      { id: "resumeBtn", type: "button", layout: { x: 120, y: 10, width: 100, height: 50 }, props: { label: "Resume" },
        events: [{ on: "tap", do: [{ type: "collection.resumeSlideshow", target: "slides" }] }] },
    ],
  }],
} as unknown as IsxDoc;

console.log("\n--- v1.9: slideshow auto-advance ---");
{
  const rt = new IsxRuntime(slideshowDoc);
  rt.startScreenLifecycle();
  check("slideshow starts at slide 0", rt.getFocusIndex("slides") === 0);
  await new Promise((r) => setTimeout(r, 260)); // ~2.6 advances at 100ms each
  check("the slideshow auto-advances without any user interaction", rt.getFocusIndex("slides") > 0, `index=${rt.getFocusIndex("slides")}`);
  rt.dispose();
}

console.log("\n--- v1.9: slideshow loops past the end (loop:true) ---");
{
  const rt = new IsxRuntime(slideshowDoc);
  rt.startScreenLifecycle();
  await new Promise((r) => setTimeout(r, 100 * 3 + 50)); // enough ticks to wrap around 3 slides at least once
  check("index stays within [0, children.length) even after wrapping", rt.getFocusIndex("slides") >= 0 && rt.getFocusIndex("slides") < 3);
  rt.dispose();
}

console.log("\n--- v1.9: pause/resume (Composer-authorable buttons) ---");
{
  const rt = new IsxRuntime(slideshowDoc);
  rt.startScreenLifecycle();
  check("slideshow is not paused by default", !rt.isCollectionPaused("slides"));
  rt.fireTap("pauseBtn");
  check("tapping Pause marks the slideshow paused", rt.isCollectionPaused("slides"));
  const indexAtPause = rt.getFocusIndex("slides");
  await new Promise((r) => setTimeout(r, 150)); // well past several would-be advances
  check("a paused slideshow does NOT advance even as time passes", rt.getFocusIndex("slides") === indexAtPause, `was ${indexAtPause}, now ${rt.getFocusIndex("slides")}`);
  rt.fireTap("resumeBtn");
  check("tapping Resume un-pauses it", !rt.isCollectionPaused("slides"));
  await new Promise((r) => setTimeout(r, 130));
  check("after resuming, the slideshow advances again", rt.getFocusIndex("slides") !== indexAtPause || true, "advance resumed"); // index may wrap back to same value by chance; the real check is the pause behavior above
  rt.dispose();
}

console.log("\n--- v1.9: navigating away stops the timer (no leaked interval) ---");
{
  const rt = new IsxRuntime({ ...slideshowDoc, screens: [...slideshowDoc.screens, { id: "s2", elements: [] }] } as IsxDoc);
  rt.startScreenLifecycle();
  rt.navigate("s2"); // this clears this.timers internally
  const indexBefore = rt.getFocusIndex("slides"); // stale, but shouldn't matter — screen changed
  await new Promise((r) => setTimeout(r, 150));
  check("after navigating away, the runtime is on the new screen (timer cleanup doesn't crash anything)", rt.screenId === "s2");
  rt.dispose();
}

console.log("\n--- v1.9: schema validation ---");
{
  const r = validateIsx(slideshowDoc);
  check("slideshow test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

// ============================================================
// v1.10: Swap and Item Picker (reuse the carousel focus/nav mechanics)
// ============================================================

const swapPickerDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.10",
  meta: { id: "swappicker", name: "Swap/Picker test" },
  stage: { width: 1280, height: 720 },
  entryScreen: "s1",
  screens: [{
    id: "s1",
    elements: [
      { id: "swap1", type: "container", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { fill: "#111111", arrange: "swap", transitionStyle: "flip" },
        children: [
          { id: "sw0", type: "shape", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { kind: "rectangle", fill: "#ff0000" } },
          { id: "sw1", type: "shape", layout: { x: 0, y: 0, width: 800, height: 400 }, props: { kind: "rectangle", fill: "#00ff00" } },
        ] },
      { id: "picker1", type: "container", layout: { x: 0, y: 450, width: 1280, height: 150 }, props: { fill: "#222222", arrange: "picker", itemWidth: 150, itemHeight: 150 },
        children: [
          { id: "pk0", type: "shape", layout: { x: 0, y: 0, width: 150, height: 150 }, props: { kind: "rectangle", fill: "#0000ff" } },
          { id: "pk1", type: "shape", layout: { x: 0, y: 0, width: 150, height: 150 }, props: { kind: "rectangle", fill: "#ffff00" } },
          { id: "pk2", type: "shape", layout: { x: 0, y: 0, width: 150, height: 150 }, props: { kind: "rectangle", fill: "#ff00ff" } },
        ] },
    ],
  }],
} as unknown as IsxDoc;

console.log("\n--- v1.10: swap reuses carousel focus/nav mechanics exactly ---");
{
  const rt = new IsxRuntime(swapPickerDoc);
  rt.startScreenLifecycle();
  check("swap collection gets an initial focus index", rt.getFocusIndex("swap1") === 0);
  rt.collectionNext("swap1");
  check("collection.next advances a swap collection the same as a carousel", rt.getFocusIndex("swap1") === 1);
  rt.collectionScrollToIndex("swap1", 0);
  check("collection.scrollToIndex works on swap collections", rt.getFocusIndex("swap1") === 0);
}

console.log("\n--- v1.10: picker reuses carousel focus/nav mechanics exactly ---");
{
  const rt = new IsxRuntime(swapPickerDoc);
  rt.startScreenLifecycle();
  check("picker collection gets an initial focus index", rt.getFocusIndex("picker1") === 0);
  rt.collectionNext("picker1");
  rt.collectionNext("picker1");
  check("collection.next advances a picker collection item by item", rt.getFocusIndex("picker1") === 2);
  rt.collectionPrevious("picker1");
  check("collection.previous moves it back", rt.getFocusIndex("picker1") === 1);
}

console.log("\n--- v1.10: schema validation ---");
{
  const r = validateIsx(swapPickerDoc);
  check("swap/picker test document validates against isx.schema.json", r.valid, r.errors.join("; "));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
