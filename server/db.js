/**
 * Pure-JS data store. No native modules — works on any Node version.
 *
 * Layout inside dataDir:
 *   books.json    – array of book objects (no cover blobs)
 *   states.json   – { [bookId]: { status, note, updated_at } }
 *   prefs.json    – { key: value }
 *   covers/       – {bookId}.jpg/png (served as static files)
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')

// ── helpers ────────────────────────────────────────────────────────────────────
// ISO 639-2 (three-letter, common in epub metadata) → ISO 639-1
const LANG_ALIASES = {
  eng: 'en', rus: 'ru', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es',
  ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', pol: 'pl', ukr: 'uk', jpn: 'ja',
  chi: 'zh', zho: 'zh', kor: 'ko', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi',
  cze: 'cs', ces: 'cs', tur: 'tr', ara: 'ar', heb: 'he', hin: 'hi', gre: 'el',
  ell: 'el', hun: 'hu', rum: 'ro', ron: 'ro', bul: 'bg', srp: 'sr', bel: 'be',
  kaz: 'kk', kat: 'ka', geo: 'ka', lav: 'lv', lit: 'lt', est: 'et',
}
function normLangCode(raw) {
  const code = (raw || '').toLowerCase().split(/[-_]/)[0].trim()
  if (!code || code === 'und') return ''
  return LANG_ALIASES[code] || code
}

function normTitleAuthor(s) {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

// Heuristic filename-quality score, used to auto-pick which copy of a duplicate
// to keep. Rewards the clean "Title by Author.ext" naming ShelfMind's own
// scanner falls back to; penalizes the underscore/dash/bracket/id-stuffed
// filenames typical of scene-release and archive-site exports.
const DUPLICATE_JUNK_MARKERS = [
  'z-lib', 'zlib', '1lib', 'libgen', "anna's archive", 'annas-archive',
  'oceanofpdf', 'bookfi', 'esokrat', 'flibusta', 'rulit', 'freeditorial',
]
function fileNameQualityScore(filePath) {
  const base = path.basename(filePath, path.extname(filePath))
  let score = 0

  if (/^.+ by .+$/i.test(base)) score += 30
  else if (/^.+ - .+$/.test(base) && !base.includes('--')) score += 15

  score -= (base.match(/_/g) || []).length * 3
  score -= (base.match(/--/g) || []).length * 10
  score -= (base.match(/[[\]]/g) || []).length * 5
  score -= (base.match(/\d{5,}/g) || []).length * 8
  if (/\.\w{2,5}$/.test(base)) score -= 15 // double extension, e.g. "....fb2.epub"
  if (/\(\s*copy(\s*\d+)?\s*\)|\scopy\s*\d*$/i.test(base)) score -= 20

  const lower = base.toLowerCase()
  for (const marker of DUPLICATE_JUNK_MARKERS) if (lower.includes(marker)) score -= 20

  const letters = base.replace(/[^a-zA-Zа-яА-Я]/g, '')
  const upper   = base.replace(/[^A-ZА-Я]/g, '')
  if (letters.length > 10 && upper.length / letters.length > 0.7) score -= 10 // ALL CAPS

  if (base.length > 80) score -= (base.length - 80) * 0.2

  return score
}
function pickBestCopy(books) {
  let best = books[0]
  let bestScore = fileNameQualityScore(best.path)
  for (const b of books.slice(1)) {
    const s = fileNameQualityScore(b.path)
    if (s > bestScore || (s === bestScore && (b.file_size || 0) > (best.file_size || 0))) {
      best = b
      bestScore = s
    }
  }
  return best
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { return fallback }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

// ── Store class ────────────────────────────────────────────────────────────────
class Store {
  constructor(dataDir) {
    this.dataDir  = dataDir
    this.coversDir = path.join(dataDir, 'covers')
    fs.mkdirSync(this.dataDir,   { recursive: true })
    fs.mkdirSync(this.coversDir, { recursive: true })

    this._booksFile   = path.join(dataDir, 'books.json')
    this._statesFile  = path.join(dataDir, 'states.json')
    this._prefsFile   = path.join(dataDir, 'prefs.json')
    this._listsFile   = path.join(dataDir, 'lists.json')
    this._pdfTabsFile = path.join(dataDir, 'pdfTabs.json')
    this._pdfDocsFile = path.join(dataDir, 'pdfDocs.json')

    this.books   = readJson(this._booksFile,   [])
    this.states  = readJson(this._statesFile,  {})
    this.prefs   = readJson(this._prefsFile,   {})
    this.lists   = readJson(this._listsFile,   [])
    this.pdfTabs = readJson(this._pdfTabsFile, [])
    this.pdfDocs = readJson(this._pdfDocsFile, [])

    // Seed default prefs
    const defaults = {
      library_path: 'E:\\Books',
      theme:        'light',
      default_view: 'grid',
      kindle_email: '',
      kindle_mode:  'web',
    }
    let changed = false
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in this.prefs)) { this.prefs[k] = v; changed = true }
    }
    if (changed) writeJson(this._prefsFile, this.prefs)

    // Index
    this._byId   = new Map(this.books.map(b => [b.id, b]))
    this._byPath = new Map(this.books.map(b => [b.path, b]))
  }

  // ── Covers ──────────────────────────────────────────────────────────────────
  saveCover(bookId, dataUrl) {
    if (!dataUrl) return
    try {
      const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!m) return
      const ext  = m[1] === 'jpeg' ? 'jpg' : m[1]
      const buf  = Buffer.from(m[2], 'base64')
      const file = path.join(this.coversDir, `${bookId}.${ext}`)
      fs.writeFileSync(file, buf)
      return `/covers/${bookId}.${ext}`
    } catch { return null }
  }

  coverPath(bookId) {
    for (const ext of ['jpg', 'png', 'webp', 'gif']) {
      const f = path.join(this.coversDir, `${bookId}.${ext}`)
      if (fs.existsSync(f)) return `/covers/${bookId}.${ext}`
    }
    return null
  }

  // PDF thumbnails share the covers/ dir but use a "pdf-" prefix so they can
  // never collide with a book id.
  savePdfCover(docId, dataUrl) { return this.saveCover(`pdf-${docId}`, dataUrl) }
  pdfCoverPath(docId)          { return this.coverPath(`pdf-${docId}`)
  }

  // ── Books ───────────────────────────────────────────────────────────────────
  upsertBook(book, coverDataUrl) {
    // Save cover separately
    if (coverDataUrl && !this.coverPath(book.id)) {
      const coverUrl = this.saveCover(book.id, coverDataUrl)
      if (coverUrl) book.cover_local = coverUrl
    }

    const existing = this._byId.get(book.id)
    if (existing) {
      Object.assign(existing, book)
    } else {
      this.books.push(book)
      this._byId.set(book.id, book)
      this._byPath.set(book.path, book)
    }
  }

  batchUpsert(entries) {
    // entries: [{ book, coverDataUrl }]
    for (const { book, coverDataUrl } of entries) {
      this.upsertBook(book, coverDataUrl)
    }
    writeJson(this._booksFile, this.books)
  }

  markRemoved(filePath) {
    const b = this._byPath.get(filePath)
    if (b) { b.removed = true }
  }

  flushBooks() {
    writeJson(this._booksFile, this.books)
  }

  getBook(id) {
    const b = this._byId.get(id)
    if (!b) return null
    return this._attachState(b)
  }

  getBooks(filters = {}) {
    let result = this.books.filter(b => !b.removed)

    if (filters.format)   result = result.filter(b => b.format === filters.format)
    if (filters.language) {
      const want = normLangCode(filters.language) || filters.language.toLowerCase()
      result = result.filter(b => normLangCode(b.language) === want)
    }
    if (filters.author)   result = result.filter(b => (b.author_canonical || b.author) === filters.author)
    if (filters.series)   result = result.filter(b => b.series_name === filters.series)
    if (filters.status) {
      if (filters.status === 'unread') {
        result = result.filter(b => {
          const s = this.states[b.id]?.status
          return !s || s === 'unread'
        })
      } else {
        result = result.filter(b => this.states[b.id]?.status === filters.status)
      }
    }

    return result.map(b => this._attachState(b))
  }

  _attachState(b) {
    const st = this.states[b.id] || {}
    return {
      ...b,
      cover_local:  b.cover_local || this.coverPath(b.id),
      read_status:  st.status     || 'unread',
      note:         st.note       || '',
      rating:       st.rating     ?? null,
      tags:         st.tags       || [],
      started_at:   st.started_at ?? null,
      finished_at:  st.finished_at ?? null,
    }
  }

  getExistingPathMtimes() {
    // Returns Map<path, mtime> for all non-removed books
    return new Map(
      this.books
        .filter(b => !b.removed)
        .map(b => [b.path, b.file_mtime])
    )
  }

  // ── States ──────────────────────────────────────────────────────────────────
  setStatus(bookId, status, note) {
    if (!this.states[bookId]) this.states[bookId] = {}
    this.states[bookId].status     = status
    this.states[bookId].updated_at = Date.now()
    if (note !== undefined) this.states[bookId].note = note
    writeJson(this._statesFile, this.states)
  }

  setStatusWithDates(bookId, status, note) {
    if (!this.states[bookId]) this.states[bookId] = {}
    const st  = this.states[bookId]
    const now = Math.floor(Date.now() / 1000)
    st.status     = status
    st.updated_at = Date.now()
    if (note !== undefined) st.note = note
    if (status === 'reading' && !st.started_at) st.started_at = now
    if (status === 'read'  && !st.finished_at) st.finished_at = now
    if (status === 'dnf'   && !st.finished_at) st.finished_at = now
    writeJson(this._statesFile, this.states)
  }

  setNote(bookId, note) {
    if (!this.states[bookId]) this.states[bookId] = {}
    this.states[bookId].note = note
    writeJson(this._statesFile, this.states)
  }

  setRating(bookId, rating) {
    if (!this.states[bookId]) this.states[bookId] = {}
    this.states[bookId].rating = rating
    writeJson(this._statesFile, this.states)
  }

  setTags(bookId, tags) {
    if (!this.states[bookId]) this.states[bookId] = {}
    this.states[bookId].tags = Array.isArray(tags) ? tags : []
    writeJson(this._statesFile, this.states)
  }

  setDates(bookId, { started_at, finished_at }) {
    if (!this.states[bookId]) this.states[bookId] = {}
    if (started_at  !== undefined) this.states[bookId].started_at  = started_at
    if (finished_at !== undefined) this.states[bookId].finished_at = finished_at
    writeJson(this._statesFile, this.states)
  }

  getAllTags() {
    const counts = {}
    for (const st of Object.values(this.states)) {
      if (!Array.isArray(st.tags)) continue
      for (const tag of st.tags) {
        counts[tag] = (counts[tag] || 0) + 1
      }
    }
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  // ── Bulk ─────────────────────────────────────────────────────────────────────
  bulkSetStatus(ids, status) {
    const now = Math.floor(Date.now() / 1000)
    for (const id of ids) {
      if (!this.states[id]) this.states[id] = {}
      const st  = this.states[id]
      st.status     = status
      st.updated_at = Date.now()
      if (status === 'reading' && !st.started_at)  st.started_at  = now
      if (status === 'read'    && !st.finished_at) st.finished_at = now
      if (status === 'dnf'     && !st.finished_at) st.finished_at = now
    }
    writeJson(this._statesFile, this.states)
  }

  bulkAddTag(ids, tag) {
    for (const id of ids) {
      if (!this.states[id]) this.states[id] = {}
      const tags = this.states[id].tags || []
      if (!tags.includes(tag)) tags.push(tag)
      this.states[id].tags = tags
    }
    writeJson(this._statesFile, this.states)
  }

  bulkRemove(ids) {
    for (const id of ids) {
      const b = this._byId.get(id)
      if (b) b.removed = true
    }
    writeJson(this._booksFile, this.books)
  }

  // ── Duplicates ───────────────────────────────────────────────────────────────
  getDuplicates() {
    const groups = {}
    for (const b of this.books.filter(b => !b.removed)) {
      const normTitle  = normTitleAuthor(b.title)
      const normAuthor = normTitleAuthor(b.author_canonical || b.author)
      if (!normTitle && !normAuthor) continue
      const key = normTitle + '|' + normAuthor
      if (!groups[key]) groups[key] = []
      groups[key].push(this._attachState(b))
    }
    return Object.entries(groups)
      .filter(([, books]) => books.length > 1)
      .map(([key, books]) => {
        const keep = pickBestCopy(books)
        return { key, books: books.map(b => ({ ...b, suggested_keep: b.id === keep.id })) }
      })
  }

  // ── Recommendations ───────────────────────────────────────────────────────────
  getRecommendations(limit = 5) {
    const allBooks   = this.books.filter(b => !b.removed)
    const unread     = allBooks.filter(b => {
      const s = this.states[b.id]?.status
      return !s || s === 'unread'
    })

    // Get last 10 read books (by finished_at or updated_at desc)
    const read = allBooks
      .filter(b => this.states[b.id]?.status === 'read')
      .sort((a, b) => {
        const fa = this.states[a.id]?.finished_at || this.states[a.id]?.updated_at || 0
        const fb = this.states[b.id]?.finished_at || this.states[b.id]?.updated_at || 0
        return fb - fa
      })
      .slice(0, 10)

    const recentAuthors  = new Set(read.map(b => b.author_canonical || b.author).filter(Boolean))
    const recentSubjects = new Set(read.flatMap(b => b.subjects || []).map(s => s.toLowerCase()))
    const seriesWithRead = new Set()
    for (const b of read) { if (b.series_name) seriesWithRead.add(b.series_name) }

    const scored = unread.map(b => {
      let score = 0
      const author = b.author_canonical || b.author
      if (author && recentAuthors.has(author)) score += 3
      const subjects = (b.subjects || []).map(s => s.toLowerCase())
      for (const s of subjects) { if (recentSubjects.has(s)) score += 1 }
      if (b.series_name && seriesWithRead.has(b.series_name)) score += 1
      // Slight random shuffle within same score
      score += Math.random() * 0.5
      return { book: this._attachState(b), score }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(s => s.book)
  }

  // ── Prefs ───────────────────────────────────────────────────────────────────
  getPref(key)        { return this.prefs[key] ?? null }
  setPref(key, value) { this.prefs[key] = value; writeJson(this._prefsFile, this.prefs) }
  getPrefs()          { return { ...this.prefs } }
  setPrefs(obj) {
    Object.assign(this.prefs, obj)
    writeJson(this._prefsFile, this.prefs)
  }

  // ── Insights ─────────────────────────────────────────────────────────────────
  getInsights() {
    const books = this.books.filter(b => !b.removed)
    const total = books.length

    // Status
    const sm = {}
    for (const b of books) {
      const s = this.states[b.id]?.status || 'unread'
      sm[s] = (sm[s] || 0) + 1
    }
    const byStatus = Object.entries(sm).map(([status, count]) => ({ status, count }))

    // Format
    const fm = {}
    for (const b of books) { fm[b.format] = (fm[b.format] || 0) + 1 }
    const byFormat = Object.entries(fm).map(([format, count]) => ({ format, count })).sort((a, b) => b.count - a.count)

    // Language — proper name for whatever languages the library actually has
    const lm = {}
    let langNames = null
    try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }) } catch { /* no ICU */ }
    for (const b of books) {
      const code = normLangCode(b.language)
      let l = 'Unknown'
      if (code) {
        try { l = langNames?.of(code) || code.toUpperCase() } catch { l = code.toUpperCase() }
        if (l === code) l = code.toUpperCase()
        else l = l[0].toUpperCase() + l.slice(1)
      }
      lm[l] = (lm[l] || 0) + 1
    }
    const byLanguage = Object.entries(lm).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count)

    // Author
    const am = {}
    for (const b of books) {
      const a = b.author_canonical || b.author || 'Unknown'
      am[a] = (am[a] || 0) + 1
    }
    const byAuthor = Object.entries(am)
      .map(([author, count]) => ({ author, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    // Series
    const sm2 = {}
    for (const b of books) {
      if (!b.series_name) continue
      if (!sm2[b.series_name]) sm2[b.series_name] = { total: 0, read_count: 0 }
      sm2[b.series_name].total++
      if (this.states[b.id]?.status === 'read') sm2[b.series_name].read_count++
    }
    const bySeries = Object.entries(sm2)
      .filter(([, v]) => v.total > 1)
      .map(([series_name, v]) => ({ series_name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15)

    // Over time
    const tm = {}
    for (const b of books) {
      if (!b.added_at) continue
      const d = new Date(b.added_at * 1000)
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      tm[month] = (tm[month] || 0) + 1
    }
    const addedOverTime = Object.entries(tm).sort().map(([month, count]) => ({ month, count }))

    return { total, byStatus, byFormat, byLanguage, byAuthor, bySeries, addedOverTime }
  }

  // ── Dropdowns ─────────────────────────────────────────────────────────────────
  getAuthors() {
    const m = {}
    for (const b of this.books.filter(b => !b.removed)) {
      const a = b.author_canonical || b.author
      if (a) m[a] = (m[a] || 0) + 1
    }
    return Object.entries(m)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  getSeries() {
    const m = {}
    for (const b of this.books.filter(b => !b.removed)) {
      if (b.series_name) m[b.series_name] = (m[b.series_name] || 0) + 1
    }
    return Object.entries(m)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getLanguages() {
    // Distinct primary language subtags ("en-US" → "en") with counts
    const m = {}
    for (const b of this.books.filter(b => !b.removed)) {
      const code = normLangCode(b.language)
      if (!code) continue // missing or "undetermined"
      m[code] = (m[code] || 0) + 1
    }
    return Object.entries(m)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  }

  // ── Enrichment ────────────────────────────────────────────────────────────────
  getUnenrichedBooks(force = false) {
    if (force) return this.books.filter(b => !b.removed)
    return this.books.filter(b => !b.removed && !b.enriched)
  }

  resetEnrichment(onlyFailed = false) {
    let count = 0
    for (const b of this.books) {
      if (b.removed) continue
      if (!onlyFailed || b.enriched === 'failed') {
        b.enriched = false
        count++
      }
    }
    writeJson(this._booksFile, this.books)
    return count
  }

  applyEnrichment(bookId, data, coverDataUrl) {
    const b = this._byId.get(bookId)
    if (!b) return
    if (data.author_canonical) b.author_canonical = data.author_canonical
    if (data.subjects?.length) b.subjects         = data.subjects
    if (data.series_name)      b.series_name      = b.series_name || data.series_name
    if (data.ol_key)           b.ol_key           = data.ol_key
    if (data.cover_i)          b.cover_url        = `https://covers.openlibrary.org/b/id/${data.cover_i}-M.jpg`

    // Save cover image locally if downloaded
    if (coverDataUrl && !b.cover_local) {
      const localPath = this.saveCover(bookId, coverDataUrl)
      if (localPath) b.cover_local = localPath
    }

    b.enriched = true
    writeJson(this._booksFile, this.books)
  }

  markEnrichFailed(bookId) {
    const b = this._byId.get(bookId)
    if (b) { b.enriched = 'failed'; writeJson(this._booksFile, this.books) }
  }

  updateMeta(bookId, fields) {
    const b = this._byId.get(bookId)
    if (!b) return null
    const allowed = ['title', 'author', 'author_canonical', 'series_name', 'series_num', 'language', 'description', 'subjects']
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) b[k] = v
    }
    b.manually_edited = true
    writeJson(this._booksFile, this.books)
    return b
  }

  setCover(bookId, dataUrl) {
    const coverPath = this.saveCover(bookId, dataUrl)
    if (!coverPath) return
    const b = this._byId.get(bookId)
    if (b) {
      b.cover_local = coverPath
      b.cover_updated_at = Date.now()
      writeJson(this._booksFile, this.books)
    }
  }

  getBooksNeedingCovers() {
    return this.books.filter(b =>
      !b.removed &&
      b.format === 'epub' &&
      !this.coverPath(b.id) &&
      !b.cover_url
    )
  }

  updateBookPath(bookId, newPath) {
    const b = this._byId.get(bookId)
    if (!b) return null
    this._byPath.delete(b.path)
    b.path = newPath
    this._byPath.set(newPath, b)
    writeJson(this._booksFile, this.books)
    return b
  }

  removeBook(bookId) {
    const b = this._byId.get(bookId)
    if (!b) return null
    b.removed = true
    writeJson(this._booksFile, this.books)
    return b
  }

  // ── Reading Lists (shelves — hold books and PDFs) ─────────────────────────────
  getLists() {
    return this.lists.map(l => ({
      ...l,
      book_count: l.book_ids.length,
      pdf_count:  (l.pdf_doc_ids || []).length,
    }))
  }

  getList(id) {
    const l = this.lists.find(l => l.id === id)
    if (!l) return null

    // A book_id can go stale when its file gets moved and the scanner marks the
    // old path removed while creating a fresh entry for the new location. Try to
    // re-point stale entries at the live book with matching title+author; if no
    // live match exists, surface a "missing" placeholder instead of silently
    // dropping it, so the user can see what happened and remove it if they want.
    const liveByKey = new Map()
    for (const b of this.books) {
      if (b.removed) continue
      const key = normTitleAuthor(b.title) + '|' + normTitleAuthor(b.author_canonical || b.author)
      if (!liveByKey.has(key)) liveByKey.set(key, b)
    }

    let listChanged = false
    const books = []
    for (const bid of l.book_ids) {
      const b = this._byId.get(bid)
      if (!b) continue // book_id doesn't exist at all — nothing to recover
      if (!b.removed) { books.push(this._attachState(b)); continue }

      const key   = normTitleAuthor(b.title) + '|' + normTitleAuthor(b.author_canonical || b.author)
      const match = liveByKey.get(key)
      if (match && !l.book_ids.includes(match.id)) {
        const idx = l.book_ids.indexOf(bid)
        l.book_ids[idx] = match.id
        listChanged = true
        books.push(this._attachState(match))
      } else {
        books.push({ id: bid, title: b.title, author: b.author_canonical || b.author, missing: true })
      }
    }
    if (listChanged) writeJson(this._listsFile, this.lists)

    const tabNames = new Map(this.pdfTabs.map(t => [t.id, t.name]))
    const pdf_docs = (l.pdf_doc_ids || [])
      .map(did => this.pdfDocs.find(d => d.id === did))
      .filter(Boolean)
      .map(d => ({ ...d, missing: !fs.existsSync(d.path), tab_name: tabNames.get(d.tab_id) || '', cover: this.pdfCoverPath(d.id) }))
    return { ...l, books, pdf_docs }
  }

  createList(name, description = '') {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const now = Math.floor(Date.now() / 1000)
    const list = { id, name, description, book_ids: [], pdf_doc_ids: [], created_at: now, updated_at: now }
    this.lists.push(list)
    writeJson(this._listsFile, this.lists)
    return list
  }

  updateList(id, fields) {
    const l = this.lists.find(l => l.id === id)
    if (!l) return null
    if (fields.name        !== undefined) l.name        = fields.name
    if (fields.description !== undefined) l.description = fields.description
    l.updated_at = Math.floor(Date.now() / 1000)
    writeJson(this._listsFile, this.lists)
    return l
  }

  deleteList(id) {
    const idx = this.lists.findIndex(l => l.id === id)
    if (idx === -1) return false
    this.lists.splice(idx, 1)
    writeJson(this._listsFile, this.lists)
    return true
  }

  addBookToList(listId, bookId) {
    const l = this.lists.find(l => l.id === listId)
    if (!l) return false
    if (!l.book_ids.includes(bookId)) {
      l.book_ids.push(bookId)
      l.updated_at = Math.floor(Date.now() / 1000)
      writeJson(this._listsFile, this.lists)
    }
    return true
  }

  removeBookFromList(listId, bookId) {
    const l = this.lists.find(l => l.id === listId)
    if (!l) return false
    l.book_ids = l.book_ids.filter(id => id !== bookId)
    l.updated_at = Math.floor(Date.now() / 1000)
    writeJson(this._listsFile, this.lists)
    return true
  }

  addPdfToList(listId, docId) {
    const l = this.lists.find(l => l.id === listId)
    if (!l) return false
    if (!this.pdfDocs.some(d => d.id === docId)) return false
    if (!l.pdf_doc_ids) l.pdf_doc_ids = []
    if (!l.pdf_doc_ids.includes(docId)) {
      l.pdf_doc_ids.push(docId)
      l.updated_at = Math.floor(Date.now() / 1000)
      writeJson(this._listsFile, this.lists)
    }
    return true
  }

  removePdfFromList(listId, docId) {
    const l = this.lists.find(l => l.id === listId)
    if (!l) return false
    l.pdf_doc_ids = (l.pdf_doc_ids || []).filter(id => id !== docId)
    l.updated_at = Math.floor(Date.now() / 1000)
    writeJson(this._listsFile, this.lists)
    return true
  }

  _removePdfDocsFromLists(docIds) {
    const gone = new Set(docIds)
    let changed = false
    for (const l of this.lists) {
      if (!l.pdf_doc_ids?.some(id => gone.has(id))) continue
      l.pdf_doc_ids = l.pdf_doc_ids.filter(id => !gone.has(id))
      changed = true
    }
    if (changed) writeJson(this._listsFile, this.lists)
  }

  // ── PDF Tabs ──────────────────────────────────────────────────────────────────
  getPdfTabs() {
    return this.pdfTabs.map(t => ({
      ...t,
      doc_count: this.pdfDocs.filter(d => d.tab_id === t.id).length,
    }))
  }

  getPdfTab(id) {
    const t = this.pdfTabs.find(t => t.id === id)
    if (!t) return null
    const docs = this.pdfDocs
      .filter(d => d.tab_id === id)
      .map(d => ({ ...d, missing: !fs.existsSync(d.path), cover: this.pdfCoverPath(d.id) }))
    return { ...t, docs }
  }

  createPdfTab(name) {
    const id  = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const now = Math.floor(Date.now() / 1000)
    const tab = { id, name, folder_path: '', created_at: now, updated_at: now }
    this.pdfTabs.push(tab)
    writeJson(this._pdfTabsFile, this.pdfTabs)
    return tab
  }

  updatePdfTab(id, fields) {
    const t = this.pdfTabs.find(t => t.id === id)
    if (!t) return null
    if (fields.name        !== undefined) t.name        = fields.name
    if (fields.folder_path !== undefined) t.folder_path = fields.folder_path
    t.updated_at = Math.floor(Date.now() / 1000)
    writeJson(this._pdfTabsFile, this.pdfTabs)
    return t
  }

  deletePdfTab(id) {
    const idx = this.pdfTabs.findIndex(t => t.id === id)
    if (idx === -1) return false
    this.pdfTabs.splice(idx, 1)
    const goneIds = this.pdfDocs.filter(d => d.tab_id === id).map(d => d.id)
    this.pdfDocs = this.pdfDocs.filter(d => d.tab_id !== id)
    writeJson(this._pdfTabsFile, this.pdfTabs)
    writeJson(this._pdfDocsFile, this.pdfDocs)
    this._removePdfDocsFromLists(goneIds)
    return true
  }

  addPdfDocs(tabId, paths) {
    const tab = this.pdfTabs.find(t => t.id === tabId)
    if (!tab) return null
    const now   = Math.floor(Date.now() / 1000)
    const added = []
    for (const p of paths) {
      if (this.pdfDocs.some(d => d.tab_id === tabId && d.path === p)) continue
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const doc = {
        id,
        tab_id:   tabId,
        path:     p,
        title:    path.basename(p, path.extname(p)),
        tags:     [],
        note:     '',
        added_at: now,
      }
      this.pdfDocs.push(doc)
      added.push(doc)
    }
    if (added.length) writeJson(this._pdfDocsFile, this.pdfDocs)
    return added
  }

  getPdfDoc(id) {
    return this.pdfDocs.find(d => d.id === id) || null
  }

  getPdfDocFull(id) {
    const d = this.getPdfDoc(id)
    if (!d) return null
    const tab = this.pdfTabs.find(t => t.id === d.tab_id)
    return { ...d, missing: !fs.existsSync(d.path), tab_name: tab?.name || '', cover: this.pdfCoverPath(d.id) }
  }

  updatePdfDoc(id, fields) {
    const d = this.pdfDocs.find(d => d.id === id)
    if (!d) return null
    if (fields.title  !== undefined) d.title = fields.title
    if (fields.note   !== undefined) d.note  = fields.note
    if (fields.tags   !== undefined) d.tags  = Array.isArray(fields.tags) ? fields.tags : []
    if (fields.tab_id !== undefined && this.pdfTabs.some(t => t.id === fields.tab_id)) d.tab_id = fields.tab_id
    writeJson(this._pdfDocsFile, this.pdfDocs)
    return d
  }

  deletePdfDoc(id) {
    const idx = this.pdfDocs.findIndex(d => d.id === id)
    if (idx === -1) return false
    this.pdfDocs.splice(idx, 1)
    writeJson(this._pdfDocsFile, this.pdfDocs)
    this._removePdfDocsFromLists([id])
    return true
  }

  getAllPdfDocs() {
    const tabNames = new Map(this.pdfTabs.map(t => [t.id, t.name]))
    return this.pdfDocs.map(d => ({ ...d, tab_name: tabNames.get(d.tab_id) || '', cover: this.pdfCoverPath(d.id) }))
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let store = null

function getStore() {
  if (store) return store
  let dataDir
  if (process.env.SHELFMIND_DATA) {
    dataDir = process.env.SHELFMIND_DATA
  } else {
    try {
      const { app } = require('electron')
      dataDir = path.join(app.getPath('userData'), 'ShelfMind')
    } catch {
      dataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'ShelfMind')
    }
  }
  store = new Store(dataDir)
  return store
}

module.exports = { getStore }
