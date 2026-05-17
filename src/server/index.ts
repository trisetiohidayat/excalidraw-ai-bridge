import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  createArrowElement,
  createBoxElement,
  createTextElement,
  SceneStore,
} from "./scene.js";
import type { ActivityActor, BridgeCommand, BridgeEvent, BridgeRealtimeStatus } from "./types.js";

const PORT = Number(process.env.BRIDGE_PORT ?? 5174);
const store = new SceneStore();
await store.load();
let pendingOps = 0;
let operationQueue: Promise<unknown> = Promise.resolve();

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  next();
});
app.options(/.*/, (_req, res) => {
  res.sendStatus(204);
});
app.use(express.json({ limit: "20mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(event: BridgeEvent): void {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

function getStatus(): BridgeRealtimeStatus {
  return {
    ok: true,
    clients: wss.clients.size,
    elements: store.get().elements.length,
    scenePath: path.resolve(process.cwd(), "data/current.excalidraw"),
    pendingOps,
    ...store.getRealtime(),
  };
}

function broadcastStatus(): void {
  const payload = JSON.stringify({
    id: "status",
    type: "status",
    status: getStatus(),
    timestamp: new Date().toISOString(),
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

async function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
  pendingOps += 1;
  const run = operationQueue.then(operation, operation);
  operationQueue = run.catch(() => undefined);
  try {
    return await run;
  } finally {
    pendingOps = Math.max(0, pendingOps - 1);
    broadcastStatus();
  }
}

async function applyAndBroadcast(command: BridgeCommand, options: { actor?: ActivityActor; markAiSeen?: boolean } = {}): Promise<BridgeEvent> {
  return enqueueOperation(async () => {
    const event = await store.apply(command, options.actor ?? "ai");
    if (options.markAiSeen) {
      store.markAiSeen(event.sceneVersion);
    }
    broadcast(event);
    broadcastStatus();
    return event;
  });
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({
    id: "initial",
    command: { type: "replace_scene", scene: store.get() },
    scene: store.get(),
    timestamp: new Date().toISOString(),
    ...store.getRealtime(),
  }));
  socket.send(JSON.stringify({
    id: "status",
    type: "status",
    status: getStatus(),
    timestamp: new Date().toISOString(),
  }));

  socket.on("message", (message) => {
    try {
      const payload = JSON.parse(String(message));
      if (payload?.type === "browser_applied") {
        store.markBrowserApplied(Number(payload.sceneVersion));
        broadcastStatus();
      }
    } catch {
      // Ignore malformed browser telemetry; scene mutation still goes through REST.
    }
  });
});

app.get("/api/status", (_req, res) => {
  res.json(getStatus());
});

app.get("/api/scene", (_req, res) => {
  res.json(store.get());
});

app.post("/api/canvas/read", (_req, res) => {
  const scene = store.get();
  const activity = store.getActivities(20);
  const status = store.markAiSeen();
  broadcastStatus();
  res.json({ ok: true, scene, activity, ...status });
});

app.get("/api/activity", (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({
    ok: true,
    activity: store.getActivities(Number.isFinite(limit) ? limit : 50),
    ...store.getRealtime(),
  });
});

app.post("/api/scene/replace", async (req, res, next) => {
  try {
    const event = await applyAndBroadcast({ type: "replace_scene", scene: req.body }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/scene/sync", async (req, res, next) => {
  try {
    const requestedElementCount = Array.isArray(req.body.elements) ? req.body.elements.length : 0;
    const event = await enqueueOperation(() => store.apply({
      type: "set_scene",
      elements: req.body.elements ?? [],
      appState: req.body.appState ?? {},
      files: req.body.files ?? {},
      baseVersion: typeof req.body.baseVersion === "number" ? req.body.baseVersion : undefined,
      force: Boolean(req.body.force),
    }, "user"));
    if (event.scene.elements.length === requestedElementCount) {
      store.markBrowserApplied(event.sceneVersion);
    }
    broadcastStatus();
    res.json({ ok: true, id: event.id, elements: event.scene.elements.length, ...store.getRealtime(), pendingOps });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scene/clear", async (_req, res, next) => {
  try {
    const event = await applyAndBroadcast({ type: "clear_scene" }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/elements", async (req, res, next) => {
  try {
    const event = await applyAndBroadcast({ type: "add_elements", elements: req.body.elements ?? [] }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/text", async (req, res, next) => {
  try {
    const { text, x = 120, y = 120, fontSize = 28 } = req.body;
    const event = await applyAndBroadcast({
      type: "add_elements",
      elements: [createTextElement(String(text), Number(x), Number(y), Number(fontSize))],
    }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/box", async (req, res, next) => {
  try {
    const { text, x = 120, y = 120, width = 220, height = 96, backgroundColor = "#dbe4ff" } = req.body;
    const event = await applyAndBroadcast({
      type: "add_elements",
      elements: createBoxElement(String(text), Number(x), Number(y), Number(width), Number(height), String(backgroundColor)),
    }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/arrow", async (req, res, next) => {
  try {
    const { x = 120, y = 120, width = 160, height = 0, label } = req.body;
    const event = await applyAndBroadcast({
      type: "add_elements",
      elements: createArrowElement(Number(x), Number(y), Number(width), Number(height), label ? String(label) : undefined),
    }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/cursor", async (req, res, next) => {
  try {
    const { x = 120, y = 120, label = "AI", visible = true } = req.body;
    const event = await applyAndBroadcast({
      type: "move_cursor",
      x: Number(x),
      y: Number(y),
      label: String(label),
      visible: Boolean(visible),
    }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/file/load", async (req, res, next) => {
  try {
    const scene = await store.loadFromFile(String(req.body.path));
    const event = await applyAndBroadcast({ type: "replace_scene", scene }, { actor: "ai", markAiSeen: true });
    res.json(event);
  } catch (error) {
    next(error);
  }
});

app.post("/api/browser/applied", (req, res) => {
  const status = store.markBrowserApplied(Number(req.body.sceneVersion));
  broadcastStatus();
  res.json({ ok: true, ...status });
});

app.post("/api/ai/seen", (req, res) => {
  const status = store.markAiSeen(typeof req.body.version === "number" ? req.body.version : undefined);
  broadcastStatus();
  res.json({ ok: true, ...status });
});

app.post("/api/file/save", async (req, res, next) => {
  try {
    const filePath = String(req.body.path);
    await store.save(filePath);
    res.json({ ok: true, path: filePath });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Excalidraw AI bridge listening on http://127.0.0.1:${PORT}`);
});
