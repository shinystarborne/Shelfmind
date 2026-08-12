## Beta 1 — mood profiling fixes
- The profiler now actually uses the model you typed — Profile All saves your settings first, and Preferences shows which model a run will use.
- Live log in Preferences → AI (Mood Suggestions): see each book as it's profiled, with the real error when one fails (bad model id, missing credits, rate limit).
- Stop button for the profiling run.
- Free models that reject JSON mode are now retried automatically without it.
- Mood view: the "profiled" counter updates live while a run is in progress.

## AI Mood Suggestions
- New 🔮 Mood view: tell ShelfMind how you're feeling (chips or free text) and get up to 3 picks from your own library — ebooks and audiobooks — each with a one-line reason.
- Powered by your own OpenRouter key (BYOK): set it in Preferences → Library Tools → AI (Mood Suggestions), then run "Profile All Books". The one-time pass runs in the background and saves mood profiles locally; after that, suggestions are instant.
- AI mood tags are also added to your books, so they work in filters, search, and smart shelves.
- Optional web-search lookup for obscure books (off by default).

## Fixes
- Insights: the Rereads tile now counts the real number of reread books (was capped at 10), and the Most Reread list shows "reread 3×" instead of total reads.
