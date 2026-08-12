## Performance
- Full-text search is now instant on large libraries (SQLite FTS5 index) — no more multi-second freezes while typing, and search no longer holds your whole library's text in memory.
- Library grids and lists load small cover thumbnails instead of full-size covers — scrolling is much lighter.
- Auto-rescans triggered by folder watching no longer pile up or get lost while another scan is running.

## Notes
- First launch after this update runs two one-time background migrations (search index + cover thumbnails, a few minutes on a large library). Everything stays usable while they run.
- Full-text search now matches word prefixes ("dum" finds "Dumbledore") instead of any mid-word substring.
