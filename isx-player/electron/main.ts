import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startRemoteListener } from "./remote-listener.js";
import { querySqlite } from "./sqlite-reader.js";
import { readExcel } from "./excel-reader.js";
import Papa from "papaparse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let pendingOpenPath: string | null = null; // file passed via CLI arg or OS "open with"

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5174");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.once("did-finish-load", () => {
    if (pendingOpenPath) sendOpenPath(pendingOpenPath);
  });

  buildMenu();
}

function send(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args);
}

async function sendOpenPath(filePath: string) {
  try {
    const contents = await fs.readFile(filePath, "utf-8");
    send("player:open-file", { path: filePath, contents });
  } catch {
    send("player:open-error", { path: filePath });
  }
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Open .isx…", accelerator: "CmdOrCtrl+O", click: () => send("menu:open") },
        { label: "Load Bundled Sample", click: () => send("menu:sample") },
        { label: "Reload Document", accelerator: "CmdOrCtrl+R", click: () => send("menu:reload") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("isx:open-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Open .isx document",
    filters: [{ name: "ISX Document", extensions: ["isx", "json"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const contents = await fs.readFile(result.filePaths[0], "utf-8");
  return { ok: true, path: result.filePaths[0], contents };
});

ipcMain.handle("isx:read-path", async (_evt, filePath: string) => {
  try {
    const contents = await fs.readFile(filePath, "utf-8");
    return { ok: true, path: filePath, contents };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Real HTTP fetch performed in the main process (not sandboxed by renderer CSP),
// used by the runtime's http.request / data.query(rest) actions.
ipcMain.handle("isx:http-fetch", async (_evt, opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }) => {
  try {
    const res = await fetch(opts.url, {
      method: opts.method || "GET",
      headers: opts.headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Real local data source reads for the runtime's data.query action.
// Resolves the dataSource's uri relative to the currently open .isx file's
// directory when it's a relative path, matching the schema's documented
// "relative paths resolve against the project workspace" behavior.
ipcMain.handle("isx:read-local-data", async (_evt, opts: { kind: string; uri: string; basePath?: string | null; query?: string }) => {
  try {
    const resolved = path.isAbsolute(opts.uri) || !opts.basePath
      ? opts.uri
      : path.resolve(path.dirname(opts.basePath), opts.uri);

    if (opts.kind === "json") {
      const text = await fs.readFile(resolved, "utf-8");
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return { ok: true, rows };
    }

    if (opts.kind === "csv") {
      const text = await fs.readFile(resolved, "utf-8");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      if (result.errors?.length) return { ok: false, error: result.errors.map((e) => e.message).join("; ") };
      return { ok: true, rows: result.data };
    }

    if (opts.kind === "sqlite") {
      return await querySqlite(resolved, opts.query || "");
    }

    if (opts.kind === "excel") {
      return await readExcel(resolved, opts.query);
    }

    return { ok: false, error: `unknown local data source kind: ${opts.kind}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// support `electron . /path/to/file.isx` and double-click/"Open with" on the OS
const argPath = process.argv.find((a) => a.endsWith(".isx") || a.endsWith(".json"));
if (argPath) pendingOpenPath = argPath;
app.on("open-file", (e, filePath) => {
  e.preventDefault();
  pendingOpenPath = filePath;
  if (mainWindow) sendOpenPath(filePath);
});

app.whenReady().then(async () => {
  createWindow();
  try {
    const listener = await startRemoteListener(9494, (actions) => {
      mainWindow?.webContents.send("remote:incoming", actions);
    });
    console.log(`Remote-action listener on port ${listener.port}`);
  } catch (e) {
    console.error("Could not start remote-action listener (port may be in use):", e);
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
