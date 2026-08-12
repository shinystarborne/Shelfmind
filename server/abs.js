// Client for a self-hosted Audiobookshelf (ABS) server.
// Config lives in prefs: abs_url (e.g. http://192.168.1.10:13378) and abs_token
// (ABS → Settings → Users → your user → API token).

async function absFetch(absUrl, token, path) {
  const base = String(absUrl).replace(/\/+$/, '')
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  return res.json()
}

function mapItem(item, absUrl) {
  const md = item.media?.metadata || {}
  const base = String(absUrl).replace(/\/+$/, '')
  return {
    id:           `abs_${item.id}`,
    abs_id:       item.id,
    title:        md.title || 'Untitled',
    author:       md.authorName || md.authors?.[0]?.name || '',
    series:       md.seriesName || md.series?.[0]?.name || '',
    series_num:   md.series?.[0]?.sequence ?? null,
    description: md.description || '',
    genres:      md.genres || [],
    duration:     item.media?.duration || 0,
    format:       'audiobook',
    cover_url:    `/api/audiobooks/${item.id}/cover`,   // proxied — ABS covers need the Bearer token
    external_url: `${base}/item/${item.id}`,
  }
}

// Full details for the in-app player: base card fields plus the audio track
// list. Returns null when unconfigured/unreachable. Never throws.
async function getAudiobook(prefs, itemId) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token || !/^[\w-]+$/.test(itemId)) return null
  try {
    const item = await absFetch(abs_url, abs_token, `/items/${itemId}`)
    if (!item) return null
    const base = mapItem(item, abs_url)
    const files = (item.media?.audioFiles || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0))
    base.tracks = files.map(f => ({
      ino:      String(f.ino),
      filename: f.metadata?.filename || '',
      duration: f.duration || 0,
    }))
    // Book-level chapter positions (seconds from the start of the book)
    base.chapters = (item.media?.chapters || []).map(c => ({
      title: c.title || '',
      start: c.start || 0,
      end:   c.end || 0,
    }))
    return base
  } catch {
    return null
  }
}

// User listening progress from ABS, normalized to
// { [libraryItemId]: { progress, currentTime, duration, isFinished, lastUpdate } }.
// Optional enhancement — any failure returns {} so the item list still loads.
async function getProgress(prefs) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token) return {}
  try {
    const data = await absFetch(abs_url, abs_token, '/me')
    const user = data?.user || data
    const map = {}
    for (const mp of user?.mediaProgress || []) {
      if (!mp.libraryItemId) continue
      map[mp.libraryItemId] = {
        progress:    mp.progress || 0,
        currentTime: mp.currentTime || 0,
        duration:    mp.duration || 0,
        isFinished:  !!mp.isFinished,
        lastUpdate:  mp.lastUpdate || 0,
      }
    }
    return map
  } catch {
    return {}
  }
}

// Canonical series membership + sequence from ABS's own series endpoint:
// { [libraryItemId]: { name, sequence } }. More reliable than the free-text
// metadata seriesName (which sometimes contains the number, e.g. "Saga #1").
// Never throws — returns {} on failure.
async function getSeriesInfo(prefs) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token) return {}
  try {
    const libraries = await absFetch(abs_url, abs_token, '/libraries')
    const bookLibs = (libraries?.libraries || []).filter(l => l.mediaType === 'book')
    const map = {}
    for (const lib of bookLibs) {
      const data = await absFetch(abs_url, abs_token, `/libraries/${lib.id}/series?limit=0`)
      for (const s of data?.results || []) {
        ;(s.books || []).forEach((b, i) => {
          const seq = parseFloat(b.media?.metadata?.series?.sequence)
          // first entry wins — later entries are usually duplicate copies
          if (!(b.id in map)) map[b.id] = { name: s.name, sequence: isFinite(seq) ? seq : i + 1 }
        })
      }
    }
    return map
  } catch {
    return {}
  }
}

// Returns { configured, items, progress, error? }. Never throws.
async function getAudiobooks(prefs) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token) return { configured: false, items: [], progress: {}, seriesInfo: {} }
  try {
    const [libraries, progress, seriesInfo] = await Promise.all([
      absFetch(abs_url, abs_token, '/libraries'),
      getProgress(prefs),
      getSeriesInfo(prefs),
    ])
    const bookLibs = (libraries?.libraries || []).filter(l => l.mediaType === 'book')
    const items = []
    for (const lib of bookLibs) {
      const data = await absFetch(abs_url, abs_token, `/libraries/${lib.id}/items?limit=0`)
      for (const item of data?.results || []) items.push(mapItem(item, abs_url))
    }
    items.sort((a, b) => a.title.localeCompare(b.title))
    return { configured: true, items, progress, seriesInfo }
  } catch {
    return { configured: true, items: [], progress: {}, seriesInfo: {}, error: 'Could not reach Audiobookshelf' }
  }
}

// Streams an item's cover from ABS. Returns { status, contentType, body } or null. Never throws.
async function getCover(prefs, itemId) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token || !/^[\w-]+$/.test(itemId)) return null
  try {
    const base = String(abs_url).replace(/\/+$/, '')
    const res = await fetch(`${base}/api/items/${itemId}/cover`, {
      headers: { Authorization: `Bearer ${abs_token}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return {
      contentType: res.headers.get('content-type') || 'image/jpeg',
      body: Buffer.from(await res.arrayBuffer()),
    }
  } catch {
    return null
  }
}

// Write listening progress back to ABS. Returns true on success. Never throws.
async function updateProgress(prefs, itemId, { currentTime, duration, progress, isFinished }) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token || !/^[\w-]+$/.test(itemId)) return false
  try {
    const base = String(abs_url).replace(/\/+$/, '')
    const body = { currentTime, duration, progress }
    if (isFinished != null) body.isFinished = isFinished
    const res = await fetch(`${base}/api/me/progress/${itemId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${abs_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

// Listening stats from ABS, normalized for the Insights page. Never throws.
async function getListeningStats(prefs) {
  const { abs_url, abs_token } = prefs || {}
  if (!abs_url || !abs_token) return { configured: false }
  try {
    const [stats, progress] = await Promise.all([
      absFetch(abs_url, abs_token, '/me/listening-stats'),
      getProgress(prefs),
    ])
    if (!stats) return { configured: true, error: 'Could not reach Audiobookshelf' }
    return {
      configured:    true,
      totalTimeSec:  stats.totalTime || 0,
      days:          stats.days || {},
      booksFinished: Object.values(progress).filter(p => p.isFinished).length,
    }
  } catch {
    return { configured: true, error: 'Could not reach Audiobookshelf' }
  }
}

module.exports = { getAudiobooks, getAudiobook, getCover, updateProgress, getListeningStats }
