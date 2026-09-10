// Round trip for text input + virtual keyboard support: a Composer-authored
// input element bound to a variable, with a valueChange event, compiled,
// validated, and driven through the Player's real two-way-binding + the
// same pure keyboard logic (insertAtCursor) the on-screen keyboard uses.
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { insertAtCursor } from "./src/renderer/lib/keyboard";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createBlankProject(1000, 800);
project.variables.push({ id: "userName", type: "string", initial: "" } as any);

const field = createElement("input");
field.name = "Name field";
field.props = { mode: "text", placeholder: "Your name", bind: "userName" };
field.events = [{ id: uid("evt"), trigger: "valueChange" as any, action: { type: "showMessage", message: "name updated" } }];

const greeting = createElement("text");
greeting.name = "Greeting";
greeting.bindings = { text: "'Hello, ' + upper(userName) + '!'" };

project.screens[0].elements.push(field, greeting);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored input+binding document validates", v.valid, v.errors.join("; "));

const rt = new IsxRuntime(doc);
const fieldEl = doc.screens[0].elements.find((e: any) => e.name === "Name field") as any;
check("compiled input carries mode/placeholder/bind", fieldEl.props.bind === "userName" && fieldEl.props.mode === "text");

const messages: string[] = [];
const rt2 = new IsxRuntime(doc, { onToast: (m) => messages.push(m) });

// simulate the on-screen keyboard typing "melvyn" one key at a time, exactly
// as VirtualKeyboard's onKeyPress does via insertAtCursor
let value = "", cursor = 0;
for (const ch of "melvyn") {
  const r = insertAtCursor(value, cursor, cursor, ch);
  value = r.value; cursor = r.selectionStart;
  rt2.setVariableFromInput(fieldEl.id, "userName", value);
}
check("typing key-by-key via the real keyboard logic produces the correct final value", rt2.variables.userName === "melvyn", `got "${rt2.variables.userName}"`);
check("each keystroke fired the input's valueChange event (6 keys pressed)", messages.filter((m) => m === "name updated").length === 6);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
