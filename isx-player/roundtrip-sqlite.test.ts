// Real SQLite round trip: creates an ACTUAL .db file on disk (using
// sql.js to build it, exactly how a real SQLite file would be produced),
// then reads it back through our real querySqlite() reader — the same
// function the Electron main process calls. Nothing here is mocked.
import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { querySqlite } from "./electron/sqlite-reader";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { validateIsx } from "./src/renderer/lib/validate";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

async function main() {
  // 1. Build a REAL .db file with actual tables and rows.
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm")) });
  const db = new SQL.Database();
  db.run("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, in_stock INTEGER)");
  db.run("INSERT INTO products (name, price, in_stock) VALUES (?, ?, ?)", ["Alpha Widget", 19.99, 1]);
  db.run("INSERT INTO products (name, price, in_stock) VALUES (?, ?, ?)", ["Bravo Gadget", 45.5, 0]);
  const dbPath = path.join(__dirname, "tmp-inventory.db");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  check("a real .db file was written to disk", fs.existsSync(dbPath));

  // 2. Read it back through the REAL reader.
  const all = await querySqlite(dbPath, "SELECT * FROM products ORDER BY id");
  check("querySqlite reads the real file and returns real rows", all.ok && all.rows?.length === 2, JSON.stringify(all));
  check("row values are correctly typed (price is a number)", typeof all.rows?.[0]?.price === "number" && all.rows[0].price === 19.99);
  check("column names match the table schema", Object.keys(all.rows?.[0] || {}).sort().join(",") === "id,in_stock,name,price");

  const filtered = await querySqlite(dbPath, "SELECT name, price FROM products WHERE in_stock = 1");
  check("an arbitrary WHERE-clause query works, not just SELECT *", filtered.ok && filtered.rows?.length === 1 && filtered.rows[0].name === "Alpha Widget", JSON.stringify(filtered));

  const missingQuery = await querySqlite(dbPath, "");
  check("querying with no query string is a clear error, not empty-success", !missingQuery.ok && !!missingQuery.error, JSON.stringify(missingQuery));

  const badPath = await querySqlite(path.join(__dirname, "does-not-exist.db"), "SELECT 1");
  check("a missing file produces a clear error, not a crash", !badPath.ok, JSON.stringify(badPath));

  const badSql = await querySqlite(dbPath, "SELECT * FROM nonexistent_table");
  check("invalid SQL produces a clear error", !badSql.ok && badSql.error!.length > 0, JSON.stringify(badSql));

  // 3. Full loop through the runtime, exactly as a real .isx document would use it.
  const doc: IsxDoc = {
    format: "isx", schemaVersion: "1.7",
    meta: { id: "sqlite-test", name: "SQLite test" },
    stage: { width: 800, height: 600 }, entryScreen: "s1",
    dataSources: [{ id: "inventory", kind: "sqlite", uri: dbPath }],
    screens: [{ id: "s1", elements: [] }],
    variables: [{ id: "rows", type: "array", initial: [] }],
  } as unknown as IsxDoc;
  const v = validateIsx(doc);
  check("the sqlite dataSource document validates against isx.schema.json", v.valid, v.errors.join("; "));

  const rt = new IsxRuntime(doc, {
    readLocalData: async (opts) => {
      if (opts.kind !== "sqlite") return { ok: false, error: "unsupported in this test" };
      return querySqlite(opts.uri, (opts as any).query || "");
    },
  });
  await rt.runActions([{ type: "data.query", source: "inventory", query: "SELECT * FROM products", into: "rows" } as any]);
  check("the runtime's data.query action runs a real SQL query end-to-end", (rt.variables.rows as any[])?.length === 2, JSON.stringify(rt.variables.rows));

  fs.unlinkSync(dbPath);
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
