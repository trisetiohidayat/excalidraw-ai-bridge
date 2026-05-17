# MCP Setup

## Build MCP Server

```bash
npm run build
```

The MCP entrypoint is:

```text
dist-server/mcp.js
```

## Codex Config Example

Add this to your Codex MCP config, adjusting paths as needed:

```toml
[mcp_servers.excalidraw_bridge]
command = "node"
args = ["/Users/tri-mac/myproject/excalidraw-ai-bridge/dist-server/mcp.js"]
cwd = "/Users/tri-mac/myproject/excalidraw-ai-bridge"
```

Restart Codex after changing MCP config or after rebuilding the server.

## Tools

### `excalidraw_get_scene`

Reads the current canvas and recent activity, then marks user changes as seen by AI. This uses the bridge's atomic `/api/canvas/read` endpoint.

### `excalidraw_get_activity`

Reads recent semantic activity. It can optionally mark activity as seen.

### `excalidraw_mark_ai_seen`

Manually marks the latest user activity as read by AI.

### `excalidraw_add_text`

Adds a text element.

### `excalidraw_add_box`

Adds a rectangle and text.

### `excalidraw_add_arrow`

Adds an arrow.

### `excalidraw_move_cursor`

Shows, moves, or hides the AI cursor marker.

### `excalidraw_replace_scene`

Replaces the visible scene with a full Excalidraw JSON scene.

### `excalidraw_load_file`

Loads a `.excalidraw` file into the visible bridge.

### `excalidraw_save_file`

Saves the current visible canvas to a `.excalidraw` file.

## Notes

The visible browser app should be running while using MCP tools:

```bash
npm run dev
```

Some tools can return before the browser has applied the command. Use `waitForBrowserAck: true` where supported if the next step depends on the visible browser state.
