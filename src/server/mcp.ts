import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { BridgeScene } from "./types.js";

const BRIDGE_URL = process.env.EXCALIDRAW_BRIDGE_URL ?? "http://127.0.0.1:5174";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return await res.json() as T;
}

async function waitForBrowserAck(targetVersion: number, timeoutMs = 3000): Promise<unknown> {
  const started = Date.now();
  let latest: any = null;
  while (Date.now() - started < timeoutMs) {
    latest = await request<any>("/api/status");
    if (latest.browserAppliedVersion >= targetVersion) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return latest ?? await request("/api/status");
}

async function commandRequest(path: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { waitForBrowserAck: shouldWait, ...body } = args;
  const event = await request<any>(path, { method: "POST", body: JSON.stringify(body) });
  if (shouldWait && typeof event.sceneVersion === "number") {
    const status = await waitForBrowserAck(event.sceneVersion);
    return { event, browserAck: status };
  }
  return event;
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

const server = new McpServer({
  name: "excalidraw-ai-bridge",
  version: "0.1.0",
});

server.registerTool(
  "excalidraw_bridge_status",
  {
    description: "Check whether the local Excalidraw AI bridge browser/server is reachable.",
    annotations: { readOnlyHint: true },
  },
  async () => textResult(await request("/api/status")),
);

server.registerTool(
  "excalidraw_get_scene",
  {
    description: "Read the current Excalidraw scene and recent semantic activity from the local bridge in one transaction, then mark user activity as seen by AI.",
    annotations: { readOnlyHint: true },
  },
  async () => textResult(await request("/api/canvas/read", { method: "POST", body: "{}" })),
);

server.registerTool(
  "excalidraw_get_activity",
  {
    description: "Read recent semantic activity events from the visible Excalidraw bridge canvas.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      limit: z.number().default(20),
      markSeen: z.boolean().default(true),
    },
  },
  async ({ limit, markSeen }) => {
    const activity = await request(`/api/activity?limit=${encodeURIComponent(String(limit))}`);
    if (markSeen) {
      await request("/api/ai/seen", { method: "POST", body: "{}" });
    }
    return textResult(activity);
  },
);

server.registerTool(
  "excalidraw_mark_ai_seen",
  {
    description: "Mark a scene version as read by AI so the visible bridge HUD can show read receipt status.",
    inputSchema: {
      version: z.number().optional().describe("Scene version to mark as seen. Defaults to the latest server scene version."),
    },
  },
  async (args) => textResult(await request("/api/ai/seen", { method: "POST", body: JSON.stringify(args) })),
);

server.registerTool(
  "excalidraw_clear_scene",
  {
    description: "Clear the visible Excalidraw bridge canvas.",
    inputSchema: {
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/scene/clear", args)),
);

server.registerTool(
  "excalidraw_replace_scene",
  {
    description: "Replace the visible Excalidraw bridge canvas with a full .excalidraw JSON scene.",
    inputSchema: {
      scene: z.string().describe("Full Excalidraw JSON scene string."),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async ({ scene, waitForBrowserAck }) => {
    const parsedScene = JSON.parse(scene);
    return textResult(await commandRequest("/api/scene/replace", { scene: parsedScene, waitForBrowserAck }));
  },
);

server.registerTool(
  "excalidraw_add_text",
  {
    description: "Add text to the visible Excalidraw bridge canvas.",
    inputSchema: {
      text: z.string(),
      x: z.number().default(120),
      y: z.number().default(120),
      fontSize: z.number().default(28),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/text", args)),
);

server.registerTool(
  "excalidraw_add_box",
  {
    description: "Add a rectangle with native text to the visible Excalidraw bridge canvas.",
    inputSchema: {
      text: z.string(),
      x: z.number().default(120),
      y: z.number().default(120),
      width: z.number().default(220),
      height: z.number().default(96),
      backgroundColor: z.string().default("#dbe4ff"),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/box", args)),
);

server.registerTool(
  "excalidraw_add_arrow",
  {
    description: "Add an arrow to the visible Excalidraw bridge canvas.",
    inputSchema: {
      x: z.number().default(120),
      y: z.number().default(120),
      width: z.number().default(160),
      height: z.number().default(0),
      label: z.string().optional(),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/arrow", args)),
);

server.registerTool(
  "excalidraw_move_cursor",
  {
    description: "Move the visible AI cursor marker on the Excalidraw bridge canvas.",
    inputSchema: {
      x: z.number(),
      y: z.number(),
      label: z.string().default("AI"),
      visible: z.boolean().default(true),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/cursor", args)),
);

server.registerTool(
  "excalidraw_load_file",
  {
    description: "Load a .excalidraw file into the visible bridge canvas.",
    inputSchema: {
      path: z.string(),
      waitForBrowserAck: z.boolean().default(false),
    },
  },
  async (args) => textResult(await commandRequest("/api/file/load", args)),
);

server.registerTool(
  "excalidraw_save_file",
  {
    description: "Save the current visible bridge canvas to a .excalidraw file.",
    inputSchema: {
      path: z.string(),
    },
  },
  async (args) => textResult(await request("/api/file/save", { method: "POST", body: JSON.stringify(args) })),
);

await server.connect(new StdioServerTransport());
