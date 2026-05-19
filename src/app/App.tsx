import {
  Excalidraw,
  MainMenu,
  exportToBlob,
  exportToClipboard,
  exportToSvg,
  getNonDeletedElements,
} from "@excalidraw/excalidraw";
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

type BridgeStatus = {
  ok: true;
  elements: number;
  scenePath: string;
  sceneVersion: number;
  unreadUserChanges: number;
  pendingAiApply: number;
  pendingOps: number;
  lastActivity: { actor: string; summary: string; createdAt: string } | null;
  lastAiActivity: { summary: string; createdAt: string } | null;
  lastCommand: string;
  lastMutationAt: string | null;
};

type BridgeEvent = {
  id: string;
  command: { type: string };
  scene: BridgeScene;
  timestamp: string;
  sceneVersion: number;
};

type BridgeStatusMessage = {
  id: "status";
  type: "status";
  status: BridgeStatus;
  timestamp: string;
};

const HTTP_URL = "http://127.0.0.1:5174";
const WS_URL = "ws://127.0.0.1:5174/ws";
const DEFAULT_SCENE_PATH = "/Users/tri-mac/myproject/excalidraw-ai-bridge/data/current.excalidraw";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampSlug() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:.]/g, "-");
}

function sanitizeAppState(appState: any): Record<string, unknown> {
  if (!appState || typeof appState !== "object") return {};
  const {
    activeTool: _activeTool,
    collaborators: _collaborators,
    contextMenu: _contextMenu,
    cursorButton: _cursorButton,
    editingFrame: _editingFrame,
    editingGroupId: _editingGroupId,
    editingLinearElement: _editingLinearElement,
    editingTextElement: _editingTextElement,
    elementsToHighlight: _elementsToHighlight,
    errorMessage: _errorMessage,
    frameToHighlight: _frameToHighlight,
    height: _height,
    hoveredElementIds: _hoveredElementIds,
    isCropping: _isCropping,
    isLoading: _isLoading,
    isResizing: _isResizing,
    isRotating: _isRotating,
    multiElement: _multiElement,
    newElement: _newElement,
    offsetLeft: _offsetLeft,
    offsetTop: _offsetTop,
    openDialog: _openDialog,
    openMenu: _openMenu,
    openPopup: _openPopup,
    openSidebar: _openSidebar,
    pasteDialog: _pasteDialog,
    pendingImageElementId: _pendingImageElementId,
    previousSelectedElementIds: _previousSelectedElementIds,
    resizingElement: _resizingElement,
    selectedElementIds: _selectedElementIds,
    selectedElementsAreBeingDragged: _selectedElementsAreBeingDragged,
    selectedGroupIds: _selectedGroupIds,
    selectedLinearElement: _selectedLinearElement,
    selectionElement: _selectionElement,
    shouldCacheIgnoreZoom: _shouldCacheIgnoreZoom,
    showHyperlinkPopup: _showHyperlinkPopup,
    snapLines: _snapLines,
    startBoundElement: _startBoundElement,
    suggestedBindings: _suggestedBindings,
    toast: _toast,
    userToFollow: _userToFollow,
    width: _width,
    ...safeAppState
  } = appState;
  return {
    ...safeAppState,
    viewModeEnabled: false,
    activeTool: { type: "selection", customType: null, locked: false, lastActiveTool: null },
    selectedElementIds: {},
    selectedGroupIds: {},
    editingTextElement: null,
    editingLinearElement: null,
    openDialog: null,
    openMenu: null,
    openPopup: null,
    openSidebar: null,
    showWelcomeScreen: false,
  };
}

function safeFiles(files: any): Record<string, unknown> {
  return files && typeof files === "object" ? files : {};
}

function autosaveFingerprint(elements: readonly any[], files: any): string {
  return JSON.stringify({
    elements: elements.map((element: any) => ({
      id: element.id,
      type: element.type,
      version: element.version,
      versionNonce: element.versionNonce,
      isDeleted: element.isDeleted,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      text: element.text,
      points: element.points,
      startBinding: element.startBinding,
      endBinding: element.endBinding,
      containerId: element.containerId,
      backgroundColor: element.backgroundColor,
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
      strokeStyle: element.strokeStyle,
      fillStyle: element.fillStyle,
      opacity: element.opacity,
    })),
    files: safeFiles(files),
  });
}

export default function App() {
  const excalidrawApiRef = useRef<any>(null);
  const pendingSceneRef = useRef<BridgeScene | null>(null);
  const loadedInitialSceneRef = useRef(false);
  const pointerDownRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveAgainRef = useRef(false);
  const applyingRemoteSceneRef = useRef(false);
  const queuedRemoteSceneRef = useRef<{ scene: BridgeScene; sceneVersion?: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const serverVersionRef = useRef(0);
  const lastSavedFingerprintRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error" | "offline">("saved");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [pathExpanded, setPathExpanded] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const markTitle = useCallback((label: string) => {
    document.title = `${label} - Excalidraw AI Bridge`;
    setAutosaveState(label === "Saved" ? "saved" : label === "Saving" ? "saving" : label === "Offline" ? "offline" : "error");
  }, []);

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

  const applyScene = useCallback((scene: BridgeScene, sceneVersion?: number) => {
    const api = excalidrawApiRef.current;
    if (!api) {
      pendingSceneRef.current = scene;
      return;
    }
    if (pointerDownRef.current) {
      queuedRemoteSceneRef.current = { scene, sceneVersion };
      return;
    }
    applyingRemoteSceneRef.current = true;
    api.updateScene({
      elements: scene.elements,
      appState: sanitizeAppState(scene.appState),
      files: safeFiles(scene.files),
    });
    loadedInitialSceneRef.current = true;
    lastSavedFingerprintRef.current = autosaveFingerprint(scene.elements, scene.files);
    if (typeof sceneVersion === "number") {
      serverVersionRef.current = sceneVersion;
      acknowledgeBrowserApplied(sceneVersion);
    }
    markTitle("Saved");
    window.setTimeout(() => {
      applyingRemoteSceneRef.current = false;
    }, 600);
  }, [acknowledgeBrowserApplied, markTitle]);

  const readCurrentScene = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api || !loadedInitialSceneRef.current) return null;
    const elements = typeof api.getSceneElements === "function" ? api.getSceneElements() : [];
    const appState = typeof api.getAppState === "function" ? api.getAppState() : {};
    const files = typeof api.getFiles === "function" ? api.getFiles() : {};
    return { elements, appState, files };
  }, []);

  const showToast = useCallback((message: string) => {
    excalidrawApiRef.current?.setToast?.({ message, closable: true, duration: 4000 });
  }, []);

  const getExportDraft = useCallback(() => {
    const draft = readCurrentScene();
    if (!draft) {
      showToast("Canvas belum siap untuk export.");
      return null;
    }
    const elements = getNonDeletedElements(draft.elements as any);
    if (!elements.length) {
      showToast("Canvas kosong, tidak ada elemen untuk diexport.");
      return null;
    }
    return {
      elements,
      appState: {
        ...sanitizeAppState(draft.appState),
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: (draft.appState as any)?.viewBackgroundColor ?? "#ffffff",
      },
      files: safeFiles(draft.files),
    };
  }, [readCurrentScene, showToast]);

  const exportAsPng = useCallback(async () => {
    const draft = getExportDraft();
    if (!draft) return;
    try {
      const blob = await exportToBlob({
        elements: draft.elements as any,
        appState: draft.appState as any,
        files: draft.files as any,
        mimeType: "image/png",
        exportPadding: 32,
      });
      downloadBlob(blob, `excalidraw-canvas-${timestampSlug()}.png`);
      showToast("Export PNG berhasil.");
    } catch {
      showToast("Export PNG gagal.");
    }
  }, [getExportDraft, showToast]);

  const exportAsSvg = useCallback(async () => {
    const draft = getExportDraft();
    if (!draft) return;
    try {
      const svg = await exportToSvg({
        elements: draft.elements as any,
        appState: draft.appState as any,
        files: draft.files as any,
        exportPadding: 32,
      });
      const source = new XMLSerializer().serializeToString(svg);
      downloadBlob(new Blob([source], { type: "image/svg+xml;charset=utf-8" }), `excalidraw-canvas-${timestampSlug()}.svg`);
      showToast("Export SVG berhasil.");
    } catch {
      showToast("Export SVG gagal.");
    }
  }, [getExportDraft, showToast]);

  const exportAsExcalidraw = useCallback(() => {
    const draft = readCurrentScene();
    if (!draft) {
      showToast("Canvas belum siap untuk export.");
      return;
    }
    const scene: BridgeScene = {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-ai-bridge",
      elements: draft.elements,
      appState: sanitizeAppState(draft.appState),
      files: safeFiles(draft.files),
    };
    downloadBlob(
      new Blob([JSON.stringify(scene, null, 2)], { type: "application/json;charset=utf-8" }),
      `excalidraw-scene-${timestampSlug()}.excalidraw`,
    );
    showToast("Export .excalidraw berhasil.");
  }, [readCurrentScene, showToast]);

  const copyPngToClipboard = useCallback(async () => {
    const draft = getExportDraft();
    if (!draft) return;
    try {
      await exportToClipboard({
        elements: draft.elements as any,
        appState: draft.appState as any,
        files: draft.files as any,
        type: "png",
        exportPadding: 32,
      });
      showToast("PNG sudah dicopy ke clipboard.");
    } catch {
      showToast("Copy PNG gagal. Browser mungkin tidak memberi izin clipboard.");
    }
  }, [getExportDraft, showToast]);

  const fitAllContent = useCallback(() => {
    const api = excalidrawApiRef.current;
    const draft = readCurrentScene();
    if (!api || !draft) return;
    const elements = getNonDeletedElements(draft.elements as any);
    if (!elements.length) {
      showToast("Canvas kosong.");
      return;
    }
    api.scrollToContent(elements, {
      fitToViewport: true,
      viewportZoomFactor: 0.9,
      animate: true,
    });
  }, [readCurrentScene, showToast]);

  const runExportAction = useCallback((action: () => void | Promise<void>) => {
    setExportDialogOpen(false);
    void action();
  }, []);

  const saveCurrentScene = useCallback((force = false) => {
    const draft = readCurrentScene();
    if (!draft) return;
    if (applyingRemoteSceneRef.current) return;
    const fingerprint = autosaveFingerprint(draft.elements, draft.files);
    if (!force && fingerprint === lastSavedFingerprintRef.current) {
      markTitle("Saved");
      return;
    }
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    saveAgainRef.current = false;
    markTitle("Saving");

    fetch(`${HTTP_URL}/api/scene/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        elements: draft.elements,
        appState: sanitizeAppState(draft.appState),
        files: safeFiles(draft.files),
        baseVersion: serverVersionRef.current,
        force,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((status) => {
        if (typeof status.sceneVersion === "number") {
          serverVersionRef.current = status.sceneVersion;
          setBridgeStatus((current) => current ? { ...current, ...status } : current);
        }
        lastSavedFingerprintRef.current = fingerprint;
        markTitle("Saved");
      })
      .catch(() => {
        markTitle("Save error");
      })
      .finally(() => {
        saveInFlightRef.current = false;
        if (saveAgainRef.current) {
          window.setTimeout(() => saveCurrentScene(true), 250);
        }
      });
  }, [markTitle, readCurrentScene]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      if (!pointerDownRef.current) {
        saveCurrentScene();
      }
    }, 700);
  }, [saveCurrentScene]);

  useEffect(() => {
    fetch(`${HTTP_URL}/api/scene`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<BridgeScene>;
      })
      .then((scene) => {
        applyScene(scene);
      })
      .catch(() => {
        loadedInitialSceneRef.current = true;
        markTitle("Offline");
      });
  }, [applyScene, markTitle]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setAutosaveState((state) => state === "offline" ? "saved" : state);
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      });
      socket.addEventListener("error", () => {
        setAutosaveState("offline");
      });
      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as BridgeEvent | BridgeStatusMessage;
          if ((event as BridgeStatusMessage).type === "status") {
            const status = (event as BridgeStatusMessage).status;
            setBridgeStatus(status);
            serverVersionRef.current = status.sceneVersion;
            return;
          }
          const sceneEvent = event as BridgeEvent;
          applyScene(sceneEvent.scene, sceneEvent.sceneVersion);
        } catch {
          setAutosaveState("error");
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

  useEffect(() => {
    let cancelled = false;
    const loadStatus = () => {
      fetch(`${HTTP_URL}/api/status`)
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return res.json() as Promise<BridgeStatus>;
        })
        .then((status) => {
          if (cancelled) return;
          setBridgeStatus(status);
          serverVersionRef.current = status.sceneVersion;
        })
        .catch(() => {
          if (!cancelled) setAutosaveState("offline");
        });
    };
    loadStatus();
    const interval = window.setInterval(loadStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const markPointerDown = () => {
      pointerDownRef.current = true;
    };
    const markPointerUp = () => {
      pointerDownRef.current = false;
      const queuedRemote = queuedRemoteSceneRef.current;
      if (queuedRemote) {
        queuedRemoteSceneRef.current = null;
        applyScene(queuedRemote.scene, queuedRemote.sceneVersion);
      } else {
        scheduleSave();
      }
    };
    window.addEventListener("pointerdown", markPointerDown, true);
    window.addEventListener("pointerup", markPointerUp, true);
    window.addEventListener("pointercancel", markPointerUp, true);
    return () => {
      window.removeEventListener("pointerdown", markPointerDown, true);
      window.removeEventListener("pointerup", markPointerUp, true);
      window.removeEventListener("pointercancel", markPointerUp, true);
    };
  }, [applyScene, scheduleSave]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!pointerDownRef.current) {
        saveCurrentScene();
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [saveCurrentScene]);

  useEffect(() => {
    const flushAutosave = () => {
      const draft = readCurrentScene();
      if (!draft) return;
      const blob = new Blob([JSON.stringify({
        elements: draft.elements,
        appState: sanitizeAppState(draft.appState),
        files: safeFiles(draft.files),
        baseVersion: serverVersionRef.current,
        force: true,
      })], { type: "application/json" });
      navigator.sendBeacon?.(`${HTTP_URL}/api/scene/sync`, blob);
    };
    window.addEventListener("pagehide", flushAutosave);
    window.addEventListener("beforeunload", flushAutosave);
    return () => {
      window.removeEventListener("pagehide", flushAutosave);
      window.removeEventListener("beforeunload", flushAutosave);
    };
  }, [readCurrentScene]);

  useEffect(() => {
    if (!exportDialogOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExportDialogOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [exportDialogOpen]);

  const autosaveText = useMemo(() => {
    if (autosaveState === "saving") return "Saving";
    if (autosaveState === "error") return "Save error";
    if (autosaveState === "offline") return "Offline";
    return "Saved";
  }, [autosaveState]);

  const aiStatusText = useMemo(() => {
    if (!bridgeStatus) return "AI status";
    if (bridgeStatus.pendingAiApply > 0) return `${bridgeStatus.pendingAiApply} pending`;
    if (bridgeStatus.unreadUserChanges > 0) return `${bridgeStatus.unreadUserChanges}`;
    return "Ready";
  }, [bridgeStatus]);

  const scenePath = bridgeStatus?.scenePath ?? DEFAULT_SCENE_PATH;
  const sceneFileName = scenePath.split("/").at(-1) ?? scenePath;

  return (
    <main className="bridge-shell">
      <section className="stage">
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawApiRef.current = api;
            if (pendingSceneRef.current) {
              const scene = pendingSceneRef.current;
              pendingSceneRef.current = null;
              window.setTimeout(() => applyScene(scene), 0);
            }
          }}
          initialData={{
            appState: {
              showWelcomeScreen: false,
              viewModeEnabled: false,
              viewBackgroundColor: "#fbfbf7",
            },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.Item onSelect={() => setExportDialogOpen(true)}>
              Export
            </MainMenu.Item>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </section>

      <div className="bridge-overlays" aria-hidden={false}>
        <div className={`save-chip save-chip--${autosaveState}`} title={bridgeStatus?.lastMutationAt ?? undefined}>
          <span className="save-chip__dot" />
          <span>{autosaveText}</span>
        </div>

        <button
          className={`ai-status-chip ${aiPanelOpen ? "ai-status-chip--open" : ""}`}
          type="button"
          aria-expanded={aiPanelOpen}
          aria-controls="ai-status-details"
          title={bridgeStatus?.lastActivity?.summary ?? "AI Bridge status"}
          onClick={() => setAiPanelOpen((open) => !open)}
        >
          <span className={`dot dot--${autosaveState === "offline" ? "offline" : bridgeStatus ? "live" : "polling"}`} />
          <span>AI</span>
          <strong aria-label="AI bridge status">{aiStatusText}</strong>
        </button>

        {aiPanelOpen ? (
          <aside id="ai-status-details" className="ai-status-panel" aria-label="AI Bridge details">
            <dl>
              <div>
                <dt>Elements</dt>
                <dd>{bridgeStatus?.elements ?? "-"}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>v{bridgeStatus?.sceneVersion ?? serverVersionRef.current}</dd>
              </div>
              <div>
                <dt>User changes</dt>
                <dd>{bridgeStatus?.unreadUserChanges ?? 0}</dd>
              </div>
              <div>
                <dt>AI pending</dt>
                <dd>{bridgeStatus?.pendingAiApply ?? 0}</dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>{bridgeStatus?.pendingOps ?? 0}</dd>
              </div>
              <div>
                <dt>Command</dt>
                <dd>{bridgeStatus?.lastCommand ?? "none"}</dd>
              </div>
              <div className="ai-status-panel__wide">
                <dt>Last</dt>
                <dd title={bridgeStatus?.lastActivity?.summary}>
                  {bridgeStatus?.lastActivity ? `${bridgeStatus.lastActivity.actor}: ${bridgeStatus.lastActivity.summary}` : "none"}
                </dd>
              </div>
            </dl>
          </aside>
        ) : null}

        <button
          className={`path-chip ${pathExpanded ? "path-chip--expanded" : ""}`}
          type="button"
          title={scenePath}
          onClick={() => setPathExpanded((expanded) => !expanded)}
        >
          <span>Path</span>
          <code>{pathExpanded ? scenePath : sceneFileName}</code>
        </button>

        {exportDialogOpen ? (
          <div
            className="export-dialog-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setExportDialogOpen(false);
              }
            }}
          >
            <section
              aria-labelledby="export-dialog-title"
              aria-modal="true"
              className="export-dialog"
              role="dialog"
            >
              <div className="export-dialog__header">
                <div>
                  <h2 id="export-dialog-title">Export Canvas</h2>
                  <p>Pilih format export untuk canvas saat ini.</p>
                </div>
                <button
                  aria-label="Close export dialog"
                  className="export-dialog__close"
                  type="button"
                  onClick={() => setExportDialogOpen(false)}
                >
                  X
                </button>
              </div>

              <div className="export-dialog__grid">
                <button type="button" onClick={() => runExportAction(exportAsPng)}>
                  <strong>PNG</strong>
                  <span>Image bitmap untuk share, dokumen, atau presentasi.</span>
                </button>
                <button type="button" onClick={() => runExportAction(exportAsSvg)}>
                  <strong>SVG</strong>
                  <span>Vector image yang tetap tajam saat diperbesar.</span>
                </button>
                <button type="button" onClick={() => runExportAction(exportAsExcalidraw)}>
                  <strong>.excalidraw</strong>
                  <span>Scene lengkap untuk dibuka lagi di Excalidraw.</span>
                </button>
              </div>

              <div className="export-dialog__footer">
                <button type="button" onClick={() => runExportAction(copyPngToClipboard)}>
                  Copy PNG
                </button>
                <button type="button" onClick={() => runExportAction(fitAllContent)}>
                  Zoom to Content
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
