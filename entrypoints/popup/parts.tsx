import {
  ArrowRight,
  BookOpen,
  CircleAlert,
  Crosshair,
  ExternalLink,
  Globe,
  Info,
  Library,
  Pause,
  Pencil,
  Play,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ExtensionNoticeDto, LibraryEntryDto } from "@/utils/api/types";
import type { DetectionEntry } from "@/utils/detection-log";
import {
  coverSrc,
  mangaPageUrl,
  type Tone,
  verdictFor,
} from "@/utils/popup-model";
import type { Connection } from "./App";
import {
  type ActiveTab,
  disableTracking,
  enableTracking,
  openTab,
  type SiteState,
  startCalibration,
  type Tracked,
  upgradeTracking,
} from "./site";

/**
 * The cache-buster for the cover of the page in front of the reader, whose
 * version the detection log does not know: one per opening of the popup, so a
 * cover saved a minute ago shows, and re-renders do not fetch it again.
 */
const POPUP_OPENED_AT = Date.now();

export function Header({
  connection,
  paused,
  onTogglePause,
}: {
  connection: Connection;
  paused: boolean;
  onTogglePause: () => void;
}) {
  return (
    <header className="header">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true">
          <BookOpen size={15} strokeWidth={2.2} />
        </span>
        Manga Tracker
      </span>
      <ConnectionPill connection={connection} />
      <button
        type="button"
        className={paused ? "icon-button active" : "icon-button"}
        onClick={onTogglePause}
        title={paused ? "Reanudar el tracking" : "Pausar el tracking"}
        aria-pressed={paused}
      >
        {paused ? <Play size={16} /> : <Pause size={16} />}
      </button>
    </header>
  );
}

function ConnectionPill({ connection }: { connection: Connection }) {
  switch (connection.kind) {
    case "checking":
      return <span className="pill quiet">Buscando la app…</span>;
    case "connected":
      return (
        <span className="pill good">
          <span className="dot" aria-hidden="true" />
          Conectado
        </span>
      );
    case "disconnected":
      return (
        <span className="pill bad" title={connection.error}>
          <span className="dot" aria-hidden="true" />
          Sin conexión
        </span>
      );
  }
}

export function Notices({
  notices,
  outdated,
  pending,
  onDismiss,
}: {
  notices: readonly ExtensionNoticeDto[];
  outdated: boolean;
  pending: number;
  onDismiss: (id: string) => void;
}) {
  if (notices.length === 0 && !outdated && pending === 0) {
    return null;
  }
  return (
    <section className="notices" aria-label="Avisos">
      {outdated && (
        <p className="notice warm">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            Hay una versión más nueva de la extensión. Chrome la instala sola en
            unas horas; si no, reinstalala desde los ajustes de la app.
          </span>
        </p>
      )}
      {pending > 0 && (
        <p className="notice warm">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            {pending === 1
              ? "1 lectura espera a la app; se envía sola cuando vuelva."
              : `${pending} lecturas esperan a la app; se envían solas cuando vuelva.`}
          </span>
        </p>
      )}
      {notices.map((notice) => (
        <p
          key={notice.id}
          className={notice.level === "warning" ? "notice warm" : "notice"}
        >
          <Info size={16} aria-hidden="true" />
          <span>{notice.text}</span>
          <button
            type="button"
            className="icon-button small"
            onClick={() => onDismiss(notice.id)}
            title="Cerrar aviso"
          >
            <X size={14} />
          </button>
        </p>
      ))}
    </section>
  );
}

export function NowCard({
  tab,
  site,
  entry,
  baseUrl,
  connected,
  onManual,
}: {
  tab: ActiveTab | null | undefined;
  site: SiteState;
  entry: DetectionEntry | null;
  baseUrl: string | null;
  connected: boolean;
  onManual: () => void;
}) {
  if (tab === undefined) {
    return <section className="card now skeleton" aria-busy="true" />;
  }
  if (tab === null) {
    return (
      <section className="card now">
        <p className="now-empty">Esta pestaña no es una página que se lea.</p>
      </section>
    );
  }
  if (entry === null) {
    const tracked = site.kind === "tracked" || site.kind === "tracked-narrow";
    return (
      <section className="card now">
        <p className="now-empty">
          {tracked
            ? "Todavía no leí esta página. Abrí o recargá un capítulo."
            : "Este sitio no se trackea. Activalo abajo, o guardá este capítulo a mano."}
        </p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onManual}>
            <Pencil size={14} aria-hidden="true" />
            Guardar a mano
          </button>
        </div>
      </section>
    );
  }

  const { detection, delivery, facts } = entry;
  const verdict = verdictFor(entry);
  const mangaId = delivery?.status === "sent" ? delivery.mangaId : undefined;

  return (
    <section className="card now" aria-label="Esta página">
      {detection.detected ? (
        <div className="now-main">
          <Cover
            src={
              baseUrl && mangaId
                ? coverSrc(baseUrl, mangaId, POPUP_OPENED_AT)
                : null
            }
            alt=""
          />
          <div className="now-text">
            <h2 className="now-title">{detection.mangaName}</h2>
            <p className="now-chapter">{detection.chapterLabel}</p>
            <Verdict tone={verdict.tone} text={verdict.headline} />
          </div>
        </div>
      ) : (
        <Verdict tone={verdict.tone} text={verdict.headline} />
      )}
      {verdict.hint && <p className="hint">{verdict.hint}</p>}
      {entry.coverHeal?.status === "failed" && (
        <p className="hint">Portada pendiente: {entry.coverHeal.error}</p>
      )}
      <div className="actions">
        {baseUrl && mangaId && (
          <button
            type="button"
            className="primary"
            disabled={!connected}
            onClick={() => void openTab(mangaPageUrl(baseUrl, mangaId))}
          >
            <Library size={14} aria-hidden="true" />
            Ver en la biblioteca
          </button>
        )}
        {facts?.nextUrl && (
          <button
            type="button"
            className="ghost"
            onClick={() => facts.nextUrl && void openTab(facts.nextUrl)}
          >
            Siguiente
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="ghost" onClick={onManual}>
          <Pencil size={14} aria-hidden="true" />
          {detection.detected ? "Corregir" : "Guardar a mano"}
        </button>
      </div>
    </section>
  );
}

function Verdict({ tone, text }: { tone: Tone; text: string }) {
  return (
    <p className={`verdict ${tone}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </p>
  );
}

function Cover({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <span className="cover placeholder" aria-hidden="true">
        <BookOpen size={18} />
      </span>
    );
  }
  return (
    <img
      className="cover"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ContinueReading({
  entries,
  baseUrl,
}: {
  entries: readonly LibraryEntryDto[] | null;
  baseUrl: string | null;
}) {
  if (entries === null || entries.length === 0) {
    return null;
  }
  return (
    <section className="section" aria-label="Seguir leyendo">
      <h3 className="section-title">Seguir leyendo</h3>
      <ul className="recent">
        {entries.map((manga) => {
          const chapter =
            manga.lastActivity?.chapterLabel ?? manga.reachedChapter?.label;
          const target = manga.lastSourceUrl;
          return (
            <li key={manga.id}>
              <button
                type="button"
                className="recent-item"
                disabled={target === null}
                onClick={() => target && void openTab(target)}
                title={target ?? "Sin capítulo para abrir"}
              >
                <Cover
                  src={
                    baseUrl && (manga.coverUrl || manga.hasStoredCover)
                      ? coverSrc(baseUrl, manga.id, manga.coverVersion)
                      : null
                  }
                  alt=""
                />
                <span className="recent-text">
                  <span className="recent-name">{manga.canonicalName}</span>
                  <span className="recent-meta">
                    {chapter ?? "Sin capítulos"}
                    {manga.sourceDomains[0]
                      ? ` · ${manga.sourceDomains[0]}`
                      : ""}
                  </span>
                </span>
                <ExternalLink
                  size={14}
                  className="chevron"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SiteCard({
  site,
  theme,
  notAChapter,
  connected,
  onChange,
}: {
  site: SiteState;
  theme: string | null;
  /** The page is a series page or a catalogue, where calibrating misleads. */
  notAChapter: boolean;
  connected: boolean;
  onChange: (state: SiteState) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<SiteState>): Promise<void> {
    setBusy(true);
    try {
      onChange(await action());
    } finally {
      setBusy(false);
    }
  }

  async function calibrate(current: Tracked): Promise<void> {
    const result = await startCalibration(current.tabId);
    if (!result.ok) {
      onChange({ kind: "error", error: result.error });
      return;
    }
    // The overlay lives on the page; the popup just gets out of the way.
    window.close();
  }

  switch (site.kind) {
    case "loading":
    case "untrackable":
      return null;
    case "error":
      return (
        <section className="section">
          <p className="notice bad">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{site.error}</span>
          </p>
        </section>
      );
    case "untracked":
    case "permission-denied":
      return (
        <section className="section" aria-label="Este sitio">
          <SiteLine host={site.host} status="No se trackea" />
          {site.kind === "permission-denied" && (
            <p className="hint">
              Chrome no dio el permiso. Volvé a intentarlo y aceptá el diálogo.
            </p>
          )}
          {/* Said before the person agrees, as the Web Store asks of any
              extension that reads what someone does on a site. */}
          <p className="hint">
            Al activarlo, la extensión lee el nombre y el capítulo de lo que
            abras en este sitio y lo guarda en Manga Tracker, en tu computadora.
            No se envía a ningún otro lado.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!connected || busy}
              onClick={() => void run(() => enableTracking(site))}
            >
              {site.kind === "permission-denied"
                ? "Reintentar"
                : "Trackear este sitio"}
            </button>
          </div>
        </section>
      );
    case "tracked":
    case "tracked-narrow":
      return (
        <section className="section" aria-label="Este sitio">
          <SiteLine
            host={site.host}
            status={theme ? `Trackeado · tema ${theme}` : "Trackeado"}
            good
          />
          {site.kind === "tracked-narrow" && (
            <p className="hint">
              Este sitio necesita un permiso ampliado (subdominios) para guardar
              las portadas que su CDN bloquea.
            </p>
          )}
          {notAChapter && (
            <p className="hint">
              Para calibrar, abrí un capítulo: lo que marques se busca después
              en cada capítulo, y en la ficha de la serie no está.
            </p>
          )}
          <div className="actions">
            {site.kind === "tracked-narrow" && (
              <button
                type="button"
                className="primary"
                disabled={!connected || busy}
                onClick={() => void run(() => upgradeTracking(site))}
              >
                Ampliar permiso
              </button>
            )}
            <button
              type="button"
              className="ghost"
              disabled={!connected || busy}
              onClick={() => void calibrate(site)}
            >
              <Crosshair size={14} aria-hidden="true" />
              Calibrar
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void run(() => disableTracking(site))}
            >
              Dejar de trackear
            </button>
          </div>
        </section>
      );
  }
}

function SiteLine({
  host,
  status,
  good = false,
}: {
  host: string;
  status: string;
  good?: boolean;
}) {
  return (
    <p className="site-line">
      <Globe size={15} className="site-icon" aria-hidden="true" />
      <span className="site-host">{host}</span>
      <span className={good ? "site-status good" : "site-status"}>
        {status}
      </span>
    </p>
  );
}

export function Footer({
  baseUrl,
  onSites,
  onSettings,
}: {
  baseUrl: string | null;
  onSites: () => void;
  onSettings: () => void;
}) {
  return (
    <footer className="footer">
      <button type="button" className="link" onClick={onSites}>
        <Globe size={14} aria-hidden="true" />
        Sitios
      </button>
      <button type="button" className="link" onClick={onSettings}>
        <Settings size={14} aria-hidden="true" />
        Ajustes
      </button>
      <button
        type="button"
        className="link"
        disabled={baseUrl === null}
        onClick={() => baseUrl && void openTab(baseUrl)}
      >
        <Library size={14} aria-hidden="true" />
        Biblioteca
      </button>
    </footer>
  );
}
