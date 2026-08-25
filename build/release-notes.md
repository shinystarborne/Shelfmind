## Beta 16 — AI pattern auto-tagging
- New ✨ Auto-tag button on PDF tabs: the AI reads each pattern's first pages and tags it with craft (knitting/crochet/…), item type (sweater/socks/bag/…), yarn weight, and the named yarn — searchable as tags like `craft:knitting` or `weight:dk`.
- Scanned patterns without a text layer are handled too — their first pages are sent as images to your vision model.
- Same ✨ Auto-tag button per pattern in its drawer, with the AI's findings shown under "AI Pattern Info". Runs one pattern at a time with progress and a Cancel button.

## Beta 15 — one-click bookmarks, clicker key fixed for real
- Bookmark the current page with **one click** on the 🔖 button in the PDF reader toolbar — saved instantly, no panel, no naming step (rename later in the 📑 Contents panel if you feel like it).
- Fixed the clicker key assignment and sound toggle for real this time: the server was silently throwing away those settings, so the assigned key never stuck. Assign once, tick forever.

## Beta 14 — annotations in the PDF reader + clicker fix
- New 🖊 annotation tools in the PDF reader: highlighter and pencil (with colors), text notes you click into place, an eraser, and undo (Ctrl+Z). Marks stay exactly where you put them when you zoom, and they're saved per pattern — perfect for ticking off chart rows.
- Fixed dead clicker buttons: assign-key (⌨), the counter list (▾), the sound toggle (🔊) and close now work (a dragging bug swallowed their clicks).
- Contents panel is now tabbed — Outline and 🔖 Bookmarks side by side — with a big "Bookmark page N" button that saves in one click.

## Beta 13 — row clicker + jump-to bookmarks
- New 🧶 row clicker in the PDF reader: named counters saved per pattern ("row", "sleeve 1", a whole second WIP…), one active at a time. Assign any keyboard key as the clicker — press it to count, Shift+key to count down — with a mechanical click sound (mutable) so you always know the row registered.
- New 🔖 Contents panel in the PDF reader: jump using the book's own built-in outline when the PDF has one, plus your own named bookmarks ("Socks — chart B") that work in every PDF and are saved per pattern.

## Beta 12 — drag & drop onto lists
- Drag any book or PDF card straight onto a reading list in the sidebar — the list highlights as you hover, drop to add. Works from the library grid, list view rows, and PDF tabs.
- New ＋ button on card hover and an "Add to List" button in the book/PDF drawer: pick a list or create a new one right there. Perfect for a "knitting queue" list.

## Beta 11 — PDF crash fix, roast history + Continue Reading fix
- Fixed an out-of-memory crash when opening a PDF tab with many PDFs: cover thumbnails are now generated two at a time from just the first page (previously every PDF was downloaded in full at once) and memory is freed after each one.
- New "Index the text inside PDFs too" toggle in Preferences → Search Index — turn it off for image-heavy PDFs (scans, craft patterns) to keep index builds fast. Titles and tags stay searchable either way.
- The roast moved to the Insights page and roasts are now saved — reread past roasts and delete them anytime.
- Continue Reading now shows only books you actually marked as "reading" — books you merely opened no longer pile up there.

## Beta 10 — sharper roasts
- The roast now knows what you're currently reading and recently finished, so it won't mock you for not starting a series you're actually in the middle of.
- Every roast is different now: a random angle per click, a rotating sample of your unread shelf, and a hotter model temperature.
- Sharper persona — expect it to sting a little.

## Beta 9 — Roast my library
- New "🔥 Roast my library" button in the Mood view: the AI reads your library stats (unread backlog, DNFs, rereads, favorite authors and genres) and delivers a sarcastic, affectionate critique of your reading habits.

## Beta 8 — titlebar flash fix
- The window buttons (minimize/maximize/close) and window background no longer flash light on startup — the app now opens with your theme's colors from the very first frame.

## Beta 7 — startup theme flash fix
- The app no longer opens light for a second before switching to your dark theme — the saved theme/palette are now applied before the first paint.

## Beta 6 — suggestion call fixes
- Suggestions no longer fail with a timeout on local models — the AI gets up to 5 minutes to answer (it sends ~30 candidate profiles in one prompt; local models need a while), and the view says so while you wait.
- If a suggestion still fails, the error message now says what actually happened instead of "is the server running?".

## Beta 5 — Cloudflare Access support for self-hosted LLMs
- If your LLM server is behind Cloudflare Zero Trust (requests were hitting the Cloudflare login page): create a service token in your Zero Trust dashboard (Access → Service Auth → Service Tokens) and paste the Client-Id + Client-Secret into the new fields in Preferences → AI (Mood Suggestions).

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
