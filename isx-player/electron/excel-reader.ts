// Real Excel (.xlsx/.xls) support via SheetJS — pure JS, no native
// compilation, same reasoning as sql.js for SQLite: a native reader
// would need per-platform binaries, and we're avoiding that class of
// packaging problem entirely for this project.
//
// Standalone (no Electron dependency) so it's directly testable with
// a real .xlsx file — see roundtrip-excel.test.ts.
import * as XLSX from "xlsx";
import fs from "node:fs/promises";

export interface ExcelQueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

/**
 * Reads `filePath` and converts one sheet to an array of row objects
 * (first row = headers, matching the shape our csv/json readers produce).
 * `sheetName` selects a specific sheet; omitted, uses the first sheet.
 */
export async function readExcel(filePath: string, sheetName?: string): Promise<ExcelQueryResult> {
  try {
    const buf = await fs.readFile(filePath);
    const workbook = XLSX.read(buf, { type: "buffer" });
    const targetName = sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[targetName];
    if (!sheet) {
      return { ok: false, error: `sheet "${targetName}" not found — available sheets: ${workbook.SheetNames.join(", ")}` };
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return { ok: true, rows: rows as Record<string, unknown>[] };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
