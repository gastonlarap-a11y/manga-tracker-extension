import { ChevronLeft, Globe, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { browser } from "#imports";
import type { DetectionEntry } from "@/utils/detection-log";
import { sendRuntimeMessage } from "@/utils/messages";
import {
  manualDraftFrom,
  type TrackedSite,
  trackedSites,
  verdictFor,
} from "@/utils/popup-model";
import { recordIncognitoItem } from "@/utils/tracking-prefs";
import { type ActiveTab, forgetPatterns, openTab } from "./site";

function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="view-header">
      <button
        type="button"
        className="icon-button"
        onClick={onBack}
        title="Volver"
      >
        <ChevronLeft size={18} />
      </button>
      <h2>{title}</h2>
    </header>
  );
}

type SaveState =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

/**
 * "Guardar a mano": for the page detection missed, or got wrong. What it
 * guessed is the starting point, never a requirement.
 */
export function ManualView({
  tab,
  entry,
  onDone,
  onBack,
}: {
  tab: ActiveTab;
  entry: DetectionEntry | null;
  onDone: () => void;
  onBack: () => void;
}) {
  const draft = manualDraftFrom(
    entry?.url === tab.url ? entry : null,
    tab.title,
  );
  const [mangaName, setMangaName] = useState(draft.mangaName);
  const [chapterLabel, setChapterLabel] = useState(draft.chapterLabel);
  const [state, setState] = useState<SaveState>({ kind: "editing" });
  const nameId = useId();
  const chapterId = useId();

  const ready = mangaName.trim().length > 0 && chapterLabel.trim().length > 0;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!ready) {
      return;
    }
    setState({ kind: "saving" });
    const seriesUrl = entry?.facts?.seriesLinkUrl ?? null;
    const result = await sendRuntimeMessage({
      kind: "record-manual",
      tabId: tab.id,
      payload: {
        mangaName: mangaName.trim(),
        chapterLabel: chapterLabel.trim(),
        sourceUrl: tab.url,
        ...(seriesUrl !== null ? { seriesUrl } : {}),
      },
    });
    if (result.ok) {
      setState({ kind: "done", text: "Guardado." });
      window.setTimeout(onDone, 700);
      return;
    }
    const after = await sendRuntimeMessage({
      kind: "get-detection",
      tabId: tab.id,
    });
    const text = after ? verdictFor(after).headline : result.error;
    setState(
      "queued" in result ? { kind: "done", text } : { kind: "failed", text },
    );
  }

  return (
    <>
      <ViewHeader title="Guardar a mano" onBack={onBack} />
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label htmlFor={nameId}>Manga</label>
        <input
          id={nameId}
          value={mangaName}
          onChange={(event) => setMangaName(event.target.value)}
          placeholder="Nombre del manga"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the one field this view exists for
          autoFocus
        />
        <label htmlFor={chapterId}>Capítulo</label>
        <input
          id={chapterId}
          value={chapterLabel}
          onChange={(event) => setChapterLabel(event.target.value)}
          placeholder="Cap. 12"
          autoComplete="off"
        />
        <p className="hint">
          Se guarda con esta página como fuente. Si el nombre coincide con uno
          de tu biblioteca, se suma a esa serie.
        </p>
        {state.kind === "done" && <p className="verdict good">{state.text}</p>}
        {state.kind === "failed" && <p className="verdict bad">{state.text}</p>}
        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={!ready || state.kind === "saving"}
          >
            {state.kind === "saving" ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="ghost" onClick={onBack}>
            Cancelar
          </button>
        </div>
      </form>
    </>
  );
}

async function loadTrackedSites(): Promise<TrackedSite[]> {
  const granted = await browser.permissions.getAll();
  return trackedSites(granted.origins ?? []);
}

/** Every site this browser tracks, and a way to stop any of them. */
export function SitesView({
  currentHost,
  onBack,
}: {
  currentHost: string | null;
  onBack: () => void;
}) {
  const [sites, setSites] = useState<TrackedSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTrackedSites().then(setSites);
  }, []);

  async function forget(site: TrackedSite): Promise<void> {
    const result = await forgetPatterns(site.patterns);
    if (!result.ok) {
      setError(result.error);
    }
    setSites(await loadTrackedSites());
  }

  return (
    <>
      <ViewHeader title="Sitios trackeados" onBack={onBack} />
      {error && <p className="notice bad">{error}</p>}
      {sites === null ? null : sites.length === 0 ? (
        <p className="now-empty">
          Todavía no trackeás ningún sitio. Abrí un capítulo y tocá «Trackear
          este sitio».
        </p>
      ) : (
        <ul className="sites">
          {sites.map((site) => (
            <li key={site.host} className="site-row">
              <Globe size={15} className="site-icon" aria-hidden="true" />
              <span className="site-host">
                {site.host}
                {currentHost !== null &&
                  (currentHost === site.host ||
                    currentHost.endsWith(`.${site.host}`)) && (
                    <span className="site-status good"> · esta pestaña</span>
                  )}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void forget(site)}
                title={`Dejar de trackear ${site.host}`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SettingsView({
  paused,
  baseUrl,
  onTogglePause,
  onBack,
}: {
  paused: boolean;
  baseUrl: string | null;
  onTogglePause: () => void;
  onBack: () => void;
}) {
  const [recordIncognito, setRecordIncognito] = useState<boolean | null>(null);
  const [incognitoAllowed, setIncognitoAllowed] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    void recordIncognitoItem.getValue().then(setRecordIncognito);
    void browser.extension
      .isAllowedIncognitoAccess()
      .then(setIncognitoAllowed, () => setIncognitoAllowed(null));
  }, []);

  async function toggleIncognito(): Promise<void> {
    const next = !recordIncognito;
    await recordIncognitoItem.setValue(next);
    setRecordIncognito(next);
  }

  return (
    <>
      <ViewHeader title="Ajustes" onBack={onBack} />
      <div className="settings">
        <Toggle
          label="Pausar el tracking"
          detail="Mientras está en pausa no se guarda nada en ningún sitio."
          checked={paused}
          onChange={onTogglePause}
        />
        <Toggle
          label="Guardar en ventanas privadas"
          detail={
            incognitoAllowed === false
              ? "La extensión no tiene permiso para ventanas privadas, así que ahí no corre."
              : "Apagado, lo que leas en una ventana privada no queda registrado."
          }
          checked={recordIncognito === true}
          disabled={recordIncognito === null}
          onChange={() => void toggleIncognito()}
        />
        <div className="setting">
          <span className="setting-label">Lectura real</span>
          <span className="setting-detail">
            Contar un capítulo recién cuando lo leíste (tiempo en la página y
            cuánto bajaste). Se ajusta en la app.
          </span>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={baseUrl === null}
              onClick={() => baseUrl && void openTab(`${baseUrl}/extension`)}
            >
              Abrir en la app
            </button>
          </div>
        </div>
        <p className="version">
          Versión {browser.runtime.getManifest().version}
        </p>
      </div>
    </>
  );
}

function Toggle({
  label,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="setting">
      <label className="setting-row" htmlFor={id}>
        <span className="setting-label">{label}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          className="switch"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
      </label>
      <span className="setting-detail">{detail}</span>
    </div>
  );
}
