// "Roast my library" — a one-shot sarcastic critique of the owner's library.
// Reuses the generic LLM client; the input is a compact summary built from
// getInsights() plus hand-picked specifics (specific titles are what makes a
// roast funny). Reading state comes from states.json directly, NOT from series
// stats — series_name metadata is often fragmented, which made the roast claim
// in-progress series were untouched.
const { chatComplete } = require('./openrouter')

// A random angle per roast keeps consecutive roasts from telling the same joke.
const ANGLES = [
  'the mountain of unread books vs. the handful actually read',
  'the abandoned (DNF) books',
  'the comfort rereads — reading the same books again instead of the backlog',
  'the genre monoculture — how narrow the taste clusters are',
  'series hoarding — whole series collected and barely started',
  'collecting books as a hobby separate from reading them',
  'the oldest unread books that have been sitting there for years',
]

function pick(arr, n) {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function buildSummary(store) {
  const ins    = store.getInsights()
  const books  = store.books.filter(b => !b.removed)
  const states = store.states

  const statusOf = b => states[b.id]?.status || 'unread'
  const dnf      = books.filter(b => statusOf(b) === 'dnf').slice(0, 5).map(b => b.title)
  const unread   = books.filter(b => statusOf(b) === 'unread')
  const reading  = books.filter(b => statusOf(b) === 'reading').map(b => b.title)
  const finished = books
    .filter(b => statusOf(b) === 'read' && states[b.id]?.finished_at)
    .sort((a, b) => states[b.id].finished_at - states[a.id].finished_at)
    .slice(-5)
    .map(b => b.title)
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
    currently_reading:    reading,
    recently_finished:    finished,
    oldest_unread:        oldestUnread,
    random_unread_sample: pick(unread.map(b => b.title), 6),
  }
}

const SYSTEM_PROMPT = `You are a sharp, savage book critic roasting a friend's personal ebook library — like a comedian doing a roast set: brutal, specific, and clearly affectionate underneath.

Rules:
- Reference SPECIFIC titles, authors, and numbers from the data — generic jokes are not funny.
- Actually roast. Tease hard: the unread backlog, abandoned (DNF) books, comfort rereads, taste clusters, series hoarding. It should sting a little. Never cross into genuine cruelty.
- Respect the data: "currently_reading" books ARE being read; "recently_finished" were read. Don't claim otherwise.
- Plain prose, 2–4 short paragraphs, under 250 words. End on a punchline.
- No JSON, no headers, no bullet lists.`

async function roast(store, prefs) {
  const summary = buildSummary(store)
  const angle   = pick(ANGLES, 1)[0]
  return chatComplete(prefs, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: `Lead with this angle: ${angle}.\n\nLibrary data (JSON):\n${JSON.stringify(summary)}` },
    // long timeout — local models can take minutes even on small prompts
  ], { timeoutMs: 300000, temperature: 1.0 })
}

module.exports = { roast }
