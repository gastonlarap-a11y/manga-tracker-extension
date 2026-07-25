import { useEffect, useState } from "react";
import { browser } from "#imports";
import type { CreateEventResponse } from "@/utils/api/types";
import { trackingOriginPatterns } from "@/utils/base-domain";
import { CONFIDENCE_THRESHOLD } from "@/utils/detection/heuristics";
import type { CoverHealStatus, DetectionEntry } from "@/utils/detection-log";
import { sendRuntimeMessage } from "@/utils/messages";
import "./App.css";

type ConnectionState =
  | { kind: "checking" }
  | { kind: "connected" }
  | { kind: "disconnected"; error: string };

type TestEventState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; data: CreateEventResponse }
  | { kind: "failed"; error: string };

type SiteState =
  | { kind: "loading" }
  | { kind: "untrackable" }
  | { kind: "untracked"; host: string; widePatterns: string[]; tabId: number }
  | {
      kind: "permission-denied";
      host: string;
      widePatterns: string[];
      tabId: number;
    }
  // Legacy grant from before base-domain-wide tracking: the exact origin is
  // tracked, but cover CDNs on sibling subdomains are out of reach until the
  // user re-grants the wide patterns (a user gesture Chrome requires).
  | {
      kind: "tracked-narrow";
      host: string;
      narrowPattern: string;
      widePatterns: string[];
      tabId: number;
    }
  | { kind: "tracked"; host: string; originPatterns: string[]; tabId: number }
  | { kind: "error"; error: string };

async function readActiveSite(): Promise<SiteState> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) {
    return { kind: "untrackable" };
  }
  let origin: URL;
  try {
    origin = new URL(tab.url);
  } catch {
    return { kind: "untrackable" };
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return { kind: "untrackable" };
  }
  const host = origin.hostname;
  const tabId = tab.id;
  const widePatterns = trackingOriginPatterns(host);
  if (await browser.permissions.contains({ origins: widePatterns })) {
    const repair = await ensureRegistered(widePatterns, tabId);
    if (!repair.ok) {
      return repair.state;
    }
    return { kind: "tracked", host, originPatterns: widePatterns, tabId };
  }
  const narrowPattern = `${origin.origin}/*`;
  if (await browser.permissions.contains({ origins: [narrowPattern] })) {
    const repair = await ensureRegistered([narrowPattern], tabId);
    if (!repair.ok) {
      return repair.state;
    }
    return { kind: "tracked-narrow", host, narrowPattern, widePatterns, tabId };
  }
  return { kind: "untracked", host, widePatterns, tabId };
}

// The granted permission alone does not mean the detector is live: extension
// reloads wipe the registrations and keep the permissions, which used to leave
// the popup claiming "tracked" over a site that never detected anything.
async function ensureRegistered(
  originPatterns: string[],
  tabId: number,
): Promise<{ ok: true } | { ok: false; state: SiteState }> {
  const result = await sendRuntimeMessage({
    kind: "ensure-site-registered",
    originPatterns,
    tabId,
  });
  if (!result.ok) {
    return { ok: false, state: { kind: "error", error: result.error } };
  }
  return { ok: true };
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "checking",
  });
  const [site, setSite] = useState<SiteState>({ kind: "loading" });
  const [testEvent, setTestEvent] = useState<TestEventState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    void sendRuntimeMessage({ kind: "ping" }).then((result) => {
      if (cancelled) {
        return;
      }
      setConnection(
        result.ok
          ? { kind: "connected" }
          : { kind: "disconnected", error: result.error },
      );
    });
    void readActiveSite().then((state) => {
      if (!cancelled) {
        setSite(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function registerPatterns(
    patterns: string[],
    tabId: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    for (const originPattern of patterns) {
      const result = await sendRuntimeMessage({
        kind: "register-site",
        originPattern,
        tabId,
      });
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  async function enableTracking(
    current: Extract<SiteState, { kind: "untracked" }>,
  ): Promise<void> {
    const granted = await browser.permissions.request({
      origins: current.widePatterns,
    });
    if (!granted) {
      // A dismissed/denied Chrome prompt used to leave the popup mute — the
      // most confusing "nothing happened" of the whole tracking flow.
      setSite({ ...current, kind: "permission-denied" });
      return;
    }
    const result = await registerPatterns(current.widePatterns, current.tabId);
    setSite(
      result.ok
        ? {
            kind: "tracked",
            host: current.host,
            originPatterns: current.widePatterns,
            tabId: current.tabId,
          }
        : { kind: "error", error: result.error },
    );
  }

  async function upgradeTracking(
    current: Extract<SiteState, { kind: "tracked-narrow" }>,
  ): Promise<void> {
    const granted = await browser.permissions.request({
      origins: current.widePatterns,
    });
    if (!granted) {
      setSite({ ...current, kind: "permission-denied" });
      return;
    }
    // Swap the legacy exact-origin registration for the wide one so the same
    // pages don't get two detector registrations.
    await sendRuntimeMessage({
      kind: "unregister-site",
      originPattern: current.narrowPattern,
    });
    await browser.permissions.remove({ origins: [current.narrowPattern] });
    const result = await registerPatterns(current.widePatterns, current.tabId);
    if (result.ok) {
      // The CDN just became reachable — retry pending cover byte captures
      // right away instead of waiting for the next browser start.
      void sendRuntimeMessage({ kind: "backfill-covers" });
    }
    setSite(
      result.ok
        ? {
            kind: "tracked",
            host: current.host,
            originPatterns: current.widePatterns,
            tabId: current.tabId,
          }
        : { kind: "error", error: result.error },
    );
  }

  async function startCalibration(
    current: Extract<SiteState, { kind: "tracked" | "tracked-narrow" }>,
  ): Promise<void> {
    const result = await sendRuntimeMessage({
      kind: "start-calibration",
      tabId: current.tabId,
    });
    if (!result.ok) {
      setSite({ kind: "error", error: result.error });
      return;
    }
    // The overlay lives on the page; the popup just gets out of the way.
    window.close();
  }

  async function disableTracking(
    current: Extract<SiteState, { kind: "tracked" | "tracked-narrow" }>,
  ): Promise<void> {
    const patterns =
      current.kind === "tracked"
        ? current.originPatterns
        : [current.narrowPattern];
    for (const originPattern of patterns) {
      const result = await sendRuntimeMessage({
        kind: "unregister-site",
        originPattern,
      });
      if (!result.ok) {
        setSite({ kind: "error", error: result.error });
        return;
      }
    }
    await browser.permissions.remove({ origins: patterns });
    setSite({
      kind: "untracked",
      host: current.host,
      widePatterns:
        current.kind === "tracked"
          ? current.originPatterns
          : current.widePatterns,
      tabId: current.tabId,
    });
  }

  async function sendTestEvent(): Promise<void> {
    setTestEvent({ kind: "sending" });
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) {
      setTestEvent({ kind: "failed", error: "No hay pestaña activa" });
      return;
    }
    const result = await sendRuntimeMessage({
      kind: "send-test-event",
      tabId: tab.id,
    });
    setTestEvent(
      result.ok
        ? { kind: "sent", data: result.data }
        : { kind: "failed", error: result.error },
    );
  }

  return (
    <main className="popup">
      <h1>Manga Tracker</h1>
      <ConnectionBadge state={connection} />
      <SiteSection
        state={site}
        connected={connection.kind === "connected"}
        onEnable={(current) => void enableTracking(current)}
        onUpgrade={(current) => void upgradeTracking(current)}
        onDisable={(current) => void disableTracking(current)}
        onCalibrate={(current) => void startCalibration(current)}
      />
      <button
        type="button"
        disabled={
          connection.kind !== "connected" || testEvent.kind === "sending"
        }
        onClick={() => void sendTestEvent()}
      >
        {testEvent.kind === "sending" ? "Enviando…" : "Enviar evento test"}
      </button>
      <TestEventResult state={testEvent} />
    </main>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  switch (state.kind) {
    case "checking":
      return <p className="status checking">Verificando backend…</p>;
    case "connected":
      return <p className="status connected">Conectado</p>;
    case "disconnected":
      return (
        <p className="status disconnected" title={state.error}>
          Sin conexión — {state.error}
        </p>
      );
  }
}

function SiteSection({
  state,
  connected,
  onEnable,
  onUpgrade,
  onDisable,
  onCalibrate,
}: {
  state: SiteState;
  connected: boolean;
  onEnable: (current: Extract<SiteState, { kind: "untracked" }>) => void;
  onUpgrade: (current: Extract<SiteState, { kind: "tracked-narrow" }>) => void;
  onDisable: (
    current: Extract<SiteState, { kind: "tracked" | "tracked-narrow" }>,
  ) => void;
  onCalibrate: (
    current: Extract<SiteState, { kind: "tracked" | "tracked-narrow" }>,
  ) => void;
}) {
  switch (state.kind) {
    case "loading":
      return <p className="site">Leyendo pestaña…</p>;
    case "untrackable":
      return <p className="site">Esta página no se puede trackear.</p>;
    case "error":
      return <p className="site error">Error: {state.error}</p>;
    case "untracked":
      return (
        <div className="site">
          <p>
            <strong>{state.host}</strong> no se trackea.
          </p>
          <button
            type="button"
            disabled={!connected}
            onClick={() => onEnable(state)}
          >
            Trackear este sitio
          </button>
        </div>
      );
    case "permission-denied":
      return (
        <div className="site">
          <p className="error">
            Chrome no otorgó el permiso para <strong>{state.host}</strong> —
            reintentá y aceptá el diálogo de permisos.
          </p>
          <button
            type="button"
            disabled={!connected}
            onClick={() => onEnable({ ...state, kind: "untracked" })}
          >
            Reintentar
          </button>
        </div>
      );
    case "tracked-narrow":
      return (
        <div className="site">
          <p>
            <strong>{state.host}</strong>: tracking automático activo.
          </p>
          <p className="diagnosis">
            Este sitio necesita un permiso ampliado (subdominios) para guardar
            portadas que su CDN bloquea.
          </p>
          <DetectionStatus tabId={state.tabId} />
          <button
            type="button"
            disabled={!connected}
            onClick={() => onUpgrade(state)}
          >
            Ampliar permiso
          </button>
          <button
            type="button"
            disabled={!connected}
            onClick={() => onCalibrate(state)}
          >
            Calibrar detección
          </button>
          <button type="button" onClick={() => onDisable(state)}>
            Dejar de trackear
          </button>
        </div>
      );
    case "tracked":
      return (
        <div className="site">
          <p>
            <strong>{state.host}</strong>: tracking automático activo.
          </p>
          <DetectionStatus tabId={state.tabId} />
          <button
            type="button"
            disabled={!connected}
            onClick={() => onCalibrate(state)}
          >
            Calibrar detección
          </button>
          <button type="button" onClick={() => onDisable(state)}>
            Dejar de trackear
          </button>
        </div>
      );
  }
}

type DiagnosisState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; entry: DetectionEntry };

function DetectionStatus({ tabId }: { tabId: number }) {
  const [diagnosis, setDiagnosis] = useState<DiagnosisState>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void sendRuntimeMessage({ kind: "get-detection", tabId }).then((entry) => {
      if (!cancelled) {
        setDiagnosis(entry ? { kind: "ready", entry } : { kind: "none" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  switch (diagnosis.kind) {
    case "loading":
      return null;
    case "none":
      return (
        <p className="diagnosis">
          Sin detección aún en esta pestaña (abrí o recargá un capítulo).
        </p>
      );
    case "ready":
      return (
        <>
          <p className="diagnosis">{describeDetection(diagnosis.entry)}</p>
          {diagnosis.entry.coverHeal && (
            <p className="diagnosis">
              {describeCoverHeal(diagnosis.entry.coverHeal)}
            </p>
          )}
        </>
      );
  }
}

function describeCoverHeal(coverHeal: CoverHealStatus): string {
  return coverHeal.status === "healed"
    ? "Portada guardada ✓"
    : `Portada pendiente: ${coverHeal.error}`;
}

function describeDetection(entry: DetectionEntry): string {
  const detection = entry.detection;
  if (detection.detected) {
    const percent = Math.round(detection.confidence * 100);
    if (detection.confidence >= CONFIDENCE_THRESHOLD) {
      const base = `Detectado: ${detection.mangaName} — ${detection.chapterLabel} (${percent} %)`;
      if (!entry.delivery) {
        return base;
      }
      return entry.delivery.status === "sent"
        ? `${base} — guardado.`
        : `${base} — pero el guardado falló: ${entry.delivery.error}`;
    }
    return `Confianza baja (${percent} %): ${detection.mangaName} — usá "Calibrar detección".`;
  }
  switch (detection.reason) {
    case "no-chapter-in-url":
      return "La URL no parece de un capítulo (las páginas de catálogo no se guardan).";
    case "no-chapter-in-title":
      return 'El título de la página no nombra el capítulo — usá "Calibrar detección".';
    case "no-title":
      return 'La página no expone un título utilizable — usá "Calibrar detección".';
  }
}

function TestEventResult({ state }: { state: TestEventState }) {
  switch (state.kind) {
    case "idle":
    case "sending":
      return null;
    case "sent":
      return (
        <p className="result ok">
          Registrado: <strong>{state.data.manga.canonicalName}</strong> —{" "}
          {state.data.event.chapterLabel}
        </p>
      );
    case "failed":
      return <p className="result error">Error: {state.error}</p>;
  }
}
