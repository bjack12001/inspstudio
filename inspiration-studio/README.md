# Inspiration Studio — Composer

Desktop authoring tool (Electron + React + TypeScript) for `.isx` projects.
This is the first real, compiling milestone of the Composer — not a browser
mockup. It builds, typechecks, and its exporter validates its own output
against the canonical `isx.schema.json` before writing anything to disk.

## Requirements
- Node.js 18+ and npm

## Setup
```bash
npm install
```

## Run in development (hot reload)
Two terminals:
```bash
npm run dev            # terminal 1: Vite dev server on :5173
npm run electron:dev   # terminal 2: builds once, then launches Electron pointed at :5173
```

## Production build
```bash
npm run build           # typecheck renderer + electron, then bundle with Vite
npm run electron:build  # the above, then package a native app via electron-builder
```

## What's real right now
- Native window, menu (File → New/Open/Save/Save As/Export .isx), and
  real OS save/open dialogs via Electron IPC (`electron/main.ts`,
  `electron/preload.ts`) — no browser download links.
- A working canvas: drag, resize, multi-screen, an inspector, layers,
  and a live `.isx` preview tab.
- A real compiler (`src/renderer/lib/compile.ts`) from the authoring
  model to schema-1.0-shaped JSON.
- Real validation (`src/renderer/lib/validate.ts`) using Ajv against
  the actual `isx.schema.json` bundled in `src/renderer/schema/` —
  the same file the Player and compiler runtimes will trust. Export
  is blocked if the document doesn't validate.
- `.isxproj` (the Studio's own editable project file, includes
  authoring metadata) vs `.isx` (the compiled, runtime-facing
  document) are kept distinct, matching the architecture doc.

## What's still ahead
- Data sources, hardware bindings, and the full action/event grammar
  in the UI (the schema already supports them; the authoring surface
  doesn't expose them yet).
- Responsive anchors/sizing in the inspector (schema supports them;
  UI is absolute-only for now).
- The Player and standalone compiler runtimes themselves — this
  project only authors and exports `.isx`; it doesn't execute one.
