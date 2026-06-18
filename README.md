# ShelfMind

A personal ebook library manager for Windows. Scan your local EPUB/MOBI/FB2 collection, enrich metadata from Open Library, track reading status, and access your library from any device on the same Wi-Fi.

## Features

- **Library scanning** — indexes EPUB, MOBI, and FB2 files; fast incremental re-scans
- **Metadata enrichment** — fetches cover art, genres, and canonical author names from Open Library
- **Series & tags** — organise books by series, custom tags, and language
- **Insights** — reading stats and charts via a dedicated analytics view
- **Mobile access** — scan the QR code in Preferences to browse your library from a phone or tablet on the same Wi-Fi
- **Local-only** — all data is stored as plain JSON in `%APPDATA%\ShelfMind\`; no accounts, no cloud

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Windows 10/11** (Electron builds are Windows-only; the web UI works cross-platform via the Express server)

## Quick start

```bash
git clone https://github.com/shinystarborne/Shelfmind.git
cd Shelfmind
npm install
npm run dev
```

This opens the Electron desktop app with live reload (Vite on port 5173, API on port 3001).

## Setting your library path

On first launch go to **Preferences** and set the path to the folder that contains your ebooks (e.g. `D:\Books` or `C:\Users\You\Documents\Books`). Then click **Scan Library**.

The default path in the code is `E:\Books` — change it to match your setup before the first scan.

## Development

| Command | What it does |
|---------|-------------|
| `npm run dev` | Electron + Vite dev server with hot reload |
| `npm run build` | Build the React frontend into `dist/` |
| `npm run dist` | Full build → Windows NSIS installer + portable `.exe` in `release/` |
| `npm run release` | Build + publish a new release to GitHub Releases (requires `GH_TOKEN`) |

### Publishing a release — step by step

**1. Make sure everything is committed**
```powershell
git status   # should be clean before bumping
```

**2. Bump the version**
```powershell
npm version patch   # bug fix:   1.2.3 → 1.2.4
npm version minor   # feature:   1.2.3 → 1.3.0
npm version major   # breaking:  1.2.3 → 2.0.0
```
This edits `package.json`, commits, and creates a git tag automatically.

**3. Push the version commit and tag**
```powershell
git push
git push --tags
```

**4. Set your GitHub token for this terminal session**
```powershell
$env:GH_TOKEN = "ghp_yourtoken"
```
Generate one at **github.com/settings/tokens → Generate new token (classic)** with the `repo` scope.
Never commit this token — set it only in the terminal, never in code or config files.

**5. Build and publish**
```powershell
npm run release
```
This builds the installer, creates a GitHub Release tagged `v{version}`, and uploads the `.exe` files and `latest.yml`.

**6. Clear the token**
```powershell
$env:GH_TOKEN = ""
```

Users running the installed app will see an update prompt in **Preferences → Updates** the next time they check.

## Project structure

```
shelfmind/
├── electron/          # Electron main process & preload IPC bridge
├── server/            # Express API, JSON data store, scanner, enricher
├── src/               # React frontend (views, components)
│   ├── views/         # Library, Insights, Preferences pages
│   └── components/    # BookCard, BookDrawer, modals
├── assets/            # App icons
├── index.html         # SPA entry point
└── vite.config.js     # Vite + proxy config
```

## Data storage

All user data is written to `%APPDATA%\ShelfMind\ShelfMind\` as plain JSON:

| File | Contents |
|------|---------|
| `books.json` | Scanned book metadata |
| `states.json` | Per-book reading status, ratings, notes, tags |
| `prefs.json` | App preferences (library path, theme, etc.) |
| `covers/` | Cached cover images |

This folder survives app updates and is easy to back up.

## Mobile access

In Preferences, click **Generate QR Code** and scan it with your phone. The Express server on port 3001 serves the built `dist/` folder as a web app.

> After making frontend changes, run `npm run build` and restart the app for the phone view to reflect them.

If you want to run the server standalone (outside Electron), set the data path manually:

```powershell
$env:SHELFMIND_DATA = "$env:APPDATA\ShelfMind\ShelfMind"
node -e "require('./server/index.js').startServer(3001)"
```

## Troubleshooting

**Port 3001 already in use:**
```powershell
$p = (Get-NetTCPConnection -LocalPort 3001 -EA SilentlyContinue).OwningProcess
if ($p) { Stop-Process -Id $p -Force }
```
Then run `npm run dev` again.

**Release folder locked / can't rebuild:**
```powershell
Stop-Process -Name "ShelfMind","electron" -Force -ErrorAction SilentlyContinue
Start-Sleep 3
Remove-Item -Recurse -Force .\release
npm run dist
```

## License

MIT
