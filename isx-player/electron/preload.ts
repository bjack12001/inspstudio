import { contextBridge, ipcRenderer } from "electron";

export interface PlayerBridge {
  openDialog(): Promise<{ ok: boolean; path?: string; contents?: string; canceled?: boolean }>;
  readPath(filePath: string): Promise<{ ok: boolean; path?: string; contents?: string; error?: string }>;
  httpFetch(opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ ok: boolean; status?: number; json?: unknown; text?: string; error?: string }>;
  readLocalData(opts: { kind: string; uri: string; basePath?: string | null; query?: string }): Promise<{ ok: boolean; rows?: unknown[]; error?: string }>;
  onMenu(channel: "menu:open" | "menu:sample" | "menu:reload", cb: () => void): () => void;
  onOpenFile(cb: (payload: { path: string; contents: string }) => void): () => void;
  onRemoteAction(cb: (actions: unknown[]) => void): () => void;
}

const bridge: PlayerBridge = {
  openDialog: () => ipcRenderer.invoke("isx:open-dialog"),
  readPath: (filePath) => ipcRenderer.invoke("isx:read-path", filePath),
  httpFetch: (opts) => ipcRenderer.invoke("isx:http-fetch", opts),
  readLocalData: (opts) => ipcRenderer.invoke("isx:read-local-data", opts),
  onMenu: (channel, cb) => {
    const l = () => cb();
    ipcRenderer.on(channel, l);
    return () => ipcRenderer.removeListener(channel, l);
  },
  onOpenFile: (cb) => {
    const l = (_e: unknown, payload: { path: string; contents: string }) => cb(payload);
    ipcRenderer.on("player:open-file", l);
    return () => ipcRenderer.removeListener("player:open-file", l);
  },
  onRemoteAction: (cb) => {
    const l = (_e: unknown, actions: unknown[]) => cb(actions);
    ipcRenderer.on("remote:incoming", l);
    return () => ipcRenderer.removeListener("remote:incoming", l);
  },
};

contextBridge.exposeInMainWorld("player", bridge);

declare global {
  interface Window {
    player?: PlayerBridge;
  }
}
