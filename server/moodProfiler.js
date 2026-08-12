// Background mood-profiling pass — mirrors enricher.js's enrichAll shape.
// Sends each ebook (metadata + ~1500-word excerpt) and each ABS audiobook
// (metadata only) to an OpenRouter model, which returns mood tags + a short
// mood profile. Saved to aiProfiles.json; ebook mood_tags are also merged into
// the book's states.json tags so they work in filters and smart shelves.
const { chatComplete, DEFAULT_MODEL } = require('./openrouter')
const { getAudiobooks } = require('./abs')
const { extractBookText } = require('./searchIndexer')

const DELAY_MS  = 300    // free-tier friendly
const MAX_WORDS = 1500

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// First ~1500 words starting at the first chapter with >100 words (skips
// front matter: title page, TOC, copyright, …).
function buildExcerpt(chapters) {
  if (!Array.isArray(chapters)) return ''
  const start = chapters.findIndex(c =>
    (c?.text || '').trim().split(/\s+/).filter(Boolean).length > 100)
  if (start === -1) return ''
  // concat, not push(...spread) — a single chapter can hold 100k+ words and
  // spreading that into push() blows the call stack
  let words = []
  for (let i = start; i < chapters.length && words.length < MAX_WORDS; i++) {
    const text = (chapters[i]?.text || '').trim()
    if (text) words = words.concat(text.split(/\s+/))
  }
  return words.slice(0, MAX_WORDS).join(' ')
}

// Excerpt source: cached search text; extracted on demand (and persisted,
// which also feeds the FTS index) when missing. Some files defeat the
// extractors (quirky zips, entity-heavy XML, scanned images) — that's not
// fatal, profiling falls back to metadata only.
async function getEbookExcerpt(store, book) {
  try {
    let data = store.getSearchText(book.id)
    if (!data) {
      const extracted = await extractBookText(book)
      if (extracted) {
        data = { mtime: Date.now(), ...extracted }
        store.saveSearchText(book.id, data)
        store.markTextIndexed('book', book.id, true)
      }
    }
    return buildExcerpt(data?.chapters)
  } catch {
    return ''
  }
}

const SYSTEM_PROMPT = `You profile books by mood for a personal library's recommendation feature.
You have up to three sources of information:
1. The metadata provided below (title, author, series, subjects/genres, description).
2. An excerpt from the book's first substantial chapter, when provided.
3. Your own knowledge of the actual published work — if you know this book, use what you know about its plot, tone and themes.

Reply with strict JSON only, no other text:
{ "mood_tags": ["3-6 lowercase tags describing the reading mood, e.g. cozy, dark, slow-burn, funny, epic, hopeful"], "mood_text": "2-3 sentences describing the emotional experience of reading this book." }`

function buildMessages(item, excerpt) {
  const lines = [
    `Title: ${item.title}`,
    item.author && `Author: ${item.author}`,
    item.series && `Series: ${item.series}`,
    item.subjects?.length && `Subjects/genres: ${item.subjects.slice(0, 10).join(', ')}`,
    item.description && `Description: ${String(item.description).slice(0, 800)}`,
  ].filter(Boolean)
  if (excerpt) lines.push(`Excerpt:\n${excerpt}`)
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: lines.join('\n') },
  ]
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = new Set()
  const out  = []
  for (const t of tags) {
    const tag = String(t).trim().toLowerCase()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 6) break
  }
  return out
}

// item: { id, title, author, series, subjects, description, book? }
// `book` present → ebook (excerpt + tag merge); absent → ABS audiobook.
async function profileOne(store, prefs, item) {
  const excerpt = item.book ? await getEbookExcerpt(store, item.book) : ''
  const result  = await chatComplete(prefs, buildMessages(item, excerpt), {
    json:      true,
    webSearch: prefs.openrouter_web_search === true,
  })
  const profile = {
    mood_tags:    normalizeTags(result.mood_tags),
    mood_text:    String(result.mood_text || '').trim(),
    model:        prefs.openrouter_model || DEFAULT_MODEL,
    excerpt_used: !!excerpt,
    profiled_at:  Date.now(),
    failed:       false,
  }
  store.setAiProfile(item.id, profile)
  if (item.book && profile.mood_tags.length) store.addTags(item.id, profile.mood_tags)
  return profile
}

function bookToItem(b) {
  return {
    id:          b.id,
    title:       b.title,
    author:      b.author_canonical || b.author,
    series:      b.series_name,
    subjects:    b.subjects,
    description: b.description,
    book:        b,
  }
}

function absToItem(a) {
  return {
    id:          a.id,
    title:       a.title,
    author:      a.author,
    series:      a.series,
    subjects:    a.genres,
    description: a.description,
  }
}

async function collectItems(store, prefs, force) {
  const profiles = store.getAiProfiles()
  const needsProfiling = id => force || !profiles[id] || profiles[id].failed

  const items = store.books.filter(b => !b.removed && needsProfiling(b.id)).map(bookToItem)

  if (prefs.abs_url) {
    const abs = await getAudiobooks(prefs)   // never throws; items [] on failure
    for (const a of abs.items || []) {
      if (needsProfiling(a.id)) items.push(absToItem(a))
    }
  }
  return items
}

async function profileAll(store, prefs, { onProgress, onLog, shouldStop } = {}, force = false) {
  const items = await collectItems(store, prefs, force)
  const total = items.length
  let done = 0, success = 0, failed = 0

  onLog?.(`Starting profiling run — ${total} item(s), model: ${prefs.openrouter_model || DEFAULT_MODEL}`)

  for (const item of items) {
    if (shouldStop?.()) {
      onLog?.(`Stopped by user after ${done}/${total} (${success} ok, ${failed} failed)`)
      return { total, success, failed, stopped: true }
    }
    onProgress?.({ current: done, total, success, failed, title: item.title })
    try {
      const profile = await profileOne(store, prefs, item)
      success++
      const note = item.book && !profile.excerpt_used ? ' (metadata only — no extractable text)' : ''
      onLog?.(`✓ ${item.title} — ${profile.mood_tags.join(', ') || 'no tags'}${note}`)
    } catch (err) {
      store.markAiProfileFailed(item.id)   // never abort the pass
      failed++
      onLog?.(`✗ ${item.title} — ${err.message}`)
    }
    done++
    onProgress?.({ current: done, total, success, failed, title: item.title })
    await sleep(DELAY_MS)
  }

  onLog?.(`Run finished — ${success}/${total} profiled${failed ? `, ${failed} failed (retried next run)` : ''}`)
  return { total, success, failed }
}

// Synchronous single item — book id or "abs_<id>". Returns null when the id
// doesn't exist, otherwise { ok } or { ok: false, error }.
async function profileById(store, prefs, id) {
  let item = null
  if (id.startsWith('abs_')) {
    const abs = await getAudiobooks(prefs)
    const a   = (abs.items || []).find(x => x.id === id)
    if (a) item = absToItem(a)
  } else {
    const b = store.getBook(id)
    if (b && !b.removed) item = bookToItem(b)
  }
  if (!item) return null

  try {
    await profileOne(store, prefs, item)
    return { ok: true }
  } catch (err) {
    store.markAiProfileFailed(id)
    return { ok: false, error: err.message }
  }
}

module.exports = { profileAll, profileById, profileOne }
