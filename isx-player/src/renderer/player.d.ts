export interface PlayerBridge {
  openDialog(): Promise<{ ok: boolean; path?: string; contents?: string; canceled?: boolean }>;
  readPath(filePath: string): Promise<{ ok: boolean; path?: string; contents?: string; error?: string }>;
  httpFetch(opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ ok: boolean; status?: number; json?: unknown; text?: string; error?: string }>;
  readLocalData(opts: { kind: string; uri: string; basePath?: string | null; query?: string }): Promise<{ ok: boolean; rows?: unknown[]; error?: string }>;
  onMenu(channel: "menu:open" | "menu:sample" | "menu:reload", cb: () => void): () => void;
  onOpenFile(cb: (payload: { path: string; contents: string }) => void): () => void;
  onRemoteAction(cb: (actions: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    player?: PlayerBridge;
  }
}
