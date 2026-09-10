// Round trip for v1.2 Collections: a Carousel container authored via the
// Composer's real factory functions, compiled by its real compiler,
// validated and executed by the Player's real IsxRuntime.
import { createBlankProject, createElement, withTapAction } from "../inspiration-studio/src/renderer/lib/factory";
import { toIsxDocument } from "../inspiration-studio/src/renderer/lib/compile";
import { validateIsx } from "./src/renderer/lib/validate";
import { IsxRuntime, type IsxDoc } from "./src/renderer/lib/runtime";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? "  — " + detail : ""}`); }
}

const project = createBlankProject(1280, 720, "#0b0f14", "Carousel Test");

const carousel = createElement("container");
carousel.name = "Product Carousel";
carousel.rect = { x: 100, y: 100, width: 800, height: 400 };
carousel.props = { fill: "#111111", arrange: "carousel", loop: true };

const slide0 = createElement("shape");
slide0.name = "Slide A";
slide0.props = { kind: "rectangle", fill: "#ff0000" };
const slide1 = createElement("shape");
slide1.name = "Slide B";
slide1.props = { kind: "rectangle", fill: "#00ff00" };
carousel.children = [slide0, slide1];

project.screens[0].elements.push(carousel);

let nextBtn = createElement("button");
nextBtn.name = "Next";
nextBtn.rect = { x: 950, y: 300, width: 100, height: 60 };
nextBtn = withTapAction(nextBtn, { type: "collectionNext", target: carousel.id });
project.screens[0].elements.push(nextBtn);

const doc = toIsxDocument(project) as unknown as IsxDoc;
const v = validateIsx(doc);
check("Composer-authored Carousel document validates against isx.schema.json", v.valid, v.errors.join("; "));

const compiledCarousel = doc.screens[0].elements.find((e: any) => e.id === carousel.id) as any;
check("compiled container carries arrange:carousel and loop:true", compiledCarousel.props.arrange === "carousel" && compiledCarousel.props.loop === true);
check("compiled container has its two children", compiledCarousel.children?.length === 2);

const rt = new IsxRuntime(doc);
rt.startScreenLifecycle();
check("carousel starts at focus index 0", rt.getFocusIndex(carousel.id) === 0);

rt.fireTap(nextBtn.id);
check("tapping the Composer-authored Next button (collectionNext action) advances the carousel", rt.getFocusIndex(carousel.id) === 1);

rt.fireTap(nextBtn.id); // past the end — loop:true should wrap back to 0
check("looping carousel wraps back to index 0 past the last slide", rt.getFocusIndex(carousel.id) === 0);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
