// Mood-based suggestions: pre-filter saved AI profiles by keyword overlap,
// then one OpenRouter call picks up to 3 from the shortlist with reasons.
const { chatComplete } = require('./openrouter')
const { getAudiobooks } = require('./abs')

const SHORTLIST_SIZE = 30
const MAX_PICKS      = 3

function moodTerms(moodText, chips) {
  const words = String(moodText || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
  const terms = [...chips.map(c => String(c).toLowerCase().trim()), ...words]
  return [...new Set(terms.filter(t => t.length > 2))]
}

function scoreCandidate(terms, profile) {
  const hay = [...(profile.mood_tags || []), String(profile.mood_text || '')]
    .join(' ').toLowerCase()
  let score = 0
  for (const t of terms) if (hay.includes(t)) score++
  return score
}

// Random/representative pick of n when there's no mood text to score by.
function sample(arr, n) {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

async function suggest(store, prefs, { moodText = '', chips = [], includeRereads = false } = {}) {
  const profiles = store.getAiProfiles()

  // ABS items + listening progress, for audiobook titles and finished-filtering.
  // absFinished stays null when ABS is unreachable → include those candidates
  // rather than failing the whole suggestion.
  let absFinished = null
  const absItems  = new Map()
  if (prefs.abs_url && Object.keys(profiles).some(id => id.startsWith('abs_'))) {
    const abs = await getAudiobooks(prefs)   // never throws
    for (const it of abs.items || []) absItems.set(it.id, it)
    if (!abs.error) {
      absFinished = new Set()
      for (const [libId, p] of Object.entries(abs.progress || {})) {
        if (p.isFinished) absFinished.add(`abs_${libId}`)
      }
    }
  }

  const candidates = []
  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.failed) continue
    if (id.startsWith('abs_')) {
      if (absFinished?.has(id)) continue
      const item = absItems.get(id)
      candidates.push({
        id,
        title:  item?.title  || '',
        author: item?.author || '',
        profile,
      })
    } else {
      const b = store.getBook(id)
      if (!b || b.removed) continue
      if (!includeRereads && b.read_status === 'read') continue
      candidates.push({
        id,
        title:  b.title,
        author: b.author_canonical || b.author,
        profile,
      })
    }
  }
  if (!candidates.length) return { suggestions: [] }

  // Pre-filter: keyword overlap between mood words/chips and saved profiles
  const terms = moodTerms(moodText, chips)
  let shortlist
  if (terms.length) {
    shortlist = candidates
      .map(c => ({ c, score: scoreCandidate(terms, c.profile) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SHORTLIST_SIZE)
      .map(x => x.c)
  } else {
    shortlist = sample(candidates, SHORTLIST_SIZE)
  }

  const system = 'You are a book recommendation assistant for a personal library. ' +
    'Each candidate has AI-generated mood tags and a mood profile. ' +
    'Pick the up to 3 candidates that best fit the user\'s current mood. ' +
    'Reply with strict JSON only: { "suggestions": [{ "id": "<candidate id>", "reason": "one sentence why it fits" }] }'
  const user = [
    `User's mood: ${moodText || '(none given)'}`,
    chips.length ? `Selected mood chips: ${chips.join(', ')}` : null,
    'Candidates (JSON):',
    JSON.stringify(shortlist.map(c => ({
      id:         c.id,
      title:      c.title,
      author:     c.author,
      mood_tags:  c.profile.mood_tags || [],
      mood_text:  c.profile.mood_text || '',
    }))),
  ].filter(Boolean).join('\n')

  const result = await chatComplete(prefs, [
    { role: 'system', content: system },
    { role: 'user',   content: user },
    // no webSearch here — candidates are local profiles, a web lookup would
    // only add cost. Long timeout: the shortlist prompt is several thousand
    // tokens, and local models can take minutes to answer.
  ], { json: true, timeoutMs: 300000 })

  const byId = new Map(shortlist.map(c => [c.id, c]))
  const suggestions = (Array.isArray(result.suggestions) ? result.suggestions : [])
    .filter(s => s && typeof s.id === 'string' && byId.has(s.id))
    .slice(0, MAX_PICKS)
    .map(s => ({
      id:     s.id,
      kind:   s.id.startsWith('abs_') ? 'audiobook' : 'book',
      reason: String(s.reason || ''),
    }))

  return { suggestions }
}

module.exports = { suggest }
