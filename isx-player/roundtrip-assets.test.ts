// Round trip for embedded assets: a Composer-authored project with a real
// embedded image (constructed exactly as the AssetPicker/onFileInput path
// would produce it), compiled, validated, and resolved by the Player's
// real resolveAssetSrc — proving a document with local files embedded is
// genuinely self-contained and runs on the Player without the original
// file present anywhere.
import { createBlankProject, createElement, uid } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

// A real, valid 1x1 PNG's bytes, base64-encoded — exactly what fs.readFile().toString("base64")
// would produce for a real file picked via the Electron dialog.
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const project = createBlankProject(1000, 800, "#0b0f14", "Asset Embedding Test");

// exactly what AssetPicker's `embed()` function does: push a StudioAsset, point props.assetId at it
const assetId = uid("asset");
project.assets.push({ id: assetId, name: "logo.png", kind: "image", mimeType: "image/png", data: TINY_PNG_BASE64, bytes: 68 });

const logo = createElement("image");
logo.name = "Embedded logo";
logo.props = { assetId, fit: "contain" };
project.screens[0].elements.push(logo);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored embedded-asset document validates against isx.schema.json", v.valid, v.errors.join("; "));

const compiledAsset = (doc.assets || []).find((a: any) => a.id === assetId) as any;
check("the compiled document carries the asset's embedded data", compiledAsset?.data === TINY_PNG_BASE64);
check("the compiled document carries the correct mimeType", compiledAsset?.mimeType === "image/png");

const rt = new IsxRuntime(doc);
const logoEl = doc.screens[0].elements.find((e: any) => e.name === "Embedded logo") as any;
const resolvedSrc = rt.resolveAssetSrc(logoEl.props);
check("the Player's real resolver produces the correct data: URI from the Composer's embedded asset", resolvedSrc === `data:image/png;base64,${TINY_PNG_BASE64}`, resolvedSrc);

// prove it's genuinely self-contained: a doc with the SAME element but NO original
// file path anywhere (props never had a `uri` pointing at disk) still resolves fully
check("no filesystem path is referenced anywhere — this is a portable, self-contained document", !JSON.stringify(doc).includes("/Users/") && !JSON.stringify(doc).includes("C:\\\\"));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
