# Requirements

## Runtime

- Node.js 22 or newer.
- npm.
- macOS, Linux, or Windows with a modern browser.

The project was developed and tested locally with Node.js 25.

## Ports

The default development setup uses:

- `127.0.0.1:5173` for the Vite/Excalidraw frontend.
- `127.0.0.1:5174` for the bridge API and WebSocket server.

If a port is already in use, stop the conflicting service or change the Vite/server configuration.

## Optional Tools

- Codex or another MCP-compatible AI client.
- GitHub CLI (`gh`) for repository publishing.
- tmux if you want to run the dev server as a background session.

## Browser

Use a current Chromium, Chrome, Safari, or Firefox release. The bridge was primarily tested with Chromium-based browser automation.
