const fs = require('fs')

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s) {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[^\wА-яёЁа-яёЁ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordOverlap(a, b) {
  const wa = new Set(a.split(' ').filter(w => w.length > 2))
  const wb = new Set(b.split(' ').filter(w => w.length > 2))
  if (wa.size === 0 || wb.size === 0) return 0
  const hits = [...wa].filter(w => wb.has(w)).length
  return hits / Math.max(wa.size, wb.size)
}

function parseGenres(cell) {
  return (cell || '').split('·').map(g => g.trim()).filter(Boolean)
}

function cleanCell(s) {
  return (s || '')
    .replace(/\*\*/g, '')                  // bold markdown
    .replace(/\([^)]{0,30}\)/g, '')       // short parentheticals  e.g. (т.1–2) (RU)
    .replace(/\s+/g, ' ')
    .trim()
}

// ── MD parser ─────────────────────────────────────────────────────────────────

function parseMd(mdPath) {
  const lines = fs.readFileSync(mdPath, 'utf8').split('\n')
  const result = { series: [], standalones: [] }
  let section = null
  let seenHeader = false

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('## ')) {
      const h = line.slice(3).toLowerCase()
      section = h.includes('genre index') ? null
               : h.includes('series')     ? 'series'
               : h.includes('standalone') || h.includes('misc') ? 'standalone'
               : null
      seenHeader = false
      continue
    }

    if (!line.startsWith('|')) { seenHeader = false; continue }

    // Separator row (|---|---|)
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.every(c => /^[-:\s]*$/.test(c))) { seenHeader = true; continue }
    if (!seenHeader) { seenHeader = true; continue }  // column header row

    if (!section) continue

    if (section === 'series') {
      if (cells.length < 3) continue
      const seriesName = cleanCell(cells[0])
      const author     = cleanCell(cells[1])
      const genres     = parseGenres(cells[2])
      const booksRaw   = cleanCell(cells[3] || '')

      // Skip placeholder notes
      const skip = /^(full series|multiple|various|и др|standalones|multiple titles)/i.test(booksRaw)
      const books = skip ? [] : booksRaw
        .split('·')
        .map(t => cleanCell(t))
        .filter(t => t.length > 2 && !/^(т\.|vol\.|book\s*\d|ч\.|#\d)/i.test(t))
        .map((title, i) => ({ title, num: i + 1 }))

      if (seriesName) result.series.push({ name: seriesName, author, genres, books })

    } else if (section === 'standalone') {
      if (cells.length < 2) continue
      const title  = cleanCell(cells[0])
      const author = cleanCell(cells[1])
      const genres = parseGenres(cells[2] || '')

      // Skip meta-entries like "(+ other titles)"
      if (!title || /^\(/.test(title) || title.length < 2) continue
      if (/multiple|various|и др/i.test(title)) continue

      result.standalones.push({ title, author, genres })
    }
  }

  return result
}

// ── Matching ──────────────────────────────────────────────────────────────────

function findMatch(mdTitle, mdAuthor, dbBooks) {
  const nt = norm(mdTitle)
  const na = norm(mdAuthor)

  let best = null
  let bestScore = 0

  for (const b of dbBooks) {
    const bt = norm(b.title)
    const ba = norm(b.author_canonical || b.author)

    // Title score
    let ts = 0
    if (bt === nt)                         ts = 10
    else if (bt.includes(nt) || nt.includes(bt)) ts = 6
    else ts = wordOverlap(bt, nt) * 5

    if (ts < 2.5) continue

    // Author score — at least some word overlap required unless title is perfect
    const as_ = wordOverlap(ba, na) * 3
    if (as_ === 0 && ts < 8) continue

    const total = ts + as_
    if (total > bestScore) { bestScore = total; best = b }
  }

  return bestScore >= 3 ? { book: best, score: bestScore } : null
}

// ── Change builder ────────────────────────────────────────────────────────────

function buildProposedChanges(mdData, dbBooks) {
  const changes    = []
  const unmatched  = []
  const matchedIds = new Set()

  const tryMatch = (mdTitle, mdAuthor, mdSeries, mdNum, mdGenres) => {
    const m = findMatch(mdTitle, mdAuthor, dbBooks)
    if (!m || matchedIds.has(m.book.id)) {
      unmatched.push({ mdTitle, mdAuthor, mdSeries, mdNum, mdGenres })
      return
    }
    matchedIds.add(m.book.id)
    const b = m.book

    const curSubjects = (b.subjects || []).slice().sort().join('|')
    const newSubjects = mdGenres.slice().sort().join('|')

    const proposal = {
      matched:         true,
      bookId:          b.id,
      score:           Math.round(m.score * 10) / 10,
      currentTitle:    b.title,
      currentAuthor:   b.author_canonical || b.author,
      currentSeries:   b.series_name  || '',
      currentNum:      b.series_num   ?? null,
      currentSubjects: b.subjects     || [],
      newTitle:        mdTitle,
      newAuthor:       mdAuthor,
      newSeries:       mdSeries || '',
      newNum:          mdNum,
      newSubjects:     mdGenres,
      // flags for what's actually changing
      titleChanged:    b.title           !== mdTitle,
      authorChanged:   (b.author_canonical || b.author) !== mdAuthor,
      seriesChanged:   (b.series_name || '') !== (mdSeries || ''),
      numChanged:      (b.series_num ?? null) !== mdNum,
      subjectsChanged: curSubjects !== newSubjects,
    }

    proposal.anyChange = proposal.titleChanged || proposal.authorChanged ||
                         proposal.seriesChanged || proposal.numChanged   || proposal.subjectsChanged

    if (proposal.anyChange) changes.push(proposal)
  }

  // Series books first
  for (const s of mdData.series) {
    for (const { title, num } of s.books) {
      tryMatch(title, s.author, s.name, num, s.genres)
    }
  }

  // Standalones
  for (const { title, author, genres } of mdData.standalones) {
    tryMatch(title, author, '', null, genres)
  }

  return { changes, unmatched }
}

module.exports = { parseMd, buildProposedChanges }
