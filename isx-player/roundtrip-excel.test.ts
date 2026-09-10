// Real Excel round trip: creates an ACTUAL .xlsx file on disk (using
// SheetJS to build it), then reads it back through our real readExcel()
// reader — the same function the Electron main process calls.
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExcel } from "./electron/excel-reader";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { validateIsx } from "./src/renderer/lib/validate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

async function main() {
  // 1. Build a REAL .xlsx file with two sheets.
  const wb = XLSX.utils.book_new();
  const productsSheet = XLSX.utils.json_to_sheet([
    { name: "Alpha Widget", price: 19.99, inStock: true },
    { name: "Bravo Gadget", price: 45.5, inStock: false },
  ]);
  const staffSheet = XLSX.utils.json_to_sheet([{ name: "Melvyn", role: "Founder" }]);
  XLSX.utils.book_append_sheet(wb, productsSheet, "Products");
  XLSX.utils.book_append_sheet(wb, staffSheet, "Staff");
  const xlsxPath = path.join(__dirname, "tmp-catalog.xlsx");
  XLSX.writeFile(wb, xlsxPath);
  check("a real .xlsx file was written to disk", fs.existsSync(xlsxPath));

  // 2. Read it back through the REAL reader.
  const first = await readExcel(xlsxPath); // no sheet name -> first sheet
  check("readExcel with no sheet name reads the first sheet", first.ok && first.rows?.length === 2, JSON.stringify(first));
  check("values are correctly typed (price is a number)", typeof first.rows?.[0]?.price === "number" && first.rows[0].price === 19.99);
  check("boolean values round-trip correctly", first.rows?.[0]?.inStock === true);

  const named = await readExcel(xlsxPath, "Staff");
  check("readExcel with an explicit sheet name reads that sheet", named.ok && named.rows?.length === 1 && named.rows[0].role === "Founder", JSON.stringify(named));

  const missing = await readExcel(xlsxPath, "DoesNotExist");
  check("an unknown sheet name gives a clear error listing the real sheet names", !missing.ok && missing.error!.includes("Products") && missing.error!.includes("Staff"), missing.error);

  const badFile = await readExcel(path.join(__dirname, "nope.xlsx"));
  check("a missing file produces a clear error, not a crash", !badFile.ok);

  // 3. Full loop through the runtime.
  const doc: IsxDoc = {
    format: "isx", schemaVersion: "1.7",
    meta: { id: "excel-test", name: "Excel test" },
    stage: { width: 800, height: 600 }, entryScreen: "s1",
    dataSources: [{ id: "catalog", kind: "excel", uri: xlsxPath }],
    screens: [{ id: "s1", elements: [] }],
    variables: [{ id: "rows", type: "array", initial: [] }],
  } as unknown as IsxDoc;
  const v = validateIsx(doc);
  check("the excel dataSource document validates against isx.schema.json", v.valid, v.errors.join("; "));

  const rt = new IsxRuntime(doc, {
    readLocalData: async (opts) => (opts.kind === "excel" ? readExcel(opts.uri, opts.query) : { ok: false, error: "unsupported" }),
  });
  await rt.runActions([{ type: "data.query", source: "catalog", query: "Staff", into: "rows" } as any]);
  check("the runtime's data.query action reads a real Excel sheet end-to-end, honoring the sheet-name query", (rt.variables.rows as any[])?.[0]?.name === "Melvyn", JSON.stringify(rt.variables.rows));

  fs.unlinkSync(xlsxPath);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
