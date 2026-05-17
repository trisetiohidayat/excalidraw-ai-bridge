# Usage

## Start The Bridge

```bash
npm run dev
```

Open the canvas:

```text
http://127.0.0.1:5173
```

## Canvas Workflow

1. Draw or edit in Excalidraw.
2. The browser syncs semantic changes to the bridge.
3. The bridge stores meaningful activity such as text changes, move, resize, style changes, add, delete, and scene replace.
4. Selection and hover state are ignored as semantic history.
5. An AI client can read the canvas through MCP.

## Read Receipts

The bridge tracks user changes separately from AI changes.

- User changes increase `unreadUserChanges`.
- AI changes are recorded but do not count as unread user changes.
- Reading the canvas through `excalidraw_get_scene` marks user activity as read.

Useful status endpoint:

```bash
curl http://127.0.0.1:5174/api/status
```

Atomic read endpoint:

```bash
curl -X POST http://127.0.0.1:5174/api/canvas/read \
  -H 'content-type: application/json' \
  -d '{}'
```

## Save And Load Scene Files

Through MCP:

- `excalidraw_save_file`
- `excalidraw_load_file`

Through HTTP:

```bash
curl -X POST http://127.0.0.1:5174/api/file/save \
  -H 'content-type: application/json' \
  -d '{"path":"data/my-scene.excalidraw"}'
```

```bash
curl -X POST http://127.0.0.1:5174/api/file/load \
  -H 'content-type: application/json' \
  -d '{"path":"data/my-scene.excalidraw"}'
```

## Common Commands

```bash
npm run dev
npm run typecheck
npm run build
npm start
npm run mcp
```
