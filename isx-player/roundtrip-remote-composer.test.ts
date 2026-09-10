// Full loop for remote actions, authored end-to-end: a Composer-authored
// remoteEndpoint + remoteSend action (using the Composer's REAL factory/
// compile functions), validated, then driven over a REAL TCP connection
// to a second, independent IsxRuntime — proving the whole chain from
// "click Add remote endpoint in the UI" to "another physical Player
// reacts" actually holds together.
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { startRemoteListener } from "./electron/remote-listener";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

async function main() {
  // The "display" Player — a completely separate document.
  const displayProject = createBlankProject(1920, 1080, "#000000", "Display Screen");
  displayProject.screens.push({ id: "productDetail", name: "Product Detail", background: "#111", elements: [] });
  const displayDoc = toIsxDocument(displayProject) as unknown as IsxDoc;
  const displayRuntime = new IsxRuntime(displayDoc);
  check("display starts on its entry screen", displayRuntime.screenId === "home");

  const listener = await startRemoteListener(0, (actions) => { void displayRuntime.runActions(actions as any); });

  // Author the controller project EXACTLY as the Composer UI would:
  // RemoteEndpointsEditor's "+ Add remote endpoint" then editing host/port,
  // then a button's EventsEditor -> ActionEditor -> "remoteSend".
  const controllerProject = createBlankProject(800, 480, "#0b0f14", "Controller");
  controllerProject.remoteEndpoints.push({ id: uid("remote"), name: "Display Screen", host: "127.0.0.1", port: listener.port });
  const remoteId = controllerProject.remoteEndpoints[0].id;

  const syncBtn = createElement("button");
  syncBtn.name = "Sync displays";
  syncBtn.events = [{
    id: uid("evt"), trigger: "tap",
    action: { type: "remoteSend", target: remoteId, action: { type: "navigate", screen: "productDetail" } },
  }];
  controllerProject.screens[0].elements.push(syncBtn);

  const controllerDoc = toIsxDocument(controllerProject) as unknown as IsxDoc;
  const v = validateIsx(controllerDoc);
  check("the Composer-authored controller document validates", v.valid, v.errors.join("; "));

  const compiledEvent = (controllerDoc.screens[0].elements[0] as any).events[0];
  check("the compiled event carries a remote.send action targeting the right endpoint", compiledEvent.do[0].type === "remote.send" && compiledEvent.do[0].target === remoteId);
  check("the compiled remote.send nests the navigate action to run on the remote", compiledEvent.do[0].do[0].type === "navigate" && compiledEvent.do[0].do[0].screen === "productDetail");

  const controllerRuntime = new IsxRuntime(controllerDoc, {
    httpFetch: async (opts) => {
      try {
        const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
        return { ok: res.ok, status: res.status };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  });

  check("display has not navigated yet", displayRuntime.screenId === "home");
  controllerRuntime.fireTap(syncBtn.id);
  await new Promise((r) => setTimeout(r, 150));

  check("tapping the Composer-authored button drove the REMOTE Player, over a real socket, to navigate", displayRuntime.screenId === "productDetail", `display is on: ${displayRuntime.screenId}`);

  await listener.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  if (fail > 0) process.exit(1);
}
main();
