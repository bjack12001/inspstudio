// Full loop: a Composer-authored SQLite data source + query action
// (using the real Composer factory/compile functions), validated, and
// run against a REAL .db file through the real querySqlite reader.
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { querySqlite } from "./electron/sqlite-reader";
import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

async function main() {
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) });
  const db = new SQL.Database();
  db.run("CREATE TABLE inventory (sku TEXT, qty INTEGER)");
  db.run("INSERT INTO inventory VALUES ('WIDGET-1', 42)");
  db.run("INSERT INTO inventory VALUES ('GADGET-2', 7)");
  const dbPath = path.join(__dirname, "tmp-composer-inventory.db");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  const project = createBlankProject(1000, 800);
  project.dataSources.push({ id: "inv", name: "Inventory DB", kind: "sqlite", uri: dbPath });
  project.variables.push({ id: "stock", type: "string", initial: "[]" } as any);

  const btn = createElement("button");
  btn.name = "Load stock";
  btn.events = [{ id: uid("evt"), trigger: "tap", action: { type: "dataQuery", source: "inv", into: "stock", query: "SELECT * FROM inventory WHERE qty > 10" } }];
  project.screens[0].elements.push(btn);

  const doc = toIsxDocument(project) as unknown as IsxDoc;
  const v = validateIsx(doc);
  check("Composer-authored SQLite query document validates", v.valid, v.errors.join("; "));

  const compiledAction = (doc.screens[0].elements[0] as any).events[0].do[0];
  check("compiled action carries the exact SQL query", compiledAction.query === "SELECT * FROM inventory WHERE qty > 10");

  const rt = new IsxRuntime(doc, { readLocalData: (opts) => querySqlite(opts.uri, opts.query || "") });
  rt.fireTap(btn.id);
  // sql.js's WASM module compiles on first use, which can take longer than a
  // fixed short wait under load — poll instead of guessing a single timeout.
  let rows: any[] = [];
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    rows = rt.variables.stock as any[];
    if (Array.isArray(rows) && rows.length > 0) break;
  }
  check("tapping the Composer-authored button runs the real SQL query against the real .db file", Array.isArray(rows) && rows.length === 1 && rows[0].sku === "WIDGET-1", JSON.stringify(rows));

  fs.unlinkSync(dbPath);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
