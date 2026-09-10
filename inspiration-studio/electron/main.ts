import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  buildMenu();
}

function send(channel: string, ...args: unknown[]) {
  mainWindow?.webContents.send(channel, ...args);
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => send("menu:new") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => send("menu:open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("menu:save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => send("menu:save-as") },
        { type: "separator" },
        { label: "Export .isx…", click: () => send("menu:export") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC: real filesystem access for .isx projects ----------------

ipcMain.handle("project:save", async (_evt, payload: { path: string | null; contents: string }) => {
  let targetPath = payload.path;
  if (!targetPath) {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Inspiration Studio Project",
      defaultPath: "untitled.isxproj",
      filters: [{ name: "Inspiration Studio Project", extensions: ["isxproj"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    targetPath = result.filePath;
  }
  await fs.writeFile(targetPath, payload.contents, "utf-8");
  return { ok: true, path: targetPath };
});

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Open Inspiration Studio Project",
    filters: [{ name: "Inspiration Studio Project", extensions: ["isxproj"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const contents = await fs.readFile(result.filePaths[0], "utf-8");
  return { ok: true, path: result.filePaths[0], contents };
});

ipcMain.handle("project:export-isx", async (_evt, payload: { suggestedName: string; contents: string }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Export .isx",
    defaultPath: payload.suggestedName,
    filters: [{ name: "Inspiration Studio Experience", extensions: ["isx"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.writeFile(result.filePath, payload.contents, "utf-8");
  return { ok: true, path: result.filePath };
});

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

// Real, local file picker for images/video/PDF assets. Reads and
// base64-encodes the file so it can be EMBEDDED directly in the .isx
// document (see the schema's `asset.data` field) — the resulting project
// is fully self-contained and portable; the original file on disk is
// never referenced again once embedded.
ipcMain.handle("project:pick-asset", async (_evt, kinds: ("image" | "video" | "pdf")[]) => {
  const extsByKind: Record<string, string[]> = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
    video: ["mp4", "webm", "mov"],
    pdf: ["pdf"],
  };
  const extensions = kinds.flatMap((k) => extsByKind[k] || []);
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Choose a file to embed",
    filters: [{ name: "Supported files", extensions }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || "application/octet-stream";
    return {
      ok: true,
      name: path.basename(filePath),
      mimeType,
      data: buf.toString("base64"),
      bytes: buf.length,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
