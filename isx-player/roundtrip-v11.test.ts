// Round-trip for v1.1 features specifically: a Composer-authored Free
// element with a maximize/minimize toggle, compiled and executed by
// the Player's real IsxRuntime.
import { createDemoProject, createElement, withTapAction } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createDemoProject();
const card = createElement("shape");
card.name = "Free card";
card.container = { mode: "free", allowMove: true, moveDirection: "any", allowResize: true, allowRotate: true, minWidth: 50, minHeight: 50, initialState: "normal", showMaximizeButton: true, showMinimizeButton: true };
project.screens[0].elements.push(card);

let btn = createElement("button");
btn.name = "Maximize toggler";
btn = withTapAction(btn, { type: "containerState", target: card.id, op: "toggleMaximize" });
project.screens[0].elements.push(btn);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored v1.1 doc (Free container + containerState action) validates", v.valid, v.errors.join("; "));

const rt = new IsxRuntime(doc);
check("card starts normal", rt.containerStateOf(card.id) === "normal");
rt.fireTap(btn.id);
check("tapping the Composer-authored button toggles the Composer-authored Free element to maximized", rt.containerStateOf(card.id) === "maximized");
const rect = rt.effectiveRect(card.id);
check("maximized card fills the stage", rect.width === doc.stage.width && rect.height === doc.stage.height && rect.x === 0 && rect.y === 0, JSON.stringify(rect));
rt.fireTap(btn.id);
check("tapping again toggles back to normal and restores the original rect", rt.containerStateOf(card.id) === "normal" && rt.effectiveRect(card.id).width === card.rect.width);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
