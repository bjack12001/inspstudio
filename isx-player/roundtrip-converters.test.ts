// Round trip for the binding/converter system: a Composer-authored text
// binding using the new no-code converter functions (numberFormat, upper),
// compiled, validated, and evaluated by the Player's real expression engine.
import { createBlankProject, createElement } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { evalExpr } from "./src/renderer/lib/expr";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createBlankProject(1000, 800);
project.variables.push({ id: "price", type: "number", initial: 19.5 } as any, { id: "productName", type: "string", initial: "widget" } as any);

const priceLabel = createElement("text");
priceLabel.name = "Price label";
// Exactly what the Composer's "Insert converter" button produces, composed twice:
// numberFormat wrapping a variable, matching the "$19.50" pattern.
priceLabel.bindings = { text: "numberFormat(price, 2, '$', '')" };
project.screens[0].elements.push(priceLabel);

const nameLabel = createElement("text");
nameLabel.name = "Name label";
nameLabel.bindings = { text: "upper(productName)" };
project.screens[0].elements.push(nameLabel);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored converter bindings validate against isx.schema.json", v.valid, v.errors.join("; "));

const rt = new IsxRuntime(doc);
const scope = rt.scope();
const priceEl = doc.screens[0].elements.find((e: any) => e.name === "Price label") as any;
const nameEl = doc.screens[0].elements.find((e: any) => e.name === "Name label") as any;

check("compiled document carries the exact converter expression", priceEl.bindings.text === "numberFormat(price, 2, '$', '')");
check("Player evaluates the numberFormat converter correctly", evalExpr(priceEl.bindings.text, scope) === "$19.50", `got ${evalExpr(priceEl.bindings.text, scope)}`);
check("Player evaluates the upper() converter correctly", evalExpr(nameEl.bindings.text, scope) === "WIDGET");

// simulate the variable changing at runtime and re-evaluating — the whole point of a binding
rt.variables.price = 42;
check("re-evaluating after a variable change reflects the new value through the converter", evalExpr(priceEl.bindings.text, rt.scope()) === "$42.00");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
