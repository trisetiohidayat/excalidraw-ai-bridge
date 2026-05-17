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

const HTTP_URL = "http://127.0.0.1:5174";
const DEFAULT_SCENE_PATH = "/Users/tri-mac/myproject/excalidraw-ai-bridge/data/current.excalidraw";

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
  const serverVersionRef = useRef(0);
  const lastSavedFingerprintRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error" | "offline">("saved");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [pathExpanded, setPathExpanded] = useState(false);

  const markTitle = useCallback((label: string) => {
    document.title = `${label} - Excalidraw AI Bridge`;
    setAutosaveState(label === "Saved" ? "saved" : label === "Saving" ? "saving" : label === "Offline" ? "offline" : "error");
  }, []);

  const applyScene = useCallback((scene: BridgeScene) => {
    const api = excalidrawApiRef.current;
    if (!api) {
      pendingSceneRef.current = scene;
      return;
    }
    api.updateScene({
      elements: scene.elements,
      appState: sanitizeAppState(scene.appState),
      files: safeFiles(scene.files),
    });
    loadedInitialSceneRef.current = true;
    lastSavedFingerprintRef.current = autosaveFingerprint(scene.elements, scene.files);
    markTitle("Saved");
  }, [markTitle]);

  const readCurrentScene = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api || !loadedInitialSceneRef.current) return null;
    const elements = typeof api.getSceneElements === "function" ? api.getSceneElements() : [];
    const appState = typeof api.getAppState === "function" ? api.getAppState() : {};
    const files = typeof api.getFiles === "function" ? api.getFiles() : {};
    return { elements, appState, files };
  }, []);

  const saveCurrentScene = useCallback((force = false) => {
    const draft = readCurrentScene();
    if (!draft) return;
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
      scheduleSave();
    };
    window.addEventListener("pointerdown", markPointerDown, true);
    window.addEventListener("pointerup", markPointerUp, true);
    window.addEventListener("pointercancel", markPointerUp, true);
    return () => {
      window.removeEventListener("pointerdown", markPointerDown, true);
      window.removeEventListener("pointerup", markPointerUp, true);
      window.removeEventListener("pointercancel", markPointerUp, true);
    };
  }, [scheduleSave]);

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
            <MainMenu.DefaultItems.Export />
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
      </div>
    </main>
  );
}
