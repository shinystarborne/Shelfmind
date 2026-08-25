import { useState, useEffect } from 'react'
import { API } from '../App'

let bmSeq = 0
const newBookmark = (page, label) => ({
  id: `b${Date.now().toString(36)}${(bmSeq++).toString(36)}`,
  page,
  label,
})

// Side panel for jumping around a pattern PDF without endless scrolling.
// Two tabs: the PDF's own embedded outline (when it has one — pattern books
// and magazines often do) and the user's own named page bookmarks, which are
// always available and persist on the doc (bookmarks in pdfDocs.json).
export default function PdfContentsPanel({ docId, docMeta, patchDocMeta, pdfDocRef, docReady, curPage, onJump, onClose }) {
  const [tab,         setTab]         = useState('outline')   // 'outline' | 'bookmarks'
  const [outline,     setOutline]     = useState(null)        // null = loading, [] = none
  const [renamingId,  setRenamingId]  = useState(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Resolve the PDF's embedded outline (destinations → page numbers), once the
  // document has loaded (docReady) — opening the panel early would otherwise
  // find no pdfjs document and stay "loading" forever.
  useEffect(() => {
    if (!docReady) return
    let alive = true
    async function load() {
      const doc = pdfDocRef.current
      if (!doc) return
      const ol = await doc.getOutline().catch(() => null)
      if (!alive) return
      if (!ol || !ol.length) { setOutline([]); return }
      const resolve = async (items) => {
        const out = []
        for (const it of items) {
          let page = null
          try {
            const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
            if (Array.isArray(dest) && dest[0]) page = (await doc.getPageIndex(dest[0])) + 1
          } catch { /* unresolvable destination — show the entry, just not clickable */ }
          out.push({ title: it.title || '(untitled)', page, items: it.items?.length ? await resolve(it.items) : [] })
        }
        return out
      }
      setOutline(await resolve(ol))
    }
    load()
    return () => { alive = false }
  }, [pdfDocRef, docReady])

  // No outline → land on the bookmarks tab instead of an empty first screen.
  useEffect(() => {
    if (outline && outline.length === 0) setTab('bookmarks')
  }, [outline])

  const bookmarks = [...(docMeta?.bookmarks || [])].sort((a, b) => a.page - b.page)

  const saveBookmarks = (next) => {
    patchDocMeta({ bookmarks: next })
    fetch(`${API}/pdf-docs/${docId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookmarks: next }),
    }).catch(() => {})
  }

  // One click = bookmarked, sensible default name; rename afterwards via ✏️.
  const bookmarkCurrentPage = () => {
    saveBookmarks([...(docMeta?.bookmarks || []), newBookmark(curPage, `Page ${curPage}`)])
  }

  const renameBookmark = (id) => {
    const label = renameDraft.trim()
    setRenamingId(null)
    if (!label) return
    saveBookmarks(bookmarks.map(b => (b.id === id ? { ...b, label } : b)))
  }

  const deleteBookmark = (id) => saveBookmarks(bookmarks.filter(b => b.id !== id))

  const renderOutline = (items, depth = 0) => items.map((it, i) => (
    <div key={`${depth}-${i}`}>
      <div
        className={`pdf-outline-item ${it.page ? '' : 'no-page'}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={it.page ? `Go to page ${it.page}` : it.title}
        onClick={() => it.page && onJump(it.page)}
      >
        <span className="pdf-outline-title">{it.title}</span>
        {it.page && <span className="pdf-outline-page">{it.page}</span>}
      </div>
      {it.items.length > 0 && renderOutline(it.items, depth + 1)}
    </div>
  ))

  return (
    <div className="pdf-contents-panel">
      <div className="pdf-contents-header">
        <div className="pdf-contents-tabs">
          <button
            className={`pdf-contents-tab ${tab === 'outline' ? 'active' : ''}`}
            onClick={() => setTab('outline')}
          >Outline</button>
          <button
            className={`pdf-contents-tab ${tab === 'bookmarks' ? 'active' : ''}`}
            onClick={() => setTab('bookmarks')}
          >🔖 Bookmarks{bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}</button>
        </div>
        <button className="reader-icon-btn" onClick={onClose} title="Close panel">✕</button>
      </div>

      <div className="pdf-contents-scroll">
        {tab === 'outline' && (
          <>
            {outline === null && <div className="pdf-contents-empty">Reading outline…</div>}
            {outline !== null && outline.length === 0 && (
              <div className="pdf-contents-empty">This PDF has no built-in outline — use bookmarks instead.</div>
            )}
            {outline !== null && outline.length > 0 && renderOutline(outline)}
          </>
        )}

        {tab === 'bookmarks' && (
          <>
            <button className="pdf-bookmark-add-btn" onClick={bookmarkCurrentPage}>
              🔖 Bookmark page {curPage}
            </button>
            {bookmarks.length === 0 && (
              <div className="pdf-contents-empty">No bookmarks yet.</div>
            )}
            {bookmarks.map(b => (
              <div key={b.id} className="pdf-bookmark-item">
                {renamingId === b.id ? (
                  <input
                    className="pdf-clicker-rename"
                    value={renameDraft}
                    autoFocus
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') renameBookmark(b.id); if (e.key === 'Escape') setRenamingId(null) }}
                    onBlur={() => renameBookmark(b.id)}
                  />
                ) : (
                  <span className="pdf-bookmark-label" title={`Go to page ${b.page}`} onClick={() => onJump(b.page)}>
                    🔖 {b.label}
                  </span>
                )}
                <span className="pdf-outline-page">{b.page}</span>
                <button className="reader-icon-btn" onClick={() => { setRenamingId(b.id); setRenameDraft(b.label) }} title="Rename">✏️</button>
                <button className="reader-icon-btn" onClick={() => deleteBookmark(b.id)} title="Delete bookmark">✕</button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
