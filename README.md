# ShelfMind

A personal ebook library manager for Windows. Scan your local EPUB/MOBI/FB2 collection, enrich metadata from Open Library, track reading status, and access your library from any device on the same Wi-Fi.

## Features

- **Library scanning** — indexes EPUB, MOBI, and FB2 files; fast incremental re-scans
- **Metadata enrichment** — fetches cover art, genres, and canonical author names from Open Library
- **Series & tags** — organise books by series, custom tags, and language
- **Reading lists** — create and manage custom reading lists
- **Insights** — reading stats and charts via a dedicated analytics view
- **Mobile access** — scan the QR code in Preferences to browse your library from a phone or tablet on the same Wi-Fi
- **Local-only** — all data is stored as plain JSON in `%APPDATA%\ShelfMind\`; no accounts, no cloud

## Download

Grab the latest installer from the [Releases](../../releases/latest) page. Run the `.exe` — no extra dependencies needed.

## Setting your library path

On first launch go to **Preferences** and set the path to the folder that contains your ebooks (e.g. `D:\Books`). Then click **Scan Library**.

## Mobile access

In Preferences, click **Generate QR Code** and scan it with your phone. The app serves your library as a web app on port 3001 — any device on the same Wi-Fi can browse it.

## Data storage

All data lives in `%APPDATA%\ShelfMind\ShelfMind\` as plain JSON — no database, no cloud. Easy to back up, survives app updates.

| File | Contents |
|------|---------|
| `books.json` | Scanned book metadata |
| `states.json` | Per-book reading status, ratings, notes, tags |
| `prefs.json` | App preferences (library path, theme, etc.) |
| `covers/` | Cached cover images |

## Status

ShelfMind is still a work in progress — expect rough edges and new features over time. If you run into bugs, have ideas, or just want to say hi, feel free to reach out:

- Email: [shiny@shinystarborne.com](mailto:shiny@shinystarborne.com)
- Instagram: [@shiny.starborne](https://www.instagram.com/shiny.starborne/)

## License

ShelfMind is free to use. Licensed under MIT.

---

If you enjoy it, a coffee is always appreciated ☕

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/shinystarborne)
