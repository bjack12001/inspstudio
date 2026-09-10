// Full loop: a Composer-authored Excel data source + query action
// (real Composer factory/compile functions), validated, and run
// against a REAL .xlsx file through the real readExcel reader.
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { readExcel } from "./electron/excel-reader";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

async function main() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ sku: "WIDGET-1", qty: 42 }, { sku: "GADGET-2", qty: 7 }]), "Inventory");
  const xlsxPath = path.join(__dirname, "tmp-composer-catalog.xlsx");
  XLSX.writeFile(wb, xlsxPath);

  const project = createBlankProject(1000, 800);
  project.dataSources.push({ id: "cat", name: "Catalog", kind: "excel", uri: xlsxPath });
  project.variables.push({ id: "stock", type: "string", initial: "[]" } as any);

  const btn = createElement("button");
  btn.name = "Load stock";
  btn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "dataQuery", source: "cat", into: "stock", query: "Inventory" } }];
  project.screens[0].elements.push(btn);

  const doc = toIsxDocument(project) as unknown as IsxDoc;
  const v = validateIsx(doc);
  check("Composer-authored Excel query document validates", v.valid, v.errors.join("; "));

  const rt = new IsxRuntime(doc, { readLocalData: (opts) => readExcel(opts.uri, opts.query) });
  await rt.runActions([{ type: "data.query", source: "cat", query: "Inventory", into: "stock" } as any]);

  const rows = rt.variables.stock as any[];
  check("running the Composer-authored action reads the real .xlsx sheet", Array.isArray(rows) && rows.length === 2 && rows[0].sku === "WIDGET-1", JSON.stringify(rows));

  fs.unlinkSync(xlsxPath);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
