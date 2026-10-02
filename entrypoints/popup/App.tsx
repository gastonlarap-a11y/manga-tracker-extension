import { useCallback, useEffect, useState } from "react";
import { browser } from "#imports";
import type { ExtensionConfigDto, LibraryEntryDto } from "@/utils/api/types";
import type { DetectionEntry } from "@/utils/detection-log";
import { sendRuntimeMessage } from "@/utils/messages";
import { isOlderThan } from "@/utils/remote-config";
import {
  dismissedNoticesItem,
  dismissNotice,
  pausedItem,
} from "@/utils/tracking-prefs";
import {
  ContinueReading,
  Footer,
  Header,
  Notices,
  NowCard,
  SiteCard,
} from "./parts";
import {
  type ActiveTab,
  readActiveTab,
  readSiteState,
  type SiteState,
} from "./site";
import { ManualView, SettingsView, SitesView } from "./views";
import "./App.css";

export type Connection =
  | { kind: "checking" }
  | { kind: "connected" }
  | { kind: "disconnected"; error: string };

type View = "main" | "manual" | "sites" | "settings";

/**
 * How often an open popup re-reads the tab's detection: a reading waiting on
 * "lectura real", or still in flight, changes while someone looks at it.
 */
const ENTRY_REFRESH_MS = 2000;

export function App() {
  const [view, setView] = useState<View>("main");
  const [connection, setConnection] = useState<Connection>({
    kind: "checking",
  });
  // undefined while reading the tab; null when it is no web page.
  const [tab, setTab] = useState<ActiveTab | null | undefined>(undefined);
  const [site, setSite] = useState<SiteState>({ kind: "loading" });
  const [entry, setEntry] = useState<DetectionEntry | null>(null);
  const [recent, setRecent] = useState<LibraryEntryDto[] | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<ExtensionConfigDto | null>(null);
  // Readings waiting in the outbox. Shown so "Sin conexión" does not read as
  // "and everything you read meanwhile is gone".
  const [pending, setPending] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const unlessCancelled =
      <T,>(apply: (value: T) => void) =>
      (value: T) => {
        if (!cancelled) {
          apply(value);
        }
      };

    void sendRuntimeMessage({ kind: "ping" }).then(
      unlessCancelled((result) =>
        setConnection(
          result.ok
            ? { kind: "connected" }
            : { kind: "disconnected", error: result.error },
        ),
      ),
    );
    void sendRuntimeMessage({ kind: "get-outbox" }).then(
      unlessCancelled(({ pending }) => setPending(pending)),
    );
    void sendRuntimeMessage({ kind: "get-backend-url" }).then(
      unlessCancelled(({ baseUrl }) => setBaseUrl(baseUrl)),
    );
    // Fresh rather than cached: opening the popup is when someone who just
    // changed a setting in the dashboard looks for it to have applied.
    void sendRuntimeMessage({ kind: "refresh-extension-config" }).then(
      unlessCancelled(setConfig),
    );
    void sendRuntimeMessage({ kind: "get-recent-reading" }).then(
      unlessCancelled((result) => setRecent(result.ok ? result.data : [])),
    );
    void pausedItem.getValue().then(unlessCancelled(setPaused));
    void dismissedNoticesItem.getValue().then(unlessCancelled(setDismissed));
    void readActiveTab().then(
      unlessCancelled((active) => {
        setTab(active);
        void readSiteState(active).then(unlessCancelled(setSite));
      }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const tabId = tab?.id;
  const refreshEntry = useCallback(async () => {
    if (tabId === undefined) {
      return;
    }
    setEntry(await sendRuntimeMessage({ kind: "get-detection", tabId }));
  }, [tabId]);

  useEffect(() => {
    void refreshEntry();
    const timer = window.setInterval(
      () => void refreshEntry(),
      ENTRY_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, [refreshEntry]);

  async function togglePause(): Promise<void> {
    const next = !paused;
    await pausedItem.setValue(next);
    setPaused(next);
  }

  async function closeNotice(id: string): Promise<void> {
    await dismissNotice(id);
    setDismissed(await dismissedNoticesItem.getValue());
  }

  const outdated =
    config !== null &&
    isOlderThan(
      browser.runtime.getManifest().version,
      config.minExtensionVersion,
    );
  const notices = (config?.notices ?? []).filter(
    (notice) => !dismissed.includes(notice.id),
  );

  if (view === "manual" && tab) {
    return (
      <main className="popup">
        <ManualView
          tab={tab}
          entry={entry}
          onDone={() => {
            void refreshEntry();
            setView("main");
          }}
          onBack={() => setView("main")}
        />
      </main>
    );
  }
  if (view === "sites") {
    return (
      <main className="popup">
        <SitesView
          currentHost={tab?.host ?? null}
          onBack={() => {
            void readSiteState(tab ?? null).then(setSite);
            setView("main");
          }}
        />
      </main>
    );
  }
  if (view === "settings") {
    return (
      <main className="popup">
        <SettingsView
          paused={paused}
          baseUrl={baseUrl}
          onTogglePause={() => void togglePause()}
          onBack={() => setView("main")}
        />
      </main>
    );
  }

  return (
    <main className="popup">
      <Header
        connection={connection}
        paused={paused}
        onTogglePause={() => void togglePause()}
      />
      <Notices
        notices={notices}
        outdated={outdated}
        pending={pending}
        onDismiss={(id) => void closeNotice(id)}
      />
      <NowCard
        tab={tab}
        site={site}
        entry={entry}
        baseUrl={baseUrl}
        connected={connection.kind === "connected"}
        onManual={() => setView("manual")}
      />
      <ContinueReading
        // The manga on this page is already the card above.
        entries={
          recent?.filter(
            (manga) =>
              entry?.delivery?.status !== "sent" ||
              manga.id !== entry.delivery.mangaId,
          ) ?? null
        }
        baseUrl={baseUrl}
      />
      <SiteCard
        site={site}
        theme={entry?.facts?.theme ?? null}
        connected={connection.kind === "connected"}
        onChange={setSite}
      />
      <Footer
        baseUrl={baseUrl}
        onSites={() => setView("sites")}
        onSettings={() => setView("settings")}
      />
    </main>
  );
}
