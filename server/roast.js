// "Roast my library" — a one-shot sarcastic critique of the owner's library.
// Reuses the generic LLM client; the input is a compact summary built from
// getInsights() plus a few hand-picked specifics (specific titles are what
// makes a roast funny).
const { chatComplete } = require('./openrouter')

function buildSummary(store) {
  const ins    = store.getInsights()
  const books  = store.books.filter(b => !b.removed)
  const states = store.states

  const statusOf = b => states[b.id]?.status || 'unread'
  const dnf      = books.filter(b => statusOf(b) === 'dnf').slice(0, 5).map(b => b.title)
  const unread   = books.filter(b => statusOf(b) === 'unread')
  const oldestUnread = unread.slice()
    .sort((a, b) => (a.added_at || 0) - (b.added_at || 0))
    .slice(0, 3)
    .map(b => ({ title: b.title, since: b.added_at ? new Date(b.added_at * 1000).getFullYear() : '?' }))

  return {
    total_books:    ins.total,
    by_status:      ins.byStatus,
    by_format:      ins.byFormat,
    top_authors:    (ins.byAuthor || []).slice(0, 5),
    top_subjects:   (ins.bySubject || []).slice(0, 8),
    series_started: (ins.bySeries || []).slice(0, 8),
    rereads:        { total: ins.rereads?.total || 0, most_reread: (ins.rereads?.books || []).slice(0, 3).map(b => `${b.title} (${b.read_count}×)`) },
    dnf_titles:     dnf,
    oldest_unread:  oldestUnread,
  }
}

const SYSTEM_PROMPT = `You are a sharp, sarcastic book critic roasting a friend's personal ebook library — affectionately, like a friend who reads a lot and judges lovingly.

Rules:
- Reference SPECIFIC titles, authors, and numbers from the data — generic jokes are not funny.
- Classic material: the unread backlog vs. the books actually read, abandoned (DNF) books, rereading the same comfort books, taste clusters (all one genre?), series started and abandoned.
- Be witty and a bit savage, but never actually mean — the goal is laughing, not hurting.
- Plain prose, 2–4 short paragraphs, under 250 words. End on a punchline.
- No JSON, no headers, no bullet lists.`

async function roast(store, prefs) {
  const summary = buildSummary(store)
  return chatComplete(prefs, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: `Library data (JSON):\n${JSON.stringify(summary)}` },
    // long timeout — local models can take minutes even on small prompts
  ], { timeoutMs: 300000 })
}

module.exports = { roast }
