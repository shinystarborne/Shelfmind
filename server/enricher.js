const RATE_LIMIT_MS = 1100

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function queryOpenLibrary(title, author) {
  try {
    const q   = encodeURIComponent(`${title} ${author}`.trim().slice(0, 120))
    const url = `https://openlibrary.org/search.json?q=${q}&limit=1&fields=key,title,author_name,subject,cover_i,series`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    const doc  = data?.docs?.[0]
    if (!doc) return null

    return {
      ol_key:           doc.key || '',
      author_canonical: Array.isArray(doc.author_name) ? doc.author_name[0] : (doc.author_name || ''),
      subjects:         (doc.subject || []).slice(0, 15),
      cover_i:          doc.cover_i || null,
      series_name:      Array.isArray(doc.series) ? doc.series[0] : (doc.series || ''),
    }
  } catch {
    return null
  }
}

async function fetchCoverDataUrl(coverId, size = 'M') {
  try {
    const url = `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return null   // placeholder "no cover" images are tiny
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function enrichOne(book, store) {
  const data = await queryOpenLibrary(book.title, book.author)
  if (!data) { store.markEnrichFailed(book.id); return false }

  // Download cover from Open Library if we don't already have one
  let coverDataUrl = null
  if (data.cover_i && !store.coverPath(book.id)) {
    coverDataUrl = await fetchCoverDataUrl(data.cover_i)
  }

  store.applyEnrichment(book.id, data, coverDataUrl)
  return true
}

async function enrichAll(store, onProgress, force = false) {
  const books   = store.getUnenrichedBooks(force)
  const total   = books.length
  let done    = 0
  let success = 0

  for (const book of books) {
    const ok = await enrichOne(book, store)
    if (ok) success++
    done++
    onProgress?.({ current: done, total, success })
    await sleep(RATE_LIMIT_MS)
  }

  return { total, success }
}

module.exports = { enrichOne, enrichAll, queryOpenLibrary }
