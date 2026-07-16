import { useEffect, useState } from "react";
import { browser } from "#imports";
import type { CreateEventResponse } from "@/utils/api/types";
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
  | { kind: "untracked"; host: string; originPattern: string; tabId: number }
  | { kind: "tracked"; host: string; originPattern: string; tabId: number }
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
  const originPattern = `${origin.origin}/*`;
  const tracked = await browser.permissions.contains({
    origins: [originPattern],
  });
  return {
    kind: tracked ? "tracked" : "untracked",
    host: origin.hostname,
    originPattern,
    tabId: tab.id,
  };
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

  async function enableTracking(
    current: Extract<SiteState, { kind: "untracked" }>,
  ): Promise<void> {
    const granted = await browser.permissions.request({
      origins: [current.originPattern],
    });
    if (!granted) {
      return;
    }
    const result = await sendRuntimeMessage({
      kind: "register-site",
      originPattern: current.originPattern,
      tabId: current.tabId,
    });
    setSite(
      result.ok
        ? { ...current, kind: "tracked" }
        : { kind: "error", error: result.error },
    );
  }

  async function disableTracking(
    current: Extract<SiteState, { kind: "tracked" }>,
  ): Promise<void> {
    const result = await sendRuntimeMessage({
      kind: "unregister-site",
      originPattern: current.originPattern,
    });
    if (!result.ok) {
      setSite({ kind: "error", error: result.error });
      return;
    }
    await browser.permissions.remove({ origins: [current.originPattern] });
    setSite({ ...current, kind: "untracked" });
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
        onDisable={(current) => void disableTracking(current)}
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
  onDisable,
}: {
  state: SiteState;
  connected: boolean;
  onEnable: (current: Extract<SiteState, { kind: "untracked" }>) => void;
  onDisable: (current: Extract<SiteState, { kind: "tracked" }>) => void;
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
    case "tracked":
      return (
        <div className="site">
          <p>
            <strong>{state.host}</strong>: tracking automático activo.
          </p>
          <button type="button" onClick={() => onDisable(state)}>
            Dejar de trackear
          </button>
        </div>
      );
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
