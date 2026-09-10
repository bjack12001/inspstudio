// Real end-to-end network test for remote/cross-experience actions: an
// actual TCP listener (the same code the Electron main process runs),
// an actual HTTP POST (Node's real global fetch, the same shape the
// runtime's httpFetch callback produces), and TWO real IsxRuntime
// instances — a "controller" that sends, and a "display" that receives
// and executes the remote command against its OWN document. Nothing
// here is mocked.
import { startRemoteListener } from "./electron/remote-listener";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";
import { validateIsx } from "./src/renderer/lib/validate";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

// The "display" Player's own document — entirely separate from the controller's.
const displayDoc: IsxDoc = {
  format: "isx", schemaVersion: "1.6",
  meta: { id: "display", name: "Display Screen" },
  stage: { width: 1920, height: 1080 },
  entryScreen: "idle",
  screens: [
    { id: "idle", elements: [] },
    { id: "productDetail", elements: [] },
  ],
  variables: [{ id: "syncedFrom", type: "string", initial: "" }],
} as unknown as IsxDoc;

// The "controller" Player's document, with a remoteEndpoint pointing at wherever
// the display's listener actually ends up bound (assigned dynamically below).
async function main() {
  const displayRuntime = new IsxRuntime(displayDoc);
  check("display starts on its idle screen", displayRuntime.screenId === "idle");

  // Real TCP listener — identical code path to what Electron's main process runs.
  const listener = await startRemoteListener(0, (actions) => { // port 0 = OS picks a free port
    void displayRuntime.runActions(actions as any);
  });
  check("the real listener bound to an actual port", listener.port > 0, `port=${listener.port}`);

  const controllerDoc: IsxDoc = {
    format: "isx", schemaVersion: "1.6",
    meta: { id: "controller", name: "Controller" },
    stage: { width: 800, height: 480 },
    entryScreen: "s1",
    remoteEndpoints: [{ id: "display", name: "Display Screen", host: "127.0.0.1", port: listener.port }],
    screens: [{
      id: "s1",
      elements: [{
        id: "syncBtn", type: "button", layout: { x: 0, y: 0, width: 200, height: 60 }, props: { label: "Sync displays" },
        events: [{ on: "tap", do: [{ type: "remote.send", target: "display", do: [
          { type: "navigate", screen: "productDetail" },
          { type: "setVariable", variable: "syncedFrom", to: { value: "controller" } },
        ] }] }],
      }],
    }],
  } as unknown as IsxDoc;

  const v = validateIsx(controllerDoc);
  check("the controller's document (with the dynamically-assigned port) validates", v.valid, v.errors.join("; "));

  // Real fetch, exactly what the Player's httpFetch callback does under the hood.
  const controllerRuntime = new IsxRuntime(controllerDoc, {
    httpFetch: async (opts) => {
      try {
        const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
  });

  check("display has NOT changed screens yet (no message sent)", displayRuntime.screenId === "idle");
  controllerRuntime.fireTap("syncBtn");
  await new Promise((r) => setTimeout(r, 150)); // real network round trip needs a moment

  check("the REMOTE display Player navigated to the screen the controller told it to", displayRuntime.screenId === "productDetail", `display is on: ${displayRuntime.screenId}`);
  check("the REMOTE display Player's own variable was set by the controller's remote action", displayRuntime.variables.syncedFrom === "controller", `value: ${displayRuntime.variables.syncedFrom}`);

  await listener.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
