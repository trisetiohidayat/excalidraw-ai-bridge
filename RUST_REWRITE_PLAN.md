# Rust Rewrite Plan - Excalidraw AI Bridge

## Goal

Rewrite the bridge runtime from Node/TypeScript to Rust for a faster, more reliable local service while keeping the Excalidraw browser UI intact.

The practical target is:

- Rust replaces the Express/WebSocket server.
- Rust replaces the MCP stdio server.
- Rust owns scene storage, validation, element creation, file load/save, and broadcast.
- React/Vite/Excalidraw remains as the visible canvas client because Excalidraw is a browser-first React package.

Fully rewriting the Excalidraw UI in Rust is technically possible only by abandoning the official Excalidraw React package or embedding it inside another shell. That would add risk without meaningful benefit for this bridge.

## Recommended Architecture

```text
Codex / AI Client
    |
    | MCP stdio
    v
rust-excalidraw-mcp
    |
    | shared SceneStore / command bus
    v
rust-excalidraw-bridge
    |
    | HTTP + WebSocket
    v
React + Excalidraw browser UI
```

## Rust Workspace Layout

```text
excalidraw-ai-bridge/
  crates/
    bridge-core/
      src/
        scene.rs
        elements.rs
        types.rs
        store.rs
        commands.rs
    bridge-server/
      src/
        main.rs
        routes.rs
        websocket.rs
        cors.rs
    bridge-mcp/
      src/
        main.rs
        tools.rs
  src/app/
    App.tsx
    main.tsx
    styles.css
  data/
    current.excalidraw
  Cargo.toml
  package.json
```

## Crates

Use these Rust dependencies:

- `axum` for HTTP routes and WebSocket.
- `tokio` for async runtime.
- `serde` / `serde_json` for Excalidraw JSON.
- `tower-http` for CORS and static serving if needed.
- `uuid` for element IDs.
- `chrono` or `time` for timestamps.
- `anyhow` / `thiserror` for errors.
- `rmcp` or official MCP Rust SDK if stable enough for the MCP stdio server.
- `clap` for CLI flags.
- `tracing` / `tracing-subscriber` for logs.

## API Parity

Rust server should preserve the current endpoints:

- `GET /api/status`
- `GET /api/scene`
- `POST /api/scene/replace`
- `POST /api/scene/sync`
- `POST /api/scene/clear`
- `POST /api/elements`
- `POST /api/text`
- `POST /api/box`
- `POST /api/arrow`
- `POST /api/cursor`
- `POST /api/file/load`
- `POST /api/file/save`
- `GET /ws`

MCP tools should preserve current names:

- `excalidraw_bridge_status`
- `excalidraw_get_scene`
- `excalidraw_clear_scene`
- `excalidraw_replace_scene`
- `excalidraw_add_text`
- `excalidraw_add_box`
- `excalidraw_add_arrow`
- `excalidraw_move_cursor`
- `excalidraw_load_file`
- `excalidraw_save_file`

This lets Codex config stay stable except the executable path.

## Scene Model

Use typed structs for bridge-owned fields, but keep Excalidraw elements flexible:

```rust
type SceneElement = serde_json::Value;

struct BridgeScene {
    type_: String,
    version: u32,
    source: String,
    elements: Vec<SceneElement>,
    app_state: serde_json::Map<String, serde_json::Value>,
    files: serde_json::Map<String, serde_json::Value>,
}
```

Reason: Excalidraw element schema changes across versions. Strictly typing every element will make import/export brittle.

Keep typed builders for generated elements:

- `create_text_element`
- `create_box_element`
- `create_arrow_element`
- `create_cursor_element`

## Critical Behavior To Preserve

1. Strip `appState.collaborators` before persisting or sending to Excalidraw.
2. Never let an empty initial browser `onChange` wipe the server scene.
3. Broadcast full scene after AI commands.
4. Do not broadcast browser sync back to the same browser unless needed.
5. Save `data/current.excalidraw` after every mutating command.
6. Keep `.excalidraw` file compatibility with official Excalidraw JSON.

## Migration Phases

### Phase 1 - Rust Core

Build `bridge-core` with:

- Scene normalization.
- Load/save current scene.
- Element builders.
- Command application.
- Unit tests for command behavior.

Acceptance:

- Can load current `.excalidraw`.
- Can add text/box/arrow/cursor.
- Can save compatible scene.
- `collaborators` is stripped.

### Phase 2 - Rust HTTP/WebSocket Server

Build `bridge-server` with Axum:

- Same REST endpoints as current Express server.
- WebSocket broadcast for scene updates.
- CORS for `http://127.0.0.1:5173`.
- Shared state via `Arc<RwLock<SceneStore>>`.
- Broadcast via `tokio::sync::broadcast`.

Acceptance:

- Existing React app works without frontend changes.
- AI commands appear live in Excalidraw.
- Manual import + `Sync now` updates backend.

### Phase 3 - Rust MCP Server

Build `bridge-mcp`:

- Implement the same MCP tools.
- Tools call the Rust bridge over local HTTP first.
- Later optimization: let MCP directly share `bridge-core` only if running as the same process becomes useful.

Acceptance:

- Codex can call all Excalidraw tools.
- Existing `~/.codex/config.toml` only changes command path.

### Phase 4 - Process Manager

Replace Node server scripts with:

```json
{
  "scripts": {
    "dev": "concurrently -n server,app \"cargo run -p bridge-server\" \"vite --host 127.0.0.1\"",
    "dev:app": "vite --host 127.0.0.1",
    "dev:server": "cargo run -p bridge-server",
    "mcp": "cargo run -p bridge-mcp",
    "build": "cargo build --release && vite build"
  }
}
```

Acceptance:

- One command starts Rust server + Vite.
- Release binary can run without `tsx`, Express, or TypeScript server build.

### Phase 5 - Hardening

Add:

- Request size limits.
- Structured error JSON.
- File path safety for load/save.
- Scene backup before destructive replace/clear.
- Optional `/api/scene/history`.
- Integration tests using Rust HTTP client.

Acceptance:

- Bad JSON does not crash server.
- Large scene load is handled predictably.
- Clear/replace can be recovered from backup.

## Performance Expectation

Rust will help most in:

- Lower startup time for backend.
- Lower memory use than Node server.
- Faster JSON load/save and command processing.
- More reliable long-running local process.
- Easier single-binary distribution.

Rust will not make Excalidraw rendering itself faster, because rendering remains inside the browser React canvas.

## Risks

- MCP Rust SDK maturity may be weaker than TypeScript SDK. Mitigation: keep MCP server small and test tool by tool.
- Excalidraw scene schema is flexible. Mitigation: use `serde_json::Value` for unknown fields.
- Browser sync races can still wipe scenes if frontend logic regresses. Mitigation: keep frontend guard and add server-side protection for suspicious empty sync shortly after startup.
- WebSocket reconnection behavior must match current UX.

## Server-Side Empty Sync Protection

Add Rust guard:

- Track `started_at`.
- Track `last_non_empty_scene_at`.
- Reject or ignore `POST /api/scene/sync` with `elements: []` when:
  - current scene has elements, and
  - request arrives within first 5 seconds of browser connection or server startup, and
  - request does not include an explicit `force: true`.

This prevents browser initial empty state from erasing imported scenes.

## Suggested Implementation Order

1. Create Cargo workspace and `bridge-core`.
2. Port `types.ts` and `scene.ts` behavior into Rust.
3. Add unit tests around scene normalization and element builders.
4. Build Axum server with `/api/status` and `/api/scene`.
5. Add mutating endpoints one by one.
6. Add WebSocket broadcast.
7. Point current React app to Rust server and verify live drawing.
8. Build MCP server with status/get_scene first.
9. Add remaining MCP tools.
10. Update Codex MCP config to Rust binary.
11. Remove TypeScript server only after parity passes.

## Definition Of Done

- `cargo test` passes.
- `npm run build` passes for frontend.
- `cargo run -p bridge-server` + Vite shows Excalidraw UI.
- AI can add text/box/arrow/cursor live.
- Import/load file persists after browser reload.
- `Sync now` preserves imported scene.
- MCP tools work from Codex.
- Current TypeScript server can be deleted without losing functionality.
