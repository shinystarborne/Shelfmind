const express = require('express')
const cors    = require('cors')
const path    = require('path')
const os      = require('os')
const fs      = require('fs')
const { getStore }   = require('./db')
const { scan, parseEpub, getEpubImages } = require('./scanner')
const { enrichAll, enrichOne } = require('./enricher')
const { writeEpubMeta } = require('./epubWriter')

let scanState   = { running: false, current: 0, total: 0, added: 0, done: false, error: null }
let enrichState = { running: false, current: 0, total: 0, success: 0, done: false }

function getRemovedDir(store) {
  const libraryPath = store.getPref('library_path') || 'E:\\Books'
  return path.join(libraryPath, '_Removed')
}

// Moves a book's file into <library>\_Removed\ — never a hard delete.
function moveBookToRemoved(book, libraryPath) {
  const removedDir = path.join(libraryPath, '_Removed')
  fs.mkdirSync(removedDir, { recursive: true })
  let dest = path.join(removedDir, path.basename(book.path))
  if (fs.existsSync(dest)) {
    const ext  = path.extname(dest)
    const base = path.basename(dest, ext)
    dest = path.join(removedDir, `${base}_${Date.now()}${ext}`)
  }
  fs.renameSync(book.path, dest)
  return dest
}

function startServer(port = 3001) {
  return new Promise(resolve => {
    const app   = express()
    const store = getStore()

    app.use(cors())
    app.use(express.json({ limit: '25mb' }))

    // Serve book covers as static files
    app.use('/covers', express.static(path.join(store.coversDir)))

    // ── Books ──────────────────────────────────────────────────────────────────

    app.get('/api/books', (req, res) => {
      const { format, language, status, author, series } = req.query
      const books = store.getBooks({ format, language, status, author, series })
      res.json(books)
    })

    app.get('/api/books/:id', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      res.json(book)
    })

    app.put('/api/books/:id/status', (req, res) => {
      const { status, note } = req.body
      store.setStatusWithDates(req.params.id, status, note)
      res.json({ ok: true })
    })

    app.put('/api/books/:id/note', (req, res) => {
      store.setNote(req.params.id, req.body.note)
      res.json({ ok: true })
    })

    app.put('/api/books/:id/rating', (req, res) => {
      const { rating } = req.body
      store.setRating(req.params.id, rating === undefined ? null : rating)
      res.json({ ok: true })
    })

    app.put('/api/books/:id/tags', (req, res) => {
      store.setTags(req.params.id, req.body.tags || [])
      res.json({ ok: true })
    })

    app.put('/api/books/:id/dates', (req, res) => {
      const { started_at, finished_at } = req.body
      store.setDates(req.params.id, { started_at, finished_at })
      res.json({ ok: true })
    })

    // ── In-app EPUB reader ─────────────────────────────────────────────────────

    app.get('/api/books/:id/epub/structure', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      if (book.format !== 'epub') return res.status(400).json({ error: 'Not an epub' })
      try {
        const { getStructure } = require('./epubReader')
        res.json(getStructure(book.path))
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    app.get('/api/books/:id/epub/res/*', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      try {
        const { getResource } = require('./epubReader')
        const r = getResource(book.path, req.params[0])
        if (!r) return res.status(404).json({ error: 'Entry not found in epub' })
        res.setHeader('Content-Type', r.mime)
        res.setHeader('Cache-Control', 'no-cache')
        res.send(r.data)
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    app.put('/api/books/:id/position', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      const { spine, frac, percent } = req.body || {}
      if (typeof spine !== 'number') return res.status(400).json({ error: 'spine index required' })
      store.setReadingPosition(req.params.id, {
        spine,
        frac:    typeof frac    === 'number' ? Math.max(0, Math.min(1, frac))    : 0,
        percent: typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0,
      })
      // Opening a fresh book and actually reading it: promote unread → reading.
      // Any real movement counts — percent alone stays ~0 for ages in big books.
      const movedIn = spine > 0 || (frac || 0) > 0.05 || (percent || 0) > 1
      if ((book.read_status === 'unread' || !book.read_status) && movedIn) {
        store.setStatusWithDates(req.params.id, 'reading')
      }
      res.json({ ok: true })
    })

    app.get('/api/books/:id/epub-images', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      if (book.format !== 'epub') return res.json([])
      const images = getEpubImages(book.path)
      res.json(images)
    })

    app.post('/api/books/:id/extract-cover', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      if (book.format !== 'epub') return res.json({ ok: false, error: 'Only EPUB files support cover extraction' })
      try {
        const parsed = parseEpub(book.path)
        if (!parsed?.coverData) return res.json({ ok: false, error: 'No cover found in this epub' })
        store.setCover(book.id, parsed.coverData)
        res.json({ ok: true, cover: store.coverPath(book.id) })
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message })
      }
    })

    app.post('/api/books/:id/cover', (req, res) => {
      const { dataUrl } = req.body
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return res.status(400).json({ error: 'dataUrl must be a base64 image data URL' })
      }
      store.setCover(req.params.id, dataUrl)
      res.json({ ok: true, cover: store.coverPath(req.params.id) })
    })

    app.put('/api/books/:id/meta', (req, res) => {
      const updated = store.updateMeta(req.params.id, req.body)
      if (!updated) return res.status(404).json({ error: 'Not found' })
      res.json({ ok: true, book: store.getBook(req.params.id) })
    })

    app.post('/api/books/:id/remove', async (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })

      const libraryPath = store.getPref('library_path') || 'E:\\Books'
      try {
        const dest = moveBookToRemoved(book, libraryPath)
        store.removeBook(req.params.id)
        res.json({ ok: true, movedTo: dest })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // ── Rename file on disk using current metadata ─────────────────────────────

    function buildRenameTarget(book) {
      const sanitize = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
      const title  = sanitize(book.title  || 'Unknown Title')
      const author = sanitize(book.author_canonical || book.author || '')
      const series = sanitize(book.series_name || '')
      const num    = book.series_num != null ? String(book.series_num) : ''
      const ext    = path.extname(book.path)

      let base
      if (author && series) {
        base = `${author} - ${series}${num ? ' ' + num : ''} - ${title}`
      } else if (author) {
        base = `${author} - ${title}`
      } else {
        base = title
      }

      // Truncate to 200 chars (leave room for ext + collision suffix)
      if (base.length > 200) base = base.slice(0, 200).trimEnd()

      return { base, ext, dir: path.dirname(book.path) }
    }

    app.get('/api/books/:id/rename-preview', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      const { base, ext } = buildRenameTarget(book)
      const currentName = path.basename(book.path)
      const newName     = base + ext
      res.json({ currentName, newName, unchanged: currentName === newName })
    })

    app.post('/api/books/:id/rename-file', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      const { base, ext, dir } = buildRenameTarget(book)
      let newPath = path.join(dir, base + ext)

      if (newPath === book.path) {
        return res.json({ ok: true, unchanged: true, newName: path.basename(newPath) })
      }
      if (fs.existsSync(newPath)) {
        newPath = path.join(dir, `${base}_${Date.now()}${ext}`)
      }
      try {
        fs.renameSync(book.path, newPath)
        store.updateBookPath(book.id, newPath)
        res.json({ ok: true, newPath, newName: path.basename(newPath), oldPath: book.path })
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message })
      }
    })

    // Write metadata back to the actual epub file
    app.post('/api/books/:id/write-file', (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      if (book.format !== 'epub') return res.json({ ok: false, error: 'Only EPUB files support write-back' })
      const result = writeEpubMeta(book.path, req.body)
      res.json(result)
    })

    // Fetch OL preview without saving (for the edit panel)
    app.get('/api/books/:id/ol-preview', async (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      const { queryOpenLibrary } = require('./enricher')
      const data = await queryOpenLibrary(book.title, book.author)
      if (!data) return res.json({ found: false })
      res.json({ found: true, ...data,
        cover_url: data.cover_i ? `https://covers.openlibrary.org/b/id/${data.cover_i}-M.jpg` : null
      })
    })

    // ── Scan ───────────────────────────────────────────────────────────────────

    app.post('/api/scan', async (req, res) => {
      if (scanState.running) return res.json({ ok: false, message: 'Already scanning' })
      const libraryPath = store.getPref('library_path') || 'E:\\Books'
      scanState = { running: true, current: 0, total: 0, added: 0, done: false, error: null }
      res.json({ ok: true })

      scan(store, libraryPath, progress => {
        scanState.current = progress.current
        scanState.total   = progress.total
        scanState.added   = progress.added || 0
      })
        .then(result => { scanState = { ...result, running: false, done: true, error: null } })
        .catch(err  => { scanState = { ...scanState, running: false, done: true, error: err.message } })
    })

    app.get('/api/scan/status', (_, res) => res.json(scanState))

    // ── Enrich ─────────────────────────────────────────────────────────────────

    app.post('/api/enrich/all', (req, res) => {
      if (enrichState.running) return res.json({ ok: false, message: 'Already enriching' })
      const force       = req.body?.force === true
      const resetFailed = req.body?.reset_failed === true

      // Optionally reset enrichment flags first
      if (force)       store.resetEnrichment(false)  // reset all
      else if (resetFailed) store.resetEnrichment(true)   // reset only failed

      enrichState = { running: true, current: 0, total: 0, success: 0, done: false }
      res.json({ ok: true })

      enrichAll(store, p => { Object.assign(enrichState, p) }, force)
        .then(r  => { enrichState = { ...r, running: false, done: true } })
        .catch(() => { enrichState.running = false; enrichState.done = true })
    })

    app.post('/api/enrich/:id', async (req, res) => {
      const book = store.getBook(req.params.id)
      if (!book) return res.status(404).json({ error: 'Not found' })
      const ok = await enrichOne(book, store)
      res.json({ ok, book: store.getBook(req.params.id) })
    })

    app.get('/api/enrich/status', (_, res) => res.json(enrichState))

    // ── Insights ───────────────────────────────────────────────────────────────

    app.get('/api/insights', (_, res) => res.json(store.getInsights()))

    // ── Preferences ────────────────────────────────────────────────────────────

    app.get('/api/preferences', (_, res) => res.json(store.getPrefs()))

    app.put('/api/preferences', (req, res) => {
      const allowed = ['library_path', 'kindle_email', 'kindle_mode', 'theme', 'default_view', 'reading_goal']
      const update  = {}
      for (const k of allowed) { if (k in req.body) update[k] = req.body[k] }
      store.setPrefs(update)
      res.json(store.getPrefs())
    })

    // ── Bulk ───────────────────────────────────────────────────────────────────

    app.post('/api/bulk', (req, res) => {
      const { ids, action, value } = req.body
      if (!Array.isArray(ids) || !action) return res.status(400).json({ error: 'ids and action required' })
      if (action === 'status') store.bulkSetStatus(ids, value)
      else if (action === 'tags') store.bulkAddTag(ids, value)
      else if (action === 'remove') store.bulkRemove(ids)
      else return res.status(400).json({ error: 'unknown action' })
      res.json({ ok: true, count: ids.length })
    })

    // ── Duplicates ─────────────────────────────────────────────────────────────

    app.get('/api/duplicates', (_, res) => res.json(store.getDuplicates()))

    // Keeps the suggested copy per group (best-formatted filename), moves the
    // rest to _Removed. Never touches groups down to a single copy already.
    app.post('/api/duplicates/remove-all', (_, res) => {
      const groups     = store.getDuplicates()
      const libraryPath = store.getPref('library_path') || 'E:\\Books'
      const movedIds   = []
      const errors     = []

      for (const g of groups) {
        const keep = g.books.find(b => b.suggested_keep) || g.books[0]
        for (const b of g.books) {
          if (b.id === keep.id) continue
          try {
            moveBookToRemoved(b, libraryPath)
            movedIds.push(b.id)
          } catch (err) {
            errors.push(`${b.title}: ${err.message}`)
          }
        }
      }
      if (movedIds.length) store.bulkRemove(movedIds)
      res.json({ ok: true, removed: movedIds.length, groups: groups.length, errors })
    })

    // ── _Removed folder ────────────────────────────────────────────────────────

    app.get('/api/removed-folder', (_, res) => {
      const dir = getRemovedDir(store)
      if (!fs.existsSync(dir)) return res.json({ path: dir, fileCount: 0, totalSize: 0 })
      let fileCount = 0, totalSize = 0
      for (const name of fs.readdirSync(dir)) {
        const stat = fs.statSync(path.join(dir, name))
        if (stat.isFile()) { fileCount++; totalSize += stat.size }
      }
      res.json({ path: dir, fileCount, totalSize })
    })

    // Permanently deletes every file directly inside _Removed. Unlike every
    // other "remove" action in the app, this is a real, unrecoverable delete —
    // only touches files (not subfolders), so it can't wipe something unrelated.
    app.post('/api/removed-folder/empty', (_, res) => {
      const dir = getRemovedDir(store)
      if (!fs.existsSync(dir)) return res.json({ ok: true, deleted: 0, freedBytes: 0, errors: [] })
      let deleted = 0, freedBytes = 0
      const errors = []
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        try {
          const stat = fs.statSync(full)
          if (!stat.isFile()) continue
          freedBytes += stat.size
          fs.unlinkSync(full)
          deleted++
        } catch (err) {
          errors.push(`${name}: ${err.message}`)
        }
      }
      res.json({ ok: true, deleted, freedBytes, errors })
    })

    // ── Recommendations ────────────────────────────────────────────────────────

    app.get('/api/recommendations', (req, res) => {
      const limit = parseInt(req.query.limit) || 5
      res.json(store.getRecommendations(limit))
    })

    // ── Meta (dropdowns) ───────────────────────────────────────────────────────

    app.get('/api/meta/authors', (_, res) => res.json(store.getAuthors()))
    app.get('/api/meta/series',  (_, res) => res.json(store.getSeries()))
    app.get('/api/meta/tags',    (_, res) => res.json(store.getAllTags()))
    app.get('/api/meta/languages', (_, res) => res.json(store.getLanguages()))

    // ── Library MD Import ─────────────────────────────────────────────────────

    app.get('/api/import/library-md/preview', (req, res) => {
      const libraryPath = store.getPref('library_path') || 'E:\\Books'
      const mdPath = path.join(libraryPath, 'library_series_genres.md')
      if (!fs.existsSync(mdPath)) {
        return res.status(404).json({ error: `library_series_genres.md not found in ${libraryPath}` })
      }
      try {
        const { parseMd, buildProposedChanges } = require('./libraryImport')
        const mdData  = parseMd(mdPath)
        const dbBooks = store.getBooks()
        const result  = buildProposedChanges(mdData, dbBooks)
        res.json(result)
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    app.post('/api/import/library-md/apply', (req, res) => {
      const { changes } = req.body
      if (!Array.isArray(changes)) return res.status(400).json({ error: 'changes array required' })
      let applied = 0
      for (const c of changes) {
        if (!c.matched || !c.bookId) continue
        store.updateMeta(c.bookId, {
          title:            c.newTitle,
          author:           c.newAuthor,
          author_canonical: c.newAuthor,
          series_name:      c.newSeries  || '',
          series_num:       c.newNum     ?? null,
          subjects:         c.newSubjects || [],
        })
        applied++
      }
      res.json({ ok: true, applied })
    })

    // ── StoryGraph Export ──────────────────────────────────────────────────────

    app.get('/api/export/storygraph', (req, res) => {
      const books = store.getBooks()
      const STATUS_MAP = { read: 'read', reading: 'currently-reading', unread: 'to-read', dnf: 'did-not-finish' }
      const fmt = (ts) => {
        if (!ts) return ''
        const d = new Date(ts * 1000)
        return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
      }
      const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`
      const rows = [
        'Title,Authors,ISBN/UID,My Rating,Average Rating,Formats,Tags,Genres,Read Status,Date Added,Last Date Read,Pages/Duration,Read Count,Owned Copies',
        ...books.map(b => [
          esc(b.title),
          esc(b.author_canonical || b.author),
          esc(''),
          b.rating != null ? b.rating : '',
          '',
          esc(b.format || ''),
          esc((b.tags || []).join(', ')),
          esc((b.subjects || []).join(', ')),
          STATUS_MAP[b.read_status] || 'to-read',
          fmt(b.added_at),
          fmt(b.finished_at),
          '',
          b.read_status === 'read' ? 1 : 0,
          1,
        ].join(','))
      ]
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="shelfmind-storygraph.csv"')
      res.send(rows.join('\n'))
    })

    // ── StoryGraph Import ──────────────────────────────────────────────────────

    app.post('/api/import/storygraph', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
      const csv = req.body
      if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'CSV body required' })

      function parseCSV(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        const header = parseRow(lines[0])
        const result = []
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue
          const cols = parseRow(line)
          const obj = {}
          header.forEach((h, idx) => { obj[h.trim()] = (cols[idx] || '').trim() })
          result.push(obj)
        }
        return result
      }

      function parseRow(line) {
        const cols = []; let cur = ''; let inQ = false
        for (let i = 0; i < line.length; i++) {
          const c = line[i]
          if (c === '"') { inQ = !inQ }
          else if (c === ',' && !inQ) { cols.push(cur); cur = '' }
          else cur += c
        }
        cols.push(cur)
        return cols
      }

      function norm(s) {
        return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
      }

      const STATUS_MAP = { 'read': 'read', 'currently-reading': 'reading', 'to-read': 'unread', 'did-not-finish': 'dnf' }
      const rows       = parseCSV(csv)
      const allBooks   = store.getBooks()
      let matched = 0, unmatched = 0

      for (const row of rows) {
        const normTitle  = norm(row['Title'])
        const normAuthor = norm(row['Authors'])
        const found = allBooks.find(b => {
          const bt = norm(b.title)
          const ba = norm(b.author_canonical || b.author)
          return bt === normTitle && ba === normAuthor
        })
        if (!found) { unmatched++; continue }

        const status = STATUS_MAP[row['Read Status']] || null
        if (status) store.setStatusWithDates(found.id, status)

        const ratingRaw = parseInt(row['My Rating'])
        if (!isNaN(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5) store.setRating(found.id, ratingRaw)

        if (row['Tags']) {
          const importedTags = row['Tags'].split(',').map(t => t.trim()).filter(Boolean)
          const existing = store.states[found.id]?.tags || []
          const merged   = [...new Set([...existing, ...importedTags])]
          store.setTags(found.id, merged)
        }

        if (row['Last Date Read']) {
          const d = new Date(row['Last Date Read'].replace(/\//g, '-'))
          if (!isNaN(d)) store.setDates(found.id, { finished_at: Math.floor(d.getTime() / 1000) })
        }

        matched++
      }

      res.json({ matched, unmatched, total: rows.length })
    })

    // ── Reading Lists ──────────────────────────────────────────────────────────

    app.get('/api/lists', (_, res) => res.json(store.getLists()))

    app.post('/api/lists', (req, res) => {
      const { name, description } = req.body
      if (!name?.trim()) return res.status(400).json({ error: 'name required' })
      res.json(store.createList(name.trim(), description || ''))
    })

    app.get('/api/lists/:id', (req, res) => {
      const list = store.getList(req.params.id)
      if (!list) return res.status(404).json({ error: 'Not found' })
      res.json(list)
    })

    app.put('/api/lists/:id', (req, res) => {
      const list = store.updateList(req.params.id, req.body)
      if (!list) return res.status(404).json({ error: 'Not found' })
      res.json(list)
    })

    app.delete('/api/lists/:id', (req, res) => {
      if (!store.deleteList(req.params.id)) return res.status(404).json({ error: 'Not found' })
      res.json({ ok: true })
    })

    app.post('/api/lists/:id/books', (req, res) => {
      const { bookId } = req.body
      if (!bookId) return res.status(400).json({ error: 'bookId required' })
      if (!store.addBookToList(req.params.id, bookId)) return res.status(404).json({ error: 'List not found' })
      res.json({ ok: true })
    })

    app.delete('/api/lists/:id/books/:bookId', (req, res) => {
      if (!store.removeBookFromList(req.params.id, req.params.bookId)) return res.status(404).json({ error: 'List not found' })
      res.json({ ok: true })
    })

    app.post('/api/lists/:id/pdfs', (req, res) => {
      const { docId } = req.body
      if (!docId) return res.status(400).json({ error: 'docId required' })
      if (!store.addPdfToList(req.params.id, docId)) return res.status(404).json({ error: 'List or PDF not found' })
      res.json({ ok: true })
    })

    app.delete('/api/lists/:id/pdfs/:docId', (req, res) => {
      if (!store.removePdfFromList(req.params.id, req.params.docId)) return res.status(404).json({ error: 'List not found' })
      res.json({ ok: true })
    })

    // ── PDF Tabs ───────────────────────────────────────────────────────────────

    app.get('/api/pdf-tabs', (_, res) => res.json(store.getPdfTabs()))

    app.post('/api/pdf-tabs', (req, res) => {
      const { name } = req.body
      if (!name?.trim()) return res.status(400).json({ error: 'name required' })
      res.json(store.createPdfTab(name.trim()))
    })

    app.get('/api/pdf-tabs/:id', (req, res) => {
      const tab = store.getPdfTab(req.params.id)
      if (!tab) return res.status(404).json({ error: 'Not found' })
      res.json(tab)
    })

    app.put('/api/pdf-tabs/:id', (req, res) => {
      const folderPath = req.body.folder_path
      if (folderPath && !fs.existsSync(folderPath)) {
        return res.status(400).json({ error: `Folder not found: ${folderPath}` })
      }
      const tab = store.updatePdfTab(req.params.id, req.body)
      if (!tab) return res.status(404).json({ error: 'Not found' })
      res.json(tab)
    })

    // Import every PDF found in the tab's folder (recursive, deduped by path)
    app.post('/api/pdf-tabs/:id/scan-folder', (req, res) => {
      const tab = store.getPdfTab(req.params.id)
      if (!tab) return res.status(404).json({ error: 'Not found' })
      if (!tab.folder_path) return res.status(400).json({ error: 'This tab has no folder set' })
      if (!fs.existsSync(tab.folder_path)) return res.status(400).json({ error: `Folder not found: ${tab.folder_path}` })

      const pdfs = []
      const walk = (dir, depth) => {
        if (depth > 6) return
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full, depth + 1)
          else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) pdfs.push(full)
        }
      }
      walk(tab.folder_path, 0)

      const added = store.addPdfDocs(req.params.id, pdfs)
      res.json({ ok: true, found: pdfs.length, added: added.length, skipped: pdfs.length - added.length })
    })

    app.delete('/api/pdf-tabs/:id', (req, res) => {
      if (!store.deletePdfTab(req.params.id)) return res.status(404).json({ error: 'Not found' })
      res.json({ ok: true })
    })

    app.post('/api/pdf-tabs/:id/docs', (req, res) => {
      const { paths } = req.body
      if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ error: 'paths array required' })
      const valid = []
      const errors = []
      for (const p of paths) {
        if (typeof p !== 'string' || !p.toLowerCase().endsWith('.pdf')) { errors.push(`${p}: not a PDF`); continue }
        if (!fs.existsSync(p)) { errors.push(`${path.basename(p)}: file not found`); continue }
        valid.push(p)
      }
      const added = store.addPdfDocs(req.params.id, valid)
      if (added === null) return res.status(404).json({ error: 'Tab not found' })
      res.json({ ok: true, added: added.length, skipped: valid.length - added.length, errors })
    })

    app.get('/api/pdf-docs', (_, res) => res.json(store.getAllPdfDocs()))

    app.get('/api/pdf-docs/:id', (req, res) => {
      const doc = store.getPdfDocFull(req.params.id)
      if (!doc) return res.status(404).json({ error: 'Not found' })
      res.json(doc)
    })

    app.put('/api/pdf-docs/:id', (req, res) => {
      const doc = store.updatePdfDoc(req.params.id, req.body)
      if (!doc) return res.status(404).json({ error: 'Not found' })
      res.json(doc)
    })

    app.delete('/api/pdf-docs/:id', (req, res) => {
      if (!store.deletePdfDoc(req.params.id)) return res.status(404).json({ error: 'Not found' })
      res.json({ ok: true })
    })

    // Raw PDF bytes — used client-side by pdf.js to render a cover thumbnail
    app.get('/api/pdf-docs/:id/file', (req, res) => {
      const doc = store.getPdfDoc(req.params.id)
      if (!doc) return res.status(404).json({ error: 'Not found' })
      if (!fs.existsSync(doc.path)) return res.status(404).json({ error: 'File not found on disk' })
      res.sendFile(doc.path)
    })

    app.post('/api/pdf-docs/:id/cover', (req, res) => {
      const { dataUrl } = req.body
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return res.status(400).json({ error: 'dataUrl must be a base64 image data URL' })
      }
      const doc = store.getPdfDoc(req.params.id)
      if (!doc) return res.status(404).json({ error: 'Not found' })
      store.savePdfCover(req.params.id, dataUrl)
      res.json({ ok: true, cover: store.pdfCoverPath(req.params.id) })
    })

    // ── QR Code ────────────────────────────────────────────────────────────────

    app.get('/api/qr', async (_, res) => {
      try {
        const QRCode = require('qrcode')
        let ip = 'localhost'
        for (const iface of Object.values(os.networkInterfaces())) {
          for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) { ip = addr.address; break }
          }
        }
        const url    = `http://${ip}:${port}`
        const qr     = await QRCode.toDataURL(url, { width: 200, margin: 1 })
        res.json({ url, qr })
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })

    // Serve the built frontend for mobile/browser access via QR code.
    // Must come AFTER all /api/* routes so those aren't intercepted.
    const distPath = path.join(__dirname, '../dist')
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath))
      // SPA fallback — any unmatched GET gets index.html so React Router works
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'))
      })
    }

    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`ShelfMind API → http://localhost:${port}`)
      resolve(port)
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${port} in use, trying ${port + 1}…`)
        server.close()
        // Recurse with next port
        startServer(port + 1).then(resolve)
      } else {
        console.error('Server error:', err)
        resolve(port) // resolve anyway so app still launches
      }
    })
  })
}

module.exports = { startServer }
