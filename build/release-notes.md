## Performance
- Full-text search is now instant on large libraries (SQLite FTS5 index) — no more freezes while typing, and search no longer holds the library's text in memory. Search now matches word prefixes ("dum" finds "Dumbledore").
- Library grids and lists load small cover thumbnails instead of full-size covers — much lighter scrolling.
- First launch runs two one-time background migrations (search index + thumbnails, a few minutes on a large library); the app stays usable throughout.
- Search results are cleaner: books no longer appear on vague description similarity, and text snippets show proper punctuation.

## Audiobooks
- Audiobookshelf integration with an in-app player — listen to your audiobooks and keep progress in sync.

## Library
- PDF tabs can have a folder: new PDFs in it are swept in automatically by Scan and folder watching.
- Color palettes (Rose, Ocean, Forest, Lavender) with dark variants; Preferences moved to a gear icon in the sidebar.
