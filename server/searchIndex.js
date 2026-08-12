// SQLite FTS5 full-text search index (better-sqlite3, native module).
//
// The extracted plain-text corpus stays in searchtext/*.json (the reader uses
// it as its extraction cache); this module maintains a queryable index over it
// in <dataDir>/search.db. The previous search lowercased and substring-scanned
// the whole in-memory corpus on every keystroke (~5 s per query and ~1.7 GB
// RSS on a 1000-book library); FTS5 answers the same queries in milliseconds
// without holding the corpus in RAM.
//
// Schema:
//   fts(kind, ref_id, item_no, text) — one row per chapter/page. kind/ref_id/
//     item_no are UNINDEXED payload columns (stored, not searchable).
//   docs(kind, ref_id, rowid_min, rowid_max) — each indexed document plus the
//     contiguous fts rowid range its items occupy. Per-doc snippet/count
//     queries restrict by rowid range; filtering on the unindexed ref_id
//     column instead would force a full match-list scan per document.
//
// Trade-off vs the old scan: matching is word-prefix based ("dum" finds
// "Dumbledore"), not arbitrary substring — mid-word matches ("ott" → "Potter")
// no longer hit. Standard full-text behaviour, worth it for the speed.
//
// If the native binding fails to load, `available` is false and Store falls
// back to the legacy in-memory scan.

const fs   = require('fs')
const path = require('path')

let Database = null
try { Database = require('better-sqlite3') } catch { /* binding unavailable */ }

const available = !!Database

const DOC_LIMIT         = 50
const SNIPPETS_PER_DOC  = 3   // frontend shows 1 per book, up to 3 per PDF
// Wall-clock budget for the per-doc snippet/count loop. Common-word queries
// ("the") match thousands of rows per book; rather than block for seconds,
// docs past the budget are returned without snippets/counts (matchCount 0).
const DETAIL_BUDGET_MS  = 250

// snippet() markers around matched terms — control chars that never appear in
// book text, parsed back out to recover matchText (used for in-PDF find).
const MARK_OPEN = '\u0001', MARK_CLOSE = '\u0002'

// "harry potter" → `"harry"* "potter"*` — each whitespace token becomes a
// quoted prefix term (AND semantics). '' when nothing searchable is left.
function toFtsQuery(raw) {
  return raw.trim().split(/\s+/)
    .map(t => t.replace(/"/g, ''))
    .filter(Boolean)
    .map(t => `"${t}"*`)
    .join(' ')
}

// The extracted corpus can carry raw HTML entities from book XHTML
// (htmlToPlainText doesn't decode numeric ones) — decode for display.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decodeEntities(s) {
  return s.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[e] ?? m
  })
}

function parseSnippet(snip) {
  const text = decodeEntities(snip.replaceAll(MARK_OPEN, '').replaceAll(MARK_CLOSE, ''))
  const m = snip.slice(snip.indexOf(MARK_OPEN) + 1)
  const matchText = m.slice(0, m.indexOf(MARK_CLOSE))
  return { text, matchText: matchText || '' }
}

class SearchIndex {
  constructor(dataDir) {
    this.db = new Database(path.join(dataDir, 'search.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        kind TEXT NOT NULL, ref_id TEXT NOT NULL,
        rowid_min INTEGER, rowid_max INTEGER,
        PRIMARY KEY (kind, ref_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        kind UNINDEXED, ref_id UNINDEXED, item_no UNINDEXED, text,
        tokenize = 'unicode61'
      );
    `)
    this._hasDoc   = this.db.prepare('SELECT 1 FROM docs WHERE kind = ? AND ref_id = ?')
    this._getRange = this.db.prepare('SELECT rowid_min, rowid_max FROM docs WHERE kind = ? AND ref_id = ?')
    this._insRow   = this.db.prepare('INSERT INTO fts (kind, ref_id, item_no, text) VALUES (?, ?, ?, ?)')
    this._delRows  = this.db.prepare('DELETE FROM fts WHERE rowid BETWEEN ? AND ?')
    this._upDoc    = this.db.prepare('INSERT OR REPLACE INTO docs (kind, ref_id, rowid_min, rowid_max) VALUES (?, ?, ?, ?)')
    this._delDoc   = this.db.prepare('DELETE FROM docs WHERE kind = ? AND ref_id = ?')
    this._discover = this.db.prepare('SELECT kind, ref_id FROM fts WHERE fts MATCH ? GROUP BY kind, ref_id LIMIT ?')
    this._snip     = this.db.prepare(`SELECT item_no, snippet(fts, 3, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 10) AS snip FROM fts WHERE fts MATCH ? AND rowid BETWEEN ? AND ? LIMIT ?`)
    this._count    = this.db.prepare('SELECT COUNT(*) c FROM fts WHERE fts MATCH ? AND rowid BETWEEN ? AND ?')
  }

  has(kind, refId) { return !!this._hasDoc.get(kind, refId) }

  // items: [{ spine, text }] for books, [{ page, text }] for PDFs.
  indexDocument(kind, refId, items) {
    const itemKey = kind === 'pdf' ? 'page' : 'spine'
    this.db.transaction(() => {
      const old = this._getRange.get(kind, refId)
      if (old) this._delRows.run(old.rowid_min, old.rowid_max)
      let min = null, max = null
      for (const it of items) {
        if (!it.text) continue
        const rid = Number(this._insRow.run(kind, refId, it[itemKey], it.text).lastInsertRowid)
        if (min === null) min = rid
        max = rid
      }
      if (min === null) this._delDoc.run(kind, refId)
      else this._upDoc.run(kind, refId, min, max)
    })()
  }

  deleteDocument(kind, refId) {
    this.db.transaction(() => {
      const old = this._getRange.get(kind, refId)
      if (old) this._delRows.run(old.rowid_min, old.rowid_max)
      this._delDoc.run(kind, refId)
    })()
  }

  clearAll() {
    this.db.exec('DELETE FROM fts; DELETE FROM docs;')
  }

  // One-time migration helper: searchtext/*.json files not yet in the index.
  pendingBackfill(searchTextDir) {
    let files = []
    try { files = fs.readdirSync(searchTextDir).filter(f => f.endsWith('.json')) } catch { files = [] }
    return files.filter(name => {
      const id = name.slice(0, -5)
      const isPdf = id.startsWith('pdf-')
      return !this.has(isPdf ? 'pdf' : 'book', isPdf ? id.slice(4) : id)
    })
  }

  // One-time migration: index every searchtext/*.json not yet in the docs
  // table (compares by kind+ref_id, so it also resumes a partial backfill).
  async backfill(searchTextDir, onProgress, pending = null) {
    pending = pending || this.pendingBackfill(searchTextDir)
    const total = pending.length
    let done = 0, success = 0
    for (const name of pending) {
      try {
        const id = name.slice(0, -5)
        const isPdf = id.startsWith('pdf-')
        const data = JSON.parse(fs.readFileSync(path.join(searchTextDir, name), 'utf8'))
        const items = isPdf ? data.pages : data.chapters
        if (items) {
          this.indexDocument(isPdf ? 'pdf' : 'book', isPdf ? id.slice(4) : id, items)
          success++
        }
      } catch { /* unreadable/corrupt file — skip */ }
      done++
      onProgress?.({ current: done, total, success })
      await new Promise(r => setImmediate(r))
    }
    return { total, success }
  }

  // resolve(kind, id) → { title, author } for a live document, or null for a
  // removed/unknown one (stale fts rows are skipped that way).
  search(rawQuery, limit = DOC_LIMIT, resolve) {
    const q = toFtsQuery(rawQuery)
    if (!q) return []

    const docs = this._discover.all(q, limit)
    const t0 = Date.now()
    const results = []

    for (const { kind, ref_id } of docs) {
      const meta = resolve(kind, ref_id)
      if (!meta) continue
      const res = { kind, id: ref_id, title: meta.title, author: meta.author || '', matchCount: 0, matches: [] }

      const range = this._getRange.get(kind, ref_id)
      if (range && Date.now() - t0 < DETAIL_BUDGET_MS) {
        res.matches = this._snip.all(q, range.rowid_min, range.rowid_max, SNIPPETS_PER_DOC).map(r => {
          const { text, matchText } = parseSnippet(r.snip)
          return {
            [kind === 'pdf' ? 'page' : 'spine']: r.item_no,
            offset:    0, // FTS doesn't report char offsets; frontend doesn't use it
            matchText,
            snippet:   text,
          }
        })
        res.matchCount = this._count.get(q, range.rowid_min, range.rowid_max).c
      }
      results.push(res)
    }

    results.sort((a, b) => b.matchCount - a.matchCount)
    return results.slice(0, limit)
  }
}

module.exports = { SearchIndex, available }
