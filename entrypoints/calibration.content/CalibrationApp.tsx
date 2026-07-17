import { useEffect, useState } from "react";
import type { CalibrationPick } from "@/utils/calibration";
import { pickElement } from "@/utils/calibration";
import { sendRuntimeMessage } from "@/utils/messages";

// Tag name given to createShadowRootUi; events from inside the shadow UI
// retarget to this host element, which is how page picks are told apart.
const HOST_TAG = "manga-tracker-calibration";
const HIGHLIGHT_OUTLINE = "2px solid #7aa2f7";

type Step =
  | { kind: "pick-title" }
  | { kind: "pick-chapter"; title: CalibrationPick }
  | { kind: "confirm"; title: CalibrationPick; chapter: CalibrationPick }
  | { kind: "saving"; title: CalibrationPick; chapter: CalibrationPick }
  | {
      kind: "error";
      message: string;
      title: CalibrationPick;
      chapter: CalibrationPick;
    }
  | { kind: "saved" };

export function CalibrationApp({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick-title" });

  const picking = step.kind === "pick-title" || step.kind === "pick-chapter";

  // While picking: highlight the hovered page element and capture the click
  // before the page can act on it.
  useEffect(() => {
    if (!picking) {
      return;
    }

    let highlighted: HTMLElement | null = null;
    let previousOutline = "";
    let previousOffset = "";

    function clearHighlight(): void {
      if (highlighted) {
        highlighted.style.outline = previousOutline;
        highlighted.style.outlineOffset = previousOffset;
        highlighted = null;
      }
    }

    function pageElementFrom(event: Event): HTMLElement | null {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return null;
      }
      if (target.closest(HOST_TAG)) {
        return null;
      }
      return target;
    }

    function onMouseOver(event: MouseEvent): void {
      const element = pageElementFrom(event);
      if (!element || element === highlighted) {
        return;
      }
      clearHighlight();
      highlighted = element;
      previousOutline = element.style.outline;
      previousOffset = element.style.outlineOffset;
      element.style.outline = HIGHLIGHT_OUTLINE;
      element.style.outlineOffset = "2px";
    }

    function onClick(event: MouseEvent): void {
      const element = pageElementFrom(event);
      if (!element) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pick = pickElement(element, document);
      if (!pick) {
        // No text or no unique selector: keep picking.
        return;
      }
      clearHighlight();
      setStep((current) => {
        if (current.kind === "pick-title") {
          return { kind: "pick-chapter", title: pick };
        }
        if (current.kind === "pick-chapter") {
          return { kind: "confirm", title: current.title, chapter: pick };
        }
        return current;
      });
    }

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    return () => {
      clearHighlight();
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [picking]);

  // Escape cancels at any step.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  async function save(
    title: CalibrationPick,
    chapter: CalibrationPick,
  ): Promise<void> {
    setStep({ kind: "saving", title, chapter });
    const result = await sendRuntimeMessage({
      kind: "save-adapter",
      body: {
        domain: location.hostname,
        titleSelector: title.selector,
        chapterSelector: chapter.selector,
      },
    });
    if (result.ok) {
      setStep({ kind: "saved" });
      window.setTimeout(onClose, 1500);
    } else {
      setStep({ kind: "error", message: result.error, title, chapter });
    }
  }

  return (
    <div className="backdrop">
      <div className="bar">
        {step.kind === "pick-title" && (
          <span>
            <strong>Calibración 1/2:</strong> clickeá el <strong>título</strong>{" "}
            del manga en la página.
          </span>
        )}
        {step.kind === "pick-chapter" && (
          <span>
            <strong>Calibración 2/2:</strong> clickeá el{" "}
            <strong>capítulo</strong> actual.
          </span>
        )}
        {(step.kind === "confirm" ||
          step.kind === "saving" ||
          step.kind === "error") && (
          <span>
            Título: “{step.title.text}” · Capítulo: “{step.chapter.text}”
          </span>
        )}
        {step.kind === "error" && (
          <span className="error">Error: {step.message}</span>
        )}
        {step.kind === "saved" && (
          <span>✓ Sitio calibrado. Registrando la lectura…</span>
        )}
        <span className="actions">
          {(step.kind === "confirm" || step.kind === "error") && (
            <button
              type="button"
              onClick={() => void save(step.title, step.chapter)}
            >
              Guardar
            </button>
          )}
          {step.kind !== "saved" && (
            <button
              type="button"
              className="ghost"
              disabled={step.kind === "saving"}
              onClick={onClose}
            >
              Cancelar
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
