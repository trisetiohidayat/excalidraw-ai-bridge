import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeScene = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: readonly any[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

type BridgeEvent = {
  id: string;
  command: { type: string };
  scene: BridgeScene;
  timestamp: string;
  sceneVersion: number;
  browserAppliedVersion: number;
  aiSeenVersion: number;
};

type ActivityEvent = {
  id: string;
  seq: number;
  actor: "user" | "ai" | "system";
  type: string;
  summary: string;
  sceneVersion: number;
  elementIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
};

type BridgeStatus = {
  ok: true;
  clients: number;
  elements: number;
  scenePath: string;
  sceneVersion: number;
  browserAppliedVersion: number;
  aiSeenVersion: number;
  latestSeq: number;
  latestAiSeq: number;
  lastAiReadUserSeq: number;
  unreadUserChanges: number;
  pendingAiApply: number;
  unreadChanges: number;
  pendingBrowserApply: number;
  pendingOps: number;
  activitySeq: number;
  aiSeenActivitySeq: number;
  unreadActivities: number;
  lastActivity: ActivityEvent | null;
  lastUserActivity: ActivityEvent | null;
  lastAiActivity: ActivityEvent | null;
  lastCommand: string;
  lastMutationAt: string | null;
  lastBrowserAppliedAt: string | null;
  lastAiAppliedAt: string | null;
  lastAiSeenAt: string | null;
};

type BridgeStatusMessage = {
  id: "status";
  type: "status";
  status: BridgeStatus;
  timestamp: string;
};

const HTTP_URL = "http://127.0.0.1:5174";
const WS_URL = "ws://127.0.0.1:5174/ws";

function sanitizeAppState(appState: any): Record<string, unknown> {
  if (!appState || typeof appState !== "object") return {};
  const { collaborators: _collaborators, ...safeAppState } = appState;
  return safeAppState;
}

function safeFiles(files: any): Record<string, unknown> {
  return files && typeof files === "object" ? files : {};
}

export default function App() {
  const excalidrawApiRef = useRef<any>(null);
  const pendingSceneRef = useRef<{ scene: BridgeScene; sceneVersion?: number } | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const serverVersionRef = useRef(0);
  const applyingRemoteSceneRef = useRef(false);
  const hasLoadedInitialSceneRef = useRef(false);
  const connectedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [serverUp, setServerUp] = useState(false);
  const [lastEvent, setLastEvent] = useState<BridgeEvent | null>(null);
  const [elementCount, setElementCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hudOpen, setHudOpen] = useState(false);
  const [lastSync, setLastSync] = useState<string>("never");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);

  const acknowledgeBrowserApplied = useCallback((sceneVersion: number) => {
    if (!Number.isFinite(sceneVersion) || sceneVersion <= 0) return;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "browser_applied", sceneVersion }));
      return;
    }
    fetch(`${HTTP_URL}/api/browser/applied`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sceneVersion }),
    }).catch(() => undefined);
  }, []);

  const applyScene = useCallback((scene: BridgeScene, sceneVersion?: number): boolean => {
    const api = excalidrawApiRef.current;
    if (!api) {
      pendingSceneRef.current = { scene, sceneVersion };
      return false;
    }
    applyingRemoteSceneRef.current = true;
    try {
      api.updateScene({
        elements: scene.elements,
        appState: sanitizeAppState(scene.appState),
        files: safeFiles(scene.files),
      });
      setElementCount(scene.elements.length);
      hasLoadedInitialSceneRef.current = true;
      if (typeof sceneVersion === "number") {
        serverVersionRef.current = sceneVersion;
        acknowledgeBrowserApplied(sceneVersion);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      window.setTimeout(() => {
        applyingRemoteSceneRef.current = false;
      }, 800);
    }
  }, [acknowledgeBrowserApplied]);

  const postSceneSync = useCallback((elements: readonly any[], appState: any, files: any, options: { force?: boolean } = {}) => {
    let body: string;
    try {
      body = JSON.stringify({
        elements,
        appState: sanitizeAppState(appState),
        files: safeFiles(files),
        baseVersion: serverVersionRef.current,
        force: Boolean(options.force),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    fetch(`${HTTP_URL}/api/scene/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<Partial<BridgeStatus>>;
      })
      .then((status) => {
        if (typeof status.sceneVersion === "number") {
          serverVersionRef.current = status.sceneVersion;
          setBridgeStatus((current) => current ? { ...current, ...status } as BridgeStatus : current);
        }
        setLastSync(new Date().toLocaleTimeString());
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const syncBrowserScene = useCallback((elements: readonly any[], appState: any, files: any) => {
    if (applyingRemoteSceneRef.current) return;
    if (!hasLoadedInitialSceneRef.current && elements.length === 0) return;
    setElementCount(elements.length);
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      postSceneSync(elements, appState, files);
    }, 500);
  }, [postSceneSync]);

  const syncNow = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    const elements = typeof api.getSceneElements === "function" ? api.getSceneElements() : [];
    const appState = typeof api.getAppState === "function" ? api.getAppState() : {};
    const files = typeof api.getFiles === "function" ? api.getFiles() : {};
    setElementCount(elements.length);
    postSceneSync(elements, appState, files, { force: true });
  }, [postSceneSync]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialScene() {
      if (connectedRef.current && hasLoadedInitialSceneRef.current) return;
      try {
        const res = await fetch(`${HTTP_URL}/api/scene`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const scene = await res.json() as BridgeScene;
          if (!cancelled) {
            setServerUp(true);
          applyScene(scene);
        }
      } catch (err) {
        if (!cancelled) {
          setServerUp(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    loadInitialScene();
    const interval = window.setInterval(loadInitialScene, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyScene]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        connectedRef.current = true;
        setConnected(true);
        setServerUp(true);
        setError(null);
      });
      socket.addEventListener("close", () => {
        connectedRef.current = false;
        setConnected(false);
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      });
      socket.addEventListener("error", () => {
        connectedRef.current = false;
        setConnected(false);
      });
      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as BridgeEvent | BridgeStatusMessage;
          const statusEvent = event as BridgeStatusMessage;
          if (statusEvent.type === "status") {
            serverVersionRef.current = statusEvent.status.sceneVersion;
            setBridgeStatus(statusEvent.status);
            setElementCount(statusEvent.status.elements);
            return;
          }
          const sceneEvent = event as BridgeEvent;
          setLastEvent(sceneEvent);
          serverVersionRef.current = sceneEvent.sceneVersion;
          applyScene(sceneEvent.scene, sceneEvent.sceneVersion);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [applyScene]);

  const statusText = useMemo(() => {
    if (connected) return "live";
    if (serverUp) return "polling";
    return "offline";
  }, [connected, serverUp]);

  const aiReadText = useMemo(() => {
    if (!bridgeStatus) return "unknown";
    if (bridgeStatus.unreadUserChanges === 0) return `saw user #${bridgeStatus.lastAiReadUserSeq}`;
    return `${bridgeStatus.unreadUserChanges} user changes`;
  }, [bridgeStatus]);

  const browserApplyText = useMemo(() => {
    if (!bridgeStatus) return "unknown";
    if (bridgeStatus.pendingAiApply === 0) return `applied v${bridgeStatus.browserAppliedVersion}`;
    return `${bridgeStatus.pendingAiApply} AI pending`;
  }, [bridgeStatus]);

  return (
    <main className="bridge-shell">
      <section className="stage">
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawApiRef.current = api;
            const pending = pendingSceneRef.current;
            if (pending) {
              pendingSceneRef.current = null;
              window.setTimeout(() => {
                applyScene(pending.scene, pending.sceneVersion);
              }, 0);
            }
          }}
          onChange={(elements, appState, files) => {
            syncBrowserScene(elements, appState, files);
          }}
          initialData={{
            appState: {
              viewBackgroundColor: "#fbfbf7",
            },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </section>

      {!hudOpen ? (
        <button
          className="hud-button"
          type="button"
          aria-label="Open AI Bridge status"
          onClick={() => setHudOpen(true)}
        >
          <span className={`dot dot--${statusText}`} />
          <span>AI</span>
          <span className={`hud-button__read ${bridgeStatus?.unreadUserChanges ? "hud-button__read--unread" : ""}`}>
            {bridgeStatus?.unreadUserChanges ? `${bridgeStatus.unreadUserChanges} user changes` : "seen"}
          </span>
        </button>
      ) : null}

      <aside className={`hud ${hudOpen ? "hud--open" : "hud--closed"}`} aria-label="Bridge status">
        <div className="hud__header">
          <span className={`dot dot--${statusText}`} />
          <div>
            <strong>AI Bridge</strong>
            <span>{statusText}</span>
          </div>
          <button
            className="hud__minimize"
            type="button"
            aria-label="Minimize AI Bridge status"
            onClick={() => setHudOpen(false)}
          >
            -
          </button>
        </div>
        <dl>
          <div>
            <dt>Canvas</dt>
            <dd>{elementCount} elements</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>v{bridgeStatus?.sceneVersion ?? serverVersionRef.current}</dd>
          </div>
          <div>
            <dt>AI read</dt>
            <dd>{aiReadText}</dd>
          </div>
          <div>
            <dt>Last change</dt>
            <dd title={bridgeStatus?.lastActivity?.summary}>
              {bridgeStatus?.lastActivity ? `${bridgeStatus.lastActivity.actor}: ${bridgeStatus.lastActivity.summary}` : "none"}
            </dd>
          </div>
          <div>
            <dt>User changes</dt>
            <dd>{bridgeStatus?.unreadUserChanges ?? 0} unread</dd>
          </div>
          <div>
            <dt>Browser</dt>
            <dd>{browserApplyText}</dd>
          </div>
          <div>
            <dt>Last command</dt>
            <dd>{bridgeStatus?.lastCommand ?? lastEvent?.command.type ?? "none"}</dd>
          </div>
          <div>
            <dt>HTTP</dt>
            <dd>127.0.0.1:5174</dd>
          </div>
          <div>
            <dt>WebSocket</dt>
            <dd>{connected ? "connected" : "waiting"}</dd>
          </div>
          <div>
            <dt>Last sync</dt>
            <dd>{lastSync}</dd>
          </div>
        </dl>
        <button className="hud__sync" type="button" onClick={syncNow}>
          Sync now
        </button>
        {error ? <p className="error">{error}</p> : null}
      </aside>
    </main>
  );
}
