// Full loop for Swap and Item Picker: authored via the Composer's real
// factory/compile functions, validated, and driven through the Player's
// real runtime.
import { createBlankProject, createElement } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createBlankProject(1280, 720);

const swap = createElement("container");
swap.name = "Feature Swap";
swap.rect = { x: 0, y: 0, width: 800, height: 400 };
swap.props = { fill: "#111111", arrange: "swap", transitionStyle: "flip", loop: true };
swap.children = [createElement("shape"), createElement("shape"), createElement("shape")];
project.screens[0].elements.push(swap);

const picker = createElement("container");
picker.name = "Color Picker";
picker.rect = { x: 0, y: 450, width: 1280, height: 150 };
picker.props = { fill: "#222222", arrange: "picker", itemWidth: 120, itemHeight: 120, gap: 20 };
picker.children = [createElement("shape"), createElement("shape"), createElement("shape"), createElement("shape")];
project.screens[0].elements.push(picker);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored Swap+Picker document validates against isx.schema.json", v.valid, v.errors.join("; "));

const compiledSwap = doc.screens[0].elements.find((e: any) => e.name === "Feature Swap") as any;
check("compiled swap carries transitionStyle:flip and loop:true", compiledSwap.props.transitionStyle === "flip" && compiledSwap.props.loop === true);

const compiledPicker = doc.screens[0].elements.find((e: any) => e.name === "Color Picker") as any;
check("compiled picker carries itemWidth/itemHeight/gap", compiledPicker.props.itemWidth === 120 && compiledPicker.props.itemHeight === 120 && compiledPicker.props.gap === 20);

const rt = new IsxRuntime(doc);
rt.startScreenLifecycle();

check("swap starts at index 0", rt.getFocusIndex(swap.id) === 0);
rt.collectionNext(swap.id);
rt.collectionNext(swap.id);
rt.collectionNext(swap.id); // 3 children, loop:true — should wrap back to 0
check("the real swap collection navigates and loops correctly", rt.getFocusIndex(swap.id) === 0, `index=${rt.getFocusIndex(swap.id)}`);

check("picker starts at index 0", rt.getFocusIndex(picker.id) === 0);
rt.collectionNext(picker.id);
check("the real picker collection advances item by item", rt.getFocusIndex(picker.id) === 1);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
