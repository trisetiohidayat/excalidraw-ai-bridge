import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ActivityActor, ActivityEvent, ActivityType, BridgeCommand, BridgeEvent, BridgeScene, SceneElement } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
export const CURRENT_SCENE_PATH = path.join(DATA_DIR, "current.excalidraw");
export const ACTIVITY_LOG_PATH = path.join(DATA_DIR, "activity.jsonl");

export function createEmptyScene(): BridgeScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-ai-bridge",
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
    files: {},
  };
}

export function createTextElement(text: string, x: number, y: number, fontSize = 28): SceneElement {
  const longestLine = Math.max(...text.split("\n").map((line) => line.length));
  const width = Math.max(120, Math.ceil(longestLine * fontSize * 0.78));
  const lineCount = text.split("\n").length;
  return {
    id: `text_${crypto.randomUUID().slice(0, 8)}`,
    type: "text",
    x,
    y,
    width,
    height: Math.ceil(fontSize * 1.25 * lineCount),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text,
    fontSize,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    baseline: Math.ceil(fontSize * 0.95),
    containerId: null,
    originalText: text,
    lineHeight: 1.25,
  };
}

export function createBoxElement(
  text: string,
  x: number,
  y: number,
  width = 220,
  height = 96,
  backgroundColor = "#dbe4ff",
): SceneElement[] {
  const boxId = `box_${crypto.randomUUID().slice(0, 8)}`;
  const textElement = createTextElement(text, x + 18, y + Math.max(18, (height - 30) / 2), 22);
  textElement.width = Math.max(80, width - 36);
  textElement.height = Math.max(28, height - 28);
  return [
    {
      id: boxId,
      type: "rectangle",
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: "#2563eb",
      backgroundColor,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 3 },
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    },
    textElement,
  ];
}

export function createArrowElement(
  x: number,
  y: number,
  width: number,
  height: number,
  label?: string,
): SceneElement[] {
  const arrow: SceneElement = {
    id: `arrow_${crypto.randomUUID().slice(0, 8)}`,
    type: "arrow",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: Math.floor(Math.random() * 100000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 100000),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: [
      [0, 0],
      [width, height],
    ],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
  };
  if (!label) return [arrow];
  return [arrow, createTextElement(label, x + width / 2 - label.length * 5, y + height / 2 - 24, 18)];
}

export function createCursorElement(x: number, y: number, label = "AI"): SceneElement[] {
  return [
    {
      id: "__ai_cursor_pointer",
      type: "diamond",
      x,
      y,
      width: 22,
      height: 22,
      angle: 0,
      strokeColor: "#f59e0b",
      backgroundColor: "#fff3bf",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 91531,
      version: 1,
      versionNonce: 91357,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    },
    {
      ...createTextElement(label, x + 28, y - 2, 18),
      id: "__ai_cursor_label",
      strokeColor: "#7c2d12",
    },
  ];
}

export function stripCursor(elements: SceneElement[]): SceneElement[] {
  return elements.filter((el) => !String(el.id).startsWith("__ai_cursor_"));
}

export class SceneStore {
  private scene: BridgeScene = createEmptyScene();
  private activities: ActivityEvent[] = [];
  private sceneVersion = 0;
  private activitySeq = 0;
  private browserAppliedVersion = 0;
  private aiSeenVersion = 0;
  private aiSeenActivitySeq = 0;
  private lastAiReadUserSeq = 0;
  private lastAiMutationVersion = 0;
  private lastCommand = "load";
  private lastMutationAt: string | null = null;
  private lastBrowserAppliedAt: string | null = null;
  private lastAiAppliedAt: string | null = null;
  private lastAiSeenAt: string | null = null;

  async load(): Promise<BridgeScene> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await this.loadActivities();
    try {
      const raw = await fs.readFile(CURRENT_SCENE_PATH, "utf-8");
      this.scene = normalizeScene(JSON.parse(raw));
      this.sceneVersion = this.scene.elements.length > 0 ? 1 : 0;
      this.lastCommand = "load";
      this.lastMutationAt = this.sceneVersion > 0 ? new Date().toISOString() : null;
      if (this.sceneVersion > 0 && this.activities.length === 0) {
        await this.appendActivities([this.createActivity("system", "scene_loaded", "Loaded current Excalidraw scene", [], {})]);
      }
    } catch {
      this.scene = createEmptyScene();
      this.sceneVersion = 0;
      await this.save();
    }
    return this.get();
  }

  get(): BridgeScene {
    return structuredClone(this.scene);
  }

  getActivities(limit = 50): ActivityEvent[] {
    return structuredClone(this.activities.slice(-Math.max(1, limit)));
  }

  getRealtime() {
    const lastUserActivity = this.findLastActivityByActor("user");
    const lastAiActivity = this.findLastActivityByActor("ai");
    const latestAiSeq = lastAiActivity?.seq ?? 0;
    const unreadUserChanges = this.activities.filter((activity) => activity.actor === "user" && activity.seq > this.lastAiReadUserSeq).length;
    const pendingAiApply = this.lastAiMutationVersion > this.browserAppliedVersion ? this.lastAiMutationVersion - this.browserAppliedVersion : 0;
    return {
      sceneVersion: this.sceneVersion,
      activitySeq: this.activitySeq,
      latestSeq: this.activitySeq,
      latestAiSeq,
      browserAppliedVersion: this.browserAppliedVersion,
      aiSeenVersion: this.aiSeenVersion,
      aiSeenActivitySeq: this.aiSeenActivitySeq,
      lastAiReadUserSeq: this.lastAiReadUserSeq,
      unreadUserChanges,
      pendingAiApply,
      unreadChanges: Math.max(0, this.sceneVersion - this.aiSeenVersion),
      unreadActivities: unreadUserChanges,
      pendingBrowserApply: Math.max(0, this.sceneVersion - this.browserAppliedVersion),
      lastActivity: this.activities.at(-1) ?? null,
      lastUserActivity,
      lastAiActivity,
      lastCommand: this.lastCommand,
      lastMutationAt: this.lastMutationAt,
      lastBrowserAppliedAt: this.lastBrowserAppliedAt,
      lastAiAppliedAt: this.lastAiAppliedAt,
      lastAiSeenAt: this.lastAiSeenAt,
    };
  }

  markBrowserApplied(version: number): ReturnType<SceneStore["getRealtime"]> {
    if (Number.isFinite(version)) {
      this.browserAppliedVersion = Math.max(this.browserAppliedVersion, Math.min(Math.floor(version), this.sceneVersion));
      this.lastBrowserAppliedAt = new Date().toISOString();
      if (this.lastAiMutationVersion > 0 && this.browserAppliedVersion >= this.lastAiMutationVersion) {
        this.lastAiAppliedAt = this.lastBrowserAppliedAt;
      }
    }
    return this.getRealtime();
  }

  markAiSeen(version = this.sceneVersion): ReturnType<SceneStore["getRealtime"]> {
    if (Number.isFinite(version)) {
      this.aiSeenVersion = Math.max(this.aiSeenVersion, Math.min(Math.floor(version), this.sceneVersion));
      this.aiSeenActivitySeq = this.activitySeq;
      this.lastAiReadUserSeq = this.latestUserSeq();
      this.lastAiSeenAt = new Date().toISOString();
    }
    return this.getRealtime();
  }

  async save(filePath = CURRENT_SCENE_PATH): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.scene, null, 2));
  }

  async loadFromFile(filePath: string): Promise<BridgeScene> {
    const raw = await fs.readFile(filePath, "utf-8");
    this.scene = normalizeScene(JSON.parse(raw));
    await this.save();
    return this.get();
  }

  async apply(command: BridgeCommand, actor: ActivityActor = "system"): Promise<BridgeEvent> {
    const previousScene = this.get();
    let changed = true;
    let activities: ActivityEvent[] = [];
    if (command.type === "replace_scene") {
      this.scene = normalizeScene(command.scene);
      activities = [this.createActivity(actor, "scene_replaced", `Replaced scene with ${this.scene.elements.length} elements`, [], {})];
    } else if (command.type === "set_scene") {
      if (
        !command.force
        && command.elements.length === 0
        && this.scene.elements.length > 0
        && command.baseVersion !== this.sceneVersion
      ) {
        changed = false;
      } else {
        const nextScene = normalizeScene({
          ...this.scene,
          elements: command.elements,
          appState: command.appState ?? this.scene.appState,
          files: command.files ?? this.scene.files,
        });
        changed =
          !sameJson(this.scene.elements, nextScene.elements)
          || !sameJson(this.scene.appState, nextScene.appState)
          || !sameJson(this.scene.files, nextScene.files);
        activities = this.describeSceneDiff(previousScene, nextScene, actor);
        this.scene = nextScene;
      }
    } else if (command.type === "add_elements") {
      this.scene.elements = [...this.scene.elements, ...command.elements];
      activities = [this.createActivity(
        actor,
        "elements_added",
        `${actor === "ai" ? "AI added" : "Added"} ${command.elements.length} element${command.elements.length === 1 ? "" : "s"}`,
        command.elements.map((element) => element.id),
        { count: command.elements.length },
      )];
    } else if (command.type === "clear_scene") {
      this.scene = createEmptyScene();
      activities = [this.createActivity(actor, "scene_cleared", "Cleared scene", [], {})];
    } else if (command.type === "move_cursor") {
      this.scene.elements = command.visible === false
        ? stripCursor(this.scene.elements)
        : [...stripCursor(this.scene.elements), ...createCursorElement(command.x, command.y, command.label)];
      activities = [this.createActivity(
        actor,
        "cursor_moved",
        command.visible === false ? "AI cursor hidden" : `AI cursor moved to ${Math.round(command.x)}, ${Math.round(command.y)}`,
        [],
        { x: command.x, y: command.y, label: command.label, visible: command.visible },
      )];
    }
    if (changed) {
      this.bumpVersion(command.type);
      if (actor === "ai") {
        this.lastAiMutationVersion = this.sceneVersion;
      }
    }
    if (changed || activities.length > 0) {
      activities = activities.map((activity) => ({ ...activity, sceneVersion: this.sceneVersion }));
      await this.appendActivities(activities);
      await this.save();
    }
    return {
      id: crypto.randomUUID(),
      command,
      scene: this.get(),
      timestamp: new Date().toISOString(),
      ...this.getRealtime(),
    };
  }

  private bumpVersion(command: string): void {
    this.sceneVersion += 1;
    this.lastCommand = command;
    this.lastMutationAt = new Date().toISOString();
  }

  private async loadActivities(): Promise<void> {
    try {
      const raw = await fs.readFile(ACTIVITY_LOG_PATH, "utf-8");
      this.activities = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => normalizeActivity(JSON.parse(line)));
      this.activitySeq = this.activities.reduce((max, activity) => Math.max(max, activity.seq), 0);
      this.aiSeenActivitySeq = Math.min(this.aiSeenActivitySeq, this.activitySeq);
      this.lastAiReadUserSeq = Math.min(this.lastAiReadUserSeq, this.latestUserSeq());
    } catch {
      this.activities = [];
      this.activitySeq = 0;
    }
  }

  private async appendActivities(activities: ActivityEvent[]): Promise<void> {
    if (activities.length === 0) return;
    await fs.mkdir(DATA_DIR, { recursive: true });
    const normalized = activities.map((activity) => ({
      ...activity,
      actor: activity.actor ?? "system",
      seq: ++this.activitySeq,
      createdAt: activity.createdAt || new Date().toISOString(),
    }));
    this.activities.push(...normalized);
    const lines = normalized.map((activity) => JSON.stringify(activity)).join("\n") + "\n";
    await fs.appendFile(ACTIVITY_LOG_PATH, lines);
  }

  private createActivity(
    actor: ActivityActor,
    type: ActivityType,
    summary: string,
    elementIds: string[],
    payload: Record<string, unknown>,
  ): ActivityEvent {
    return {
      id: crypto.randomUUID(),
      seq: 0,
      actor,
      type,
      summary,
      sceneVersion: this.sceneVersion,
      elementIds,
      payload,
      createdAt: new Date().toISOString(),
    };
  }

  private describeSceneDiff(previous: BridgeScene, next: BridgeScene, actor: ActivityActor): ActivityEvent[] {
    const previousElements = new Map(previous.elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]));
    const nextElements = new Map(next.elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]));
    const activities: ActivityEvent[] = [];

    const added = [...nextElements.values()].filter((element) => !previousElements.has(element.id));
    if (added.length > 0) {
      activities.push(this.createActivity(
        actor,
        "elements_added",
        `Added ${added.length} element${added.length === 1 ? "" : "s"}${labelForElement(added[0])}`,
        added.map((element) => element.id),
        { count: added.length, sample: summarizeElement(added[0]) },
      ));
    }

    const deleted = [...previousElements.values()].filter((element) => !nextElements.has(element.id));
    if (deleted.length > 0) {
      activities.push(this.createActivity(
        actor,
        "elements_deleted",
        `Deleted ${deleted.length} element${deleted.length === 1 ? "" : "s"}${labelForElement(deleted[0])}`,
        deleted.map((element) => element.id),
        { count: deleted.length, sample: summarizeElement(deleted[0]) },
      ));
    }

    for (const [id, nextElement] of nextElements) {
      const previousElement = previousElements.get(id);
      if (!previousElement) continue;

      if (String(previousElement.text ?? "") !== String(nextElement.text ?? "")) {
        activities.push(this.createActivity(
          actor,
          "text_changed",
          `Changed text from "${truncate(String(previousElement.text ?? ""), 40)}" to "${truncate(String(nextElement.text ?? ""), 40)}"`,
          [id],
          { before: previousElement.text ?? "", after: nextElement.text ?? "" },
        ));
        continue;
      }

      const styleChanges = diffStyle(previousElement, nextElement);
      if (Object.keys(styleChanges).length > 0) {
        activities.push(this.createActivity(
          actor,
          "style_changed",
          `Changed style${labelForElement(nextElement)}: ${Object.keys(styleChanges).join(", ")}`,
          [id],
          { changes: styleChanges },
        ));
        continue;
      }

      if (previousElement.x !== nextElement.x || previousElement.y !== nextElement.y) {
        activities.push(this.createActivity(
          actor,
          "element_moved",
          `Moved ${nextElement.type}${labelForElement(nextElement)} to ${Math.round(nextElement.x)}, ${Math.round(nextElement.y)}`,
          [id],
          { before: { x: previousElement.x, y: previousElement.y }, after: { x: nextElement.x, y: nextElement.y } },
        ));
        continue;
      }

      if (previousElement.width !== nextElement.width || previousElement.height !== nextElement.height) {
        activities.push(this.createActivity(
          actor,
          "element_resized",
          `Resized ${nextElement.type}${labelForElement(nextElement)} to ${Math.round(nextElement.width)}x${Math.round(nextElement.height)}`,
          [id],
          { before: { width: previousElement.width, height: previousElement.height }, after: { width: nextElement.width, height: nextElement.height } },
        ));
      }
    }

    return activities.slice(0, 12);
  }

  private latestUserSeq(): number {
    return this.findLastActivityByActor("user")?.seq ?? 0;
  }

  private findLastActivityByActor(actor: ActivityActor): ActivityEvent | null {
    for (let index = this.activities.length - 1; index >= 0; index -= 1) {
      if (this.activities[index]?.actor === actor) return this.activities[index];
    }
    return null;
  }
}

function normalizeActivity(value: unknown): ActivityEvent {
  const activity = value as Partial<ActivityEvent>;
  return {
    id: typeof activity.id === "string" ? activity.id : crypto.randomUUID(),
    seq: typeof activity.seq === "number" ? activity.seq : 0,
    actor: normalizeActor(activity.actor, activity),
    type: activity.type as ActivityType,
    summary: typeof activity.summary === "string" ? activity.summary : String(activity.type ?? "activity"),
    sceneVersion: typeof activity.sceneVersion === "number" ? activity.sceneVersion : 0,
    elementIds: Array.isArray(activity.elementIds) ? activity.elementIds.map(String) : [],
    payload: activity.payload && typeof activity.payload === "object" ? activity.payload as Record<string, unknown> : {},
    createdAt: typeof activity.createdAt === "string" ? activity.createdAt : new Date().toISOString(),
  };
}

function normalizeActor(actor: unknown, activity: Partial<ActivityEvent>): ActivityActor {
  if (actor === "user" || actor === "ai" || actor === "system") return actor;
  if (activity.type === "scene_loaded" || activity.type === "scene_synced") return "system";
  if (activity.type === "cursor_moved") return "ai";
  if (typeof activity.summary === "string" && activity.summary.startsWith("AI ")) return "ai";
  return "user";
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffStyle(previous: SceneElement, next: SceneElement): Record<string, { before: unknown; after: unknown }> {
  const keys = ["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "fontSize", "fontFamily", "textAlign"];
  return Object.fromEntries(keys
    .filter((key) => previous[key] !== next[key])
    .map((key) => [key, { before: previous[key], after: next[key] }]));
}

function summarizeElement(element: SceneElement | undefined): Record<string, unknown> | null {
  if (!element) return null;
  return {
    id: element.id,
    type: element.type,
    text: element.text,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function labelForElement(element: SceneElement | undefined): string {
  if (!element) return "";
  const text = typeof element.text === "string" && element.text.trim() ? ` "${truncate(element.text, 32)}"` : "";
  return ` (${element.type}${text})`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

export function normalizeScene(value: unknown): BridgeScene {
  const scene = value as Partial<BridgeScene>;
  const appState = scene.appState && typeof scene.appState === "object"
    ? { ...scene.appState }
    : createEmptyScene().appState;
  delete (appState as Record<string, unknown>).collaborators;

  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-ai-bridge",
    elements: Array.isArray(scene.elements) ? scene.elements.map(normalizeElement) : [],
    appState,
    files: scene.files && typeof scene.files === "object" ? scene.files : {},
  };
}

function normalizeElement(element: unknown): SceneElement {
  const normalized = { ...(element as SceneElement) };
  delete normalized.index;
  return normalized;
}
