# Installation

## Clone

```bash
git clone <private-repo-url>
cd excalidraw-ai-bridge
```

## Install Dependencies

```bash
npm install
```

## Verify

```bash
npm run typecheck
npm run build
```

## Run Development Server

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Run Production Build

```bash
npm run build
npm start
```

The production server serves the bridge backend from `dist-server/index.js`.
