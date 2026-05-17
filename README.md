# Excalidraw AI Bridge

Local Excalidraw bridge for AI-assisted canvas work. It runs a visible Excalidraw web app, a local HTTP/WebSocket bridge, and an MCP server so Codex or another MCP client can read and update the canvas.

## What It Does

- Shows a local Excalidraw canvas at `http://127.0.0.1:5173`.
- Exposes a bridge API at `http://127.0.0.1:5174`.
- Exposes MCP tools for AI clients through `dist-server/mcp.js`.
- Lets AI add text, boxes, arrows, replace scenes, load/save `.excalidraw` files, and move a visible AI cursor.
- Tracks semantic canvas activity with actor-aware history: `user`, `ai`, and `system`.
- Keeps read receipts separate from global history, so AI changes do not count as unread user changes.

## Requirements

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

Short version:

- Node.js 22 or newer, tested with Node.js 25.
- npm.
- Codex or another MCP-compatible client if you want AI tool control.
- GitHub CLI only if you want to publish or manage the repository.

## Installation

```bash
git clone <private-repo-url>
cd excalidraw-ai-bridge
npm install
```

## Run Locally

```bash
npm run dev
```

Open the canvas:

```text
http://127.0.0.1:5173
```

Bridge endpoints:

```text
HTTP      http://127.0.0.1:5174
WebSocket ws://127.0.0.1:5174/ws
```

## Build

```bash
npm run build
```

Production server:

```bash
npm start
```

MCP server:

```bash
npm run mcp
```

## MCP Setup

Build first:

```bash
npm run build
```

Then configure your MCP client to run:

```bash
node /absolute/path/to/excalidraw-ai-bridge/dist-server/mcp.js
```

Codex config example:

```toml
[mcp_servers.excalidraw_bridge]
command = "node"
args = ["/Users/tri-mac/myproject/excalidraw-ai-bridge/dist-server/mcp.js"]
cwd = "/Users/tri-mac/myproject/excalidraw-ai-bridge"
```

Restart the MCP client after changing the config or rebuilding the MCP server.

## Main MCP Tools

- `excalidraw_get_scene`: reads the canvas and marks user changes as seen by AI.
- `excalidraw_get_activity`: reads recent semantic activity.
- `excalidraw_mark_ai_seen`: manually marks user activity as read.
- `excalidraw_add_text`: adds text to the canvas.
- `excalidraw_add_box`: adds a rectangle with text.
- `excalidraw_add_arrow`: adds an arrow.
- `excalidraw_move_cursor`: moves or hides the AI cursor marker.
- `excalidraw_replace_scene`: replaces the visible scene.
- `excalidraw_load_file`: loads a `.excalidraw` file into the bridge.
- `excalidraw_save_file`: saves the visible canvas to a file.

## Activity Model

The bridge stores semantic history with an actor:

```ts
actor: "user" | "ai" | "system"
```

The history is global, but the unread badge is user-focused:

- user edits increase `unreadUserChanges`;
- AI edits are recorded as history but do not count as unread for AI;
- `excalidraw_get_scene` reads the canvas and clears unread user changes.

Selection, hover, and toolbar state are treated as ephemeral UI state and are not semantic history.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Usage](docs/USAGE.md)
- [Requirements](docs/REQUIREMENTS.md)
- [MCP Setup](docs/MCP.md)
- [Architecture](docs/ARCHITECTURE.md)

## Useful Commands

```bash
npm run dev
npm run typecheck
npm run build
npm start
npm run mcp
```

## Local Data

Runtime state is stored under `data/`.

- `data/current.excalidraw`: current local canvas state.
- `data/activity.jsonl`: semantic activity log.

These files are ignored by git because they are local runtime state.
