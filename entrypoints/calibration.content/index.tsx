import ReactDOM from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";
import { CalibrationApp } from "./CalibrationApp";
import "./style.css";

declare global {
  interface Window {
    // True while an overlay is open; a second injection is a no-op.
    __mangaTrackerCalibrationActive?: boolean;
  }
}

// Injected on demand from the popup ("Calibrar detección"); never registered
// in the manifest. Renders inside a Shadow DOM so the page styles and ours
// cannot leak into each other.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (window.__mangaTrackerCalibrationActive) {
      return;
    }
    window.__mangaTrackerCalibrationActive = true;

    const ui = await createShadowRootUi(ctx, {
      name: "manga-tracker-calibration",
      position: "modal",
      zIndex: 2147483647,
      onMount: (container) => {
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
  },
});
