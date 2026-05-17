# Architecture

## Components

### Frontend

Location:

```text
src/app
```

The frontend is a Vite/React app embedding Excalidraw. It connects to the bridge over WebSocket and syncs local canvas changes through HTTP.

### Bridge Server

Location:

```text
src/server/index.ts
src/server/scene.ts
```

The server owns canonical scene state, writes local runtime state, exposes HTTP endpoints, and broadcasts updates over WebSocket.

### MCP Server

Location:

```text
src/server/mcp.ts
```

The MCP server exposes AI tools and talks to the local bridge API.

## Data Flow

```text
Browser Excalidraw
  -> /api/scene/sync
  -> SceneStore semantic diff
  -> activity log
  -> WebSocket status
```

AI commands flow through MCP:

```text
MCP client
  -> dist-server/mcp.js
  -> bridge HTTP API
  -> SceneStore
  -> WebSocket browser apply
```

## Actor-Aware History

Activity events include:

```ts
actor: "user" | "ai" | "system"
```

This keeps the audit log global while making unread status precise:

- `user`: browser-originated semantic changes.
- `ai`: MCP/API commands from AI.
- `system`: load/sync/internal events.

The UI badge is based on `unreadUserChanges`, not the full activity count.

## Semantic Activity

Tracked:

- elements added
- elements deleted
- text changed
- style changed
- element moved
- element resized
- scene replaced
- scene cleared
- cursor moved

Ignored as semantic history:

- selection
- unselection
- hover
- toolbar/menu state
- transient cursor movement unless explicitly sent as AI cursor

## Runtime State

Local runtime files:

```text
data/current.excalidraw
data/activity.jsonl
```

These are ignored by git because they represent local session state.
