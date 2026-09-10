export interface StudioBridge {
  saveProject(payload: { path: string | null; contents: string }): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  openProject(): Promise<{ ok: boolean; path?: string; contents?: string; canceled?: boolean }>;
  exportIsx(payload: { suggestedName: string; contents: string }): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  pickAsset(kinds: ("image" | "video" | "pdf")[]): Promise<{ ok: boolean; name?: string; mimeType?: string; data?: string; bytes?: number; canceled?: boolean; error?: string }>;
  onMenu(channel: "menu:new" | "menu:open" | "menu:save" | "menu:save-as" | "menu:export", cb: () => void): () => void;
}

declare global {
  interface Window {
    studio?: StudioBridge;
  }
}
