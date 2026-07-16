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

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "checking",
  });
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
    return () => {
      cancelled = true;
    };
  }, []);

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
