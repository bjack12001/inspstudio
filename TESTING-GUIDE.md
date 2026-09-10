# Inspiration Studio & ISX Player — Testing Guide

Everything below has passed 296 automated tests and both apps build clean, but
automated tests aren't the same as you clicking around. This is a map of what
to try and where to expect rough edges.

## Getting started

Unzip and run the portable builds — no install wizard needed, just double-click
the `.exe` (Windows) or the `.app` (Mac, right-click → Open the first time,
since it's unsigned):

- `InspirationStudio-win64-portable.zip` / `InspirationStudio-mac-x64.app.zip` — the Composer
- `ISXPlayer-win64-portable.zip` / `ISXPlayer-mac-x64.app.zip` — the Player

Source is also included (`inspiration-studio-source.zip`, `isx-player-source.zip`)
if you want to `npm install` and run from source, or read the code.

**The core loop to try first:** build something in the Composer → File → Export
.isx → open that file in the Player. That round trip is what everything below
hangs off of.

---

## 1. Basic authoring (Composer)

- New Project → pick a resolution preset (or custom) → the canvas should match.
- Add text/button/shape/image/video/pdf elements from the left rail.
- Drag/resize in Edit mode; switch to Preview to see bindings/actions run live
  (Composer's Preview is a lightweight simulation — the Player is authoritative
  for anything beyond basic tap/toggle/navigate).
- Layers tab shows the real element tree, including nested container children.
- .isx tab shows the live compiled document and a schema-valid/invalid badge.

## 2. Container states (Free/Pinnable elements)

- Select any element → Container behavior → set Mode to Free.
- **In the Player**, drag it around, resize via the corner handle, rotate via
  the top handle. Try Maximize/Minimize buttons if you enabled them.
- Try min/max width/height constraints.

## 3. Collections — the biggest feature area

All of these are containers with Layout set to something other than Free, in
the Inspector's "Layout" dropdown:

- **Grid** — children wrap into columns.
- **Carousel** — one child at a time, prev/next arrows + dots, or wire a
  button's action to Next/Previous/Scroll to index.
- **Swap** — same as Carousel but pick a transition (Fade/Slide/Flip) — the
  flip especially is worth seeing in the real Player (3D rotation).
- **Slide Show** — auto-advances on a timer with a Ken Burns pan/zoom effect.
  Try authoring a Pause/Resume button.
- **Item Picker** — a horizontal strip, focused item centered, neighbors
  peeking. **Drag it** in the Player — it should follow your finger/cursor and
  snap to the next/previous item.
- **Map** — needs a background image (Choose file… in the Layout section) and
  each child needs Map X/Y (0-1) set in its own "Collection position" section.
  In the Player: **drag to pan, scroll wheel to zoom**, +/− buttons too. The
  marker should track correctly under zoom (it's meant to stay put — only
  panning should move it under your cursor).
- **Timeline** — each child needs a Date set. In the Player: **drag
  horizontally to scrub** through time.

For all of these, a button's action can target the collection: Next item,
Previous item, Scroll to index, Pan/Zoom map, Scroll timeline to date,
Pause/Resume slideshow.

## 4. Events — any trigger, on any element

Every element (not just buttons) has an "Events" section in the Inspector.
Worth trying specifically because these were structural gaps before this
session:

- **Long press** on a shape (hold ~500ms).
- **Swipe** (fast short drag) — pick a direction or "any."
- **Double tap** vs a single tap — should not both fire.
- If the element is Free/Pinnable: **drag-drop** triggers (Is dropped on /
  Is dragged over / Is dragged away from) — set a target zone and drag an
  element onto/off of it.
- **Pinch/rotate** (two-finger, needs an actual touchscreen or trackpad
  gesture simulation — harder to test with just a mouse).

## 5. Text input + the virtual keyboard

- Add an Input element, bind it to a variable, bind some Text element's
  content to that variable via an expression.
- **In the Player**, tap into the field — the on-screen keyboard should
  appear automatically, and disappear on blur.
- Toggle "⌨ Keyboard" off in the Player's top bar and confirm it stays hidden.
- Try Number/Email/Password/Multiline modes — the keyboard layout should
  change accordingly.

## 6. Bindings & converters (no-code formulas)

On a text/button label's binding field, use "+ Insert converter" to build up
an expression without typing — try stacking two (e.g. uppercase, then wrap in
a date format) and confirm it composes correctly in the Player.

## 7. Data sources — CSV, JSON, REST, SQLite, Excel

Data tab → add a source of each kind, then wire a button's action to
"Query a data source into a variable":

- **CSV/JSON**: point at a real local file.
- **SQLite**: point at a real `.db` file, put a real SQL query (e.g.
  `SELECT * FROM table WHERE ...`) in the action's query field.
- **Excel**: point at a real `.xlsx`, optionally name a sheet in the query field.
- **REST**: a real URL.

All five should show up as an array of row objects in the bound variable —
try displaying `data.length` or similar via a text binding.

## 8. Embedded assets (images/video/PDF)

- Image/Video/PDF elements → "Choose file…" and pick a real local file.
- Export the `.isx` and check the file is genuinely bigger (the asset is
  base64-embedded). Move the `.isx` to a folder with none of the original
  files present and confirm the Player still renders it correctly — that's
  the whole point of embedding.

## 9. Remote actions (two Players talking to each other)

This one needs **two Player instances running** (two windows, or two
machines on the same network):

- In one project, Data tab → add a Remote Endpoint pointing at
  `127.0.0.1:9494` (or the other machine's real IP) — 9494 is the default
  listening port.
- Wire a button to "Send an action to a remote Player" → pick the endpoint →
  pick an action (e.g. Navigate).
- Tap the button in Player A; Player B should react.

## 10. Known, honest gaps — don't file these as bugs, they're documented scope cuts

- **SQLite/Excel are read-only** — no write-back actions yet.
- **Map uses an authored background image, not live map tiles** — no
  geocoding/real-world map service integration.
- **Circular Panel and Helix collection types were explicitly skipped** per
  your instruction.
- **Snapshot/sharing and drawing tools are not built yet** — next on the list.
- **No signed installers** — both apps are unsigned (see the earlier note on
  Windows SmartScreen / macOS Gatekeeper warnings on first launch).
- **No Player settings UI yet** for things like the remote-listener port —
  it's hardcoded to 9494.
- Composer's own Preview mode is intentionally lightweight for the newer
  features (drag-manipulation, pinch, drag-drop zones) — the **Player is
  authoritative** for verifying real runtime behavior on all of these.

---

## If something's broken

The most useful bug report is: what you did, what you expected, what actually
happened, and — if the Player is involved — anything shown via View → Toggle
DevTools (Electron's dev tools) in the console. Since this is genuinely a lot
of new surface area, a consolidated list whenever you're ready is exactly
right — no need to report one at a time.
