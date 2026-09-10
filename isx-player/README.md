# ISX Player

Reference runtime that loads and executes `.isx` v1.0 documents.
Electron + React + TypeScript, same stack and project shape as
Inspiration Studio (the Composer), so the two are easy to work on
side by side.

## Run from source
```bash
npm install
npm run dev            # terminal 1: Vite dev server on :5174
npm run electron:dev   # terminal 2
```

## Run the headless engine tests
```bash
npm test
```
20 checks: the expression evaluator, schema validation of the
bundled sample, and every Tier-1 action (`setVariable`,
`toggleVisibility`, `navigate`, `if`/`else`, `delay`, device-event
dispatch), all run with no DOM/React involved.

## Architecture note
`src/renderer/lib/runtime.ts` (`IsxRuntime`) is a plain TypeScript
class with no rendering code — it holds variables, per-element
visibility/prop overrides, and executes the action grammar. `App.tsx`
is a thin React shell that subscribes to it and draws elements. This
split is deliberate: the same `IsxRuntime` class is what the eventual
standalone compiler will embed, and it's why the engine could be unit
-tested before any pixel was drawn.

`src/renderer/lib/expr.ts` is a real tokenizer + parser + evaluator
for the schema's expression strings (bindings, `to: { expr }`, `when`
guards) — no `eval`/`new Function` involved for expressions. `Tier-2`
`script` actions do use `new Function` deliberately, per the schema's
sandboxed-JS-override design; a script that throws disables further
scripts for that session rather than crashing the app.

## What's real
- Opening a `.isx` file (native OS dialog via Electron, or drag-drop
  / file picker in browser-dev mode) and running it live.
- Schema validation on load — a document that doesn't validate is
  shown with its errors and never executed.
- The full render pipeline: text/button/shape/container/image/dataList,
  design-space scaling, z-order, bindings.
- Real navigation between multiple screens, timers, `if`/`else`,
  `delay`, and simulated hardware buttons that fire real `device`
  events into the document's own event handlers.
- `http.request` / `data.query` (kind: `rest`) perform a **real**
  fetch — from the Electron main process when running as the desktop
  app (avoids renderer CSP/CORS surprises), or via `window.fetch` in
  browser-dev mode.

## What's still ahead
- Local data sources (`sqlite`/`csv`/`excel`/`json`) need a
  filesystem reader in the main process — currently a no-op.
- `data.write`, `device.send` (real serial/websocket I/O), and
  `media` need real hardware/OS integration.
- Responsive anchors/sizing (the schema's Hybrid Canvas Core) render
  using the base rect only for now; anchor-aware layout is next.
- Packaging: `release/` portable Windows/Mac builds are unsigned —
  see the note in chat about why signed installers need to be built
  on native Windows/Mac hosts (or CI).
