## Beta 4 — local LLM connection fixes
- The Local LLM URL now accepts any common shape — bare host:port, …/v1, or the full …/v1/chat/completions — and errors name the exact URL that failed instead of a cryptic JSON parse error.
- Profiling aborts early after 5 identical errors in a row (e.g. wrong URL or model name) instead of failing through the whole library; already-completed profiles are kept.

## Beta 3 — local LLM support
- Mood AI can now use a local LLM instead of OpenRouter: set the Local LLM URL in Preferences → AI (Mood Suggestions) — LM Studio (http://localhost:1234/v1), Ollama (http://localhost:11434/v1), or any OpenAI-compatible server. No API key needed for local; set the model field to your local model's name.

## Beta 2 — profiling crash fixes
- Fixed "Maximum call stack size exceeded" failures on books with very large chapters — those books now profile normally.
- Books whose text can't be extracted (quirky ebook files, scanned PDFs) no longer fail — they're profiled from metadata only, and the log says so.

## Beta 1 — mood profiling fixes
- The profiler now actually uses the model you typed — Profile All saves your settings first, and Preferences shows which model a run will use.
- Live log in Preferences → AI (Mood Suggestions): see each book as it's profiled, with the real error when one fails (bad model id, missing credits, rate limit).
- Stop button for the profiling run.
- Free models that reject JSON mode are now retried automatically without it.
- Mood view: the "profiled" counter updates live while a run is in progress.

## AI Mood Suggestions
- New 🔮 Mood view: tell ShelfMind how you're feeling (chips or free text) and get up to 3 picks from your own library — ebooks and audiobooks — each with a one-line reason.
- Powered by your own AI key/server: set it in Preferences → Library Tools → AI (Mood Suggestions), then run "Profile All Books". The one-time pass runs in the background and saves mood profiles locally; after that, suggestions are instant.
- AI mood tags are also added to your books, so they work in filters, search, and smart shelves.
- Optional web-search lookup for obscure books (OpenRouter only, off by default).

## Fixes
- Insights: the Rereads tile now counts the real number of reread books (was capped at 10), and the Most Reread list shows "reread 3×" instead of total reads.
