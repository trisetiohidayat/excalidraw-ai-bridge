export type SceneElement = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BridgeScene = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type ActivityType =
  | "scene_loaded"
  | "scene_replaced"
  | "scene_cleared"
  | "elements_added"
  | "elements_deleted"
  | "text_changed"
  | "style_changed"
  | "element_moved"
  | "element_resized"
  | "cursor_moved"
  | "scene_synced";

export type ActivityActor = "user" | "ai" | "system";

export type ActivityEvent = {
  id: string;
  seq: number;
  actor: ActivityActor;
  type: ActivityType;
  summary: string;
  sceneVersion: number;
  elementIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
};

export type BridgeCommand =
  | { type: "replace_scene"; scene: BridgeScene }
  | {
    type: "set_scene";
    elements: SceneElement[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
    baseVersion?: number;
    force?: boolean;
  }
  | { type: "add_elements"; elements: SceneElement[] }
  | { type: "clear_scene" }
  | { type: "move_cursor"; x: number; y: number; label?: string; visible?: boolean };

export type BridgeRealtimeStatus = {
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

export type BridgeEvent = {
  id: string;
  command: BridgeCommand;
  scene: BridgeScene;
  timestamp: string;
  sceneVersion: number;
  browserAppliedVersion: number;
  aiSeenVersion: number;
};
