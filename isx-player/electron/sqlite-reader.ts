// Real SQLite support via sql.js (WASM) — deliberately NOT a native
// binary. A native SQLite driver would need per-platform compiled
// binaries, and we already hit real packaging friction with native
// tooling (Wine/cross-compile) earlier in this project; a WASM engine
// runs identically on Windows/Mac/Linux with zero native compilation,
// which matters a lot for an app we build once and ship to both.
//
// Standalone (no Electron dependency) so it's directly testable with
// a real .db file — see roundtrip-sqlite.test.ts.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
      const wasmBuffer = await fs.readFile(wasmPath);
      const wasmBinary = wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength) as ArrayBuffer;
      return initSqlJs({ wasmBinary });
    })();
  }
  return sqlJsPromise;
}

export interface SqliteQueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

/** Opens the .db file at `dbPath` and runs `query` against it, returning rows as plain objects. */
export async function querySqlite(dbPath: string, query: string): Promise<SqliteQueryResult> {
  if (!query || !query.trim()) return { ok: false, error: "sqlite data sources require a query (dataSource.query on the action)" };
  let db: any = null;
  try {
    const SQL = await getSqlJs();
    const fileBuffer = await fs.readFile(dbPath);
    db = new SQL.Database(fileBuffer);
    const results = db.exec(query);
    if (results.length === 0) return { ok: true, rows: [] };
    const { columns, values } = results[0];
    const rows = values.map((row: unknown[]) => Object.fromEntries(columns.map((c: string, i: number) => [c, row[i]])));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    db?.close();
  }
}
