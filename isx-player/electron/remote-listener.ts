// Standalone remote-action listener — plain Node `http`, no Electron
// dependency, so it's directly testable with real network calls (see
// roundtrip-remote.test.ts) and reusable from the Electron main process.
//
// Protocol: POST /remote-action with a JSON body { do: Action[] }.
// Anything else gets 404/400. On success, calls onCommand(actions) and
// responds 200 with {ok:true}; if onCommand throws, responds 500.
import http from "node:http";

export interface RemoteListenerHandle {
  port: number;
  close: () => Promise<void>;
}

export function startRemoteListener(port: number, onCommand: (actions: unknown[]) => void): Promise<RemoteListenerHandle> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/remote-action") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "not found" }));
        return;
      }
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          if (!Array.isArray(parsed.do)) throw new Error('body must be { "do": Action[] }');
          onCommand(parsed.do);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
    });
    server.on("error", reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
