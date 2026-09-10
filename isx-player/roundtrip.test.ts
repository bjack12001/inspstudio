// Round-trip verification: Composer (createDemoProject -> toIsxDocument)
// piped straight into the Player's real IsxRuntime + validator. Every
// import below is the actual source file from each project — nothing
// here is re-implemented for the test.

import { createDemoProject } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

console.log("--- Step 1: author a project exactly as the Composer would ---");
const project = createDemoProject();
check("project has multiple screens", project.screens.length >= 2, `${project.screens.length} screens`);

console.log("\n--- Step 2: compile with the Composer's real toIsxDocument() ---");
const doc = toIsxDocument(project) as unknown as IsxDoc;
check("compiled doc has format:isx", (doc as any).format === "isx");
check("compiled doc targets schemaVersion 1.3", doc.schemaVersion === "1.3");

console.log("\n--- Step 3: validate with the Player's real Ajv validator ---");
const v = validateIsx(doc);
check("Composer output validates against isx.schema.json", v.valid, v.errors.join("; "));
if (!v.valid) { console.log(`\n${pass}/${pass + fail} passed (stopping — invalid doc)`); process.exit(1); }

console.log("\n--- Step 4: load into the Player's real IsxRuntime and drive it ---");
const rt = new IsxRuntime(doc);
check("Player starts on the Composer's entryScreen", rt.screenId === project.entryScreen);

// find the reveal button and details-panel id the Composer actually generated
const home = doc.screens.find((s) => s.id === "home")!;
const revealBtn = home.elements.find((e) => e.name === "Reveal button")!;
const panel = home.elements.find((e) => e.name === "Details panel")!;
check("found the button and panel the Composer authored", !!revealBtn && !!panel);

const before = rt.isVisible(panel.id);
rt.fireTap(revealBtn.id);
check("tapping the Composer-authored button toggles the Composer-authored panel", rt.isVisible(panel.id) === !before);

console.log("\n--- Step 5: cross-screen navigation, driven by the Composer's own action wiring ---");
rt.navigate("details");
check("navigated to the Composer's second screen", rt.screenId === "details");
const backBtn = rt.screen.elements.find((e) => e.name === "Back")!;
check("found the Composer-authored Back button on the details screen", !!backBtn);
rt.fireTap(backBtn.id);
check("Back button's own navigate action returns to home", rt.screenId === "home");

console.log("\n--- Step 6: bindings compiled by the Composer evaluate correctly in the Player ---");
const counter = home.elements.find((e) => e.name === "Counter")!;
const scope = rt.scope();
check("Composer's binding expression is present on the compiled element", (counter as any).bindings?.text === "'Taps: ' + count");
const { evalExpr } = await import("./src/renderer/lib/expr");
const rendered = evalExpr((counter as any).bindings.text, scope);
check("Player evaluates the Composer's binding using its live variable state", rendered === "Taps: 0", `got "${rendered}"`);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
