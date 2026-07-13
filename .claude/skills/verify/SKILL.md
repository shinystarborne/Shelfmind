---
name: verify
description: How to build, launch, and drive ShelfMind (Electron + React + Express) to verify changes end-to-end.
---

# Verifying ShelfMind

## Build
```bash
npm run build          # vite → dist/ (the Electron prod window loads dist/index.html)
```

## Launch with an isolated data dir + CDP
```bash
# CRITICAL: unset ELECTRON_RUN_AS_NODE — the Claude Code host sets it, and with it
# `require('electron')` returns a path string and main.js crashes on app.whenReady.
env -u ELECTRON_RUN_AS_NODE SHELFMIND_DATA="<scratch>/data" \
  npx electron . --remote-debugging-port=9333
```
- `SHELFMIND_DATA` overrides the store location (server/db.js). Without it, a dev
  `npx electron` run uses `%APPDATA%/shelfmind/...` — NOT the installed app's data.
- The installed app's real data dir is `C:\Users\Shiny\AppData\Roaming\ShelfMind\ShelfMind`.
- The Express server tries port 3001 and bumps (+1) if busy. Ask the app which port:
  IPC `get-server-port`, or read the electron log line `ShelfMind API → http://localhost:PORT`.

## Drive it (no Playwright needed)
Node 22+ has a global `WebSocket`. Get the page target from
`http://127.0.0.1:9333/json`, connect, then use `Runtime.evaluate`
(with `awaitPromise, returnByValue`) and `Page.captureScreenshot`.
See `drive.js` pattern in past sessions: helpers for clicking buttons by text and
setting React controlled inputs (native value setter + `input` event bubbles).

Gotchas:
- Native dialogs (file/folder pickers via `dialog.showOpenDialog`) cannot be driven
  over CDP. Exercise those paths by typing into the fallback text inputs or calling
  the same API endpoint the picker path calls.
- Stopping the background task that launched electron ORPHANS the electron.exe tree
  on Windows. Kill it properly: find the PID via `netstat -ano | grep :3001` (or 9333)
  then `taskkill //PID <pid> //T //F`. Otherwise the zombie holds ports 3001/9333 and
  the next instance silently bumps ports / loses CDP.
- `Page.captureScreenshot` can hang if the window is minimized.

## Headless server-only checks
The Express server runs standalone:
```bash
SHELFMIND_DATA=<scratch> node -e "require('./server/index').startServer(3888).then(async port => { /* fetch(...) */ })"
```
Good for API surface tests without opening a window the user might start using.
