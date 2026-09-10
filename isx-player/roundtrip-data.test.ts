// Round trip for local data sources: a Composer-authored CSV data source
// and dataQuery action, compiled, validated, and executed by the Player's
// real IsxRuntime against a real CSV file on disk (via a readLocalData
// mock that does exactly what the Electron main process does).
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import Papa from "papaparse";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

// a real CSV file on disk, just like a user would have
const csvPath = path.join(__dirname, "tmp-products.csv");
fs.writeFileSync(csvPath, "name,price,inStock\nAlpha Widget,19.99,true\nBravo Gadget,45.50,false\n");

const project = createBlankProject(1000, 800, "#0b0f14", "Data Test");
project.dataSources.push({ id: "products", name: "Product catalog", kind: "csv", uri: csvPath });

const btn = createElement("button");
btn.name = "Load products";
btn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "dataQuery", source: "products", into: "rows" } }];
project.variables.push({ id: "rows", type: "string", initial: "[]" } as any);
project.screens[0].elements.push(btn);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored CSV data source + dataQuery action validates", v.valid, v.errors.join("; "));

async function main() {
  // This readLocalData mock does exactly what electron/main.ts's real handler does —
  // same papaparse call, same fs.readFile — just without Electron's IPC wrapper.
  const rt = new IsxRuntime(doc, {
    readLocalData: async (opts) => {
      if (opts.kind !== "csv") return { ok: false, error: "unsupported in this test" };
      const text = fs.readFileSync(opts.uri, "utf-8");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      return { ok: true, rows: result.data };
    },
  });

  check("no data loaded before the button is tapped", (rt.data.products as any[] | undefined) === undefined);
  rt.fireTap(btn.id);
  await new Promise((r) => setTimeout(r, 10)); // let the async data.query settle

  const rows = rt.data.products as any[];
  check("tapping the Composer-authored button loads the real CSV file", Array.isArray(rows) && rows.length === 2, JSON.stringify(rows));
  check("CSV values are correctly typed (price is a number, not a string)", typeof rows?.[0]?.price === "number" && rows[0].price === 19.99);
  check("the 'into' variable also receives the parsed rows", Array.isArray(rt.variables.rows) && (rt.variables.rows as any[]).length === 2);

  fs.unlinkSync(csvPath);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
