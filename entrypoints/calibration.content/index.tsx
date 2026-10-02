import ReactDOM from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";
import { CalibrationApp } from "./CalibrationApp";
import "@/assets/tokens.css";
import "./style.css";

declare global {
  interface Window {
    // True while an overlay is open; a second injection is a no-op.
    __mangaTrackerCalibrationActive?: boolean;
  }
}

// Injected on demand from the popup ("Calibrar detección"); never registered
// in the manifest. Renders inside a Shadow DOM so the page styles and ours
// cannot leak into each other. NOTE: its CSS must be listed under
// web_accessible_resources with real matches (wxt.config.ts) or the mount
// fails on every site.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (window.__mangaTrackerCalibrationActive) {
      return;
    }
    window.__mangaTrackerCalibrationActive = true;

    try {
      const ui = await createShadowRootUi(ctx, {
        name: "manga-tracker-calibration",
        position: "modal",
        zIndex: 2147483647,
        onMount: (container) => {
          // `modal` pins the container over the whole viewport, and an element
          // there takes every click that was meant for the page — the overlay
          // used to see its own host as the target of each pick and discard
          // it, so calibrating did nothing at all. Transparent to the pointer,
          // with the bar opting back in (style.css).
          container.style.pointerEvents = "none";
          const app = document.createElement("div");
          container.append(app);
          const root = ReactDOM.createRoot(app);
          root.render(
            <CalibrationApp
              onClose={() => {
                window.__mangaTrackerCalibrationActive = false;
                ui.remove();
              }}
            />,
          );
          return root;
        },
        onRemove: (root) => {
          root?.unmount();
        },
      });

      ui.mount();
    } catch (cause) {
      // A silent failure here already bit us once (web_accessible_resources
      // with empty matches) — make any mount error visible in the console.
      window.__mangaTrackerCalibrationActive = false;
      console.error("[manga-tracker] calibration overlay failed", cause);
    }
  },
});
