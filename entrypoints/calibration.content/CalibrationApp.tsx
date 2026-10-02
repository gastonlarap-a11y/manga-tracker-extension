import { useEffect, useRef, useState } from "react";
import type { CalibrationPick, PickRejection } from "@/utils/calibration";
import { checkPick, pickElement, pickTarget } from "@/utils/calibration";
import { sendRuntimeMessage } from "@/utils/messages";

// Tag name given to createShadowRootUi; events from inside the shadow UI
// retarget to this host element, which is how the overlay's own clicks are
// told apart from picks on the page.
export const HOST_TAG = "manga-tracker-calibration";

/**
 * Everything a press on the page sets off, held back from the page while
 * picking: a link would navigate, a reader would turn the page, and the ad
 * layer most of these sites put over everything would open a tab — on
 * pointerdown as often as on click.
 */
const SWALLOWED_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "auxclick",
  "dblclick",
] as const;

const REJECTION_TEXT: Record<PickRejection | "nothing", string> = {
  "no-text":
    "Ese elemento no tiene texto (es una imagen o un ícono). Clickeá sobre las letras.",
  "too-much-text":
    "Eso es un bloque entero de la página. Clickeá justo sobre el texto.",
  "no-selector":
    "No encuentro una forma de volver a encontrar ese elemento. Probá con el que lo contiene.",
  "title-has-chapter":
    "Eso incluye el capítulo además del nombre. Clickeá solo sobre el nombre del manga.",
  "chapter-has-no-number":
    "Ese texto no tiene el número del capítulo. Clickeá sobre el número.",
  "same-as-title":
    "Es el mismo elemento que elegiste como nombre. Clickeá donde está el capítulo.",
  nothing: "Ahí no hay nada que tomar. Clickeá sobre el texto.",
};

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

interface Highlight {
  top: number;
  left: number;
  width: number;
  height: number;
  text: string;
}

function isFromOverlay(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element && node.tagName.toLowerCase() === HOST_TAG,
    );
}

/** What the reader is pointing at, past any layer laid over the page. */
function elementAt(x: number, y: number): Element | null {
  return pickTarget(
    document.elementsFromPoint(x, y),
    { width: window.innerWidth, height: window.innerHeight },
    {
      isOwn: (element) => element.tagName.toLowerCase() === HOST_TAG,
      boxOf: (element) => element.getBoundingClientRect(),
    },
  );
}

function highlightOf(element: Element): Highlight {
  const rect = element.getBoundingClientRect();
  const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    text: text.length > 60 ? `${text.slice(0, 57)}…` : text,
  };
}

export function CalibrationApp({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick-title" });
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const picking = step.kind === "pick-title" || step.kind === "pick-chapter";

  // While picking: draw a box over the element under the pointer — inside the
  // overlay, so the page's own styles are never touched — and turn a click
  // into a pick before the page can act on it.
  useEffect(() => {
    if (!picking) {
      return;
    }

    let frame = 0;
    let lastPointer: { x: number; y: number } | null = null;

    function redraw(): void {
      frame = 0;
      if (lastPointer === null) {
        return;
      }
      const element = elementAt(lastPointer.x, lastPointer.y);
      setHighlight(element ? highlightOf(element) : null);
    }

    function onPointerMove(event: PointerEvent): void {
      if (isFromOverlay(event)) {
        return;
      }
      lastPointer = { x: event.clientX, y: event.clientY };
      if (frame === 0) {
        frame = requestAnimationFrame(redraw);
      }
    }

    // The page scrolls under a still pointer; the box has to follow it.
    function onViewportChange(): void {
      if (frame === 0) {
        frame = requestAnimationFrame(redraw);
      }
    }

    function swallow(event: Event): void {
      if (isFromOverlay(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "click") {
        const { clientX, clientY } = event as MouseEvent;
        pick(elementAt(clientX, clientY));
      }
    }

    function pick(element: Element | null): void {
      if (element === null) {
        setRejection(REJECTION_TEXT.nothing);
        return;
      }
      const result = pickElement(element, document);
      if (!result.ok) {
        setRejection(REJECTION_TEXT[result.reason]);
        return;
      }
      // The step as it is now: this listener outlives the render it was
      // created in, for as long as picking lasts.
      const current = stepRef.current;
      const problem =
        current.kind === "pick-title"
          ? checkPick("title", result.pick)
          : current.kind === "pick-chapter"
            ? checkPick("chapter", result.pick, current.title)
            : null;
      if (problem !== null) {
        setRejection(REJECTION_TEXT[problem]);
        return;
      }
      setRejection(null);
      if (current.kind === "pick-title") {
        setStep({ kind: "pick-chapter", title: result.pick });
      } else if (current.kind === "pick-chapter") {
        setStep({
          kind: "confirm",
          title: current.title,
          chapter: result.pick,
        });
      }
    }

    // On window, in the capture phase: the earliest point a listener can
    // run, ahead of anything the page registered on document or below.
    window.addEventListener("pointermove", onPointerMove, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scroll", onViewportChange, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", onViewportChange, { passive: true });
    for (const type of SWALLOWED_EVENTS) {
      window.addEventListener(type, swallow, true);
    }
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      setHighlight(null);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      for (const type of SWALLOWED_EVENTS) {
        window.removeEventListener(type, swallow, true);
      }
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

  function back(): void {
    setRejection(null);
    setStep((current) => {
      if (current.kind === "pick-chapter") {
        return { kind: "pick-title" };
      }
      if (current.kind === "confirm" || current.kind === "error") {
        return { kind: "pick-chapter", title: current.title };
      }
      return current;
    });
  }

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
    <div className="layer">
      {highlight && (
        <div
          className="highlight"
          style={{
            top: highlight.top - 3,
            left: highlight.left - 3,
            width: highlight.width + 6,
            height: highlight.height + 6,
          }}
        >
          {highlight.text && (
            <span
              className={
                highlight.top < 40 ? "highlight-label below" : "highlight-label"
              }
            >
              {highlight.text}
            </span>
          )}
        </div>
      )}

      <div className="bar" role="dialog" aria-label="Calibrar detección">
        <div className="bar-main">
          {step.kind === "pick-title" && (
            <p>
              <span className="step">1 de 2</span>
              Clickeá el <strong>nombre del manga</strong> en la página.
            </p>
          )}
          {step.kind === "pick-chapter" && (
            <p>
              <span className="step">2 de 2</span>
              Ahora el <strong>capítulo</strong> que estás leyendo.
              <span className="picked">Manga: “{step.title.text}”</span>
            </p>
          )}
          {(step.kind === "confirm" ||
            step.kind === "saving" ||
            step.kind === "error") && (
            <p>
              <span className="picked">Manga: “{step.title.text}”</span>
              <span className="picked">Capítulo: “{step.chapter.text}”</span>
            </p>
          )}
          {step.kind === "saved" && (
            <p className="good">✓ Sitio calibrado. Registrando la lectura…</p>
          )}
          {rejection && picking && (
            <p className="notice" role="status">
              {rejection}
            </p>
          )}
          {step.kind === "error" && (
            <p className="notice">No se pudo guardar: {step.message}</p>
          )}
        </div>

        <div className="actions">
          {(step.kind === "pick-chapter" ||
            step.kind === "confirm" ||
            step.kind === "error") && (
            <button type="button" className="ghost" onClick={back}>
              Atrás
            </button>
          )}
          {(step.kind === "confirm" || step.kind === "error") && (
            <button
              type="button"
              className="primary"
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
        </div>
      </div>
    </div>
  );
}
