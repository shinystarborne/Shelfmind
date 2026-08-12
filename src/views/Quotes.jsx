import { useState, useEffect, useCallback } from 'react'
import { API, useApp } from '../App'
import { coverSrc, initials } from '../components/BookCard'
import { HL_COLORS } from '../components/Reader'

const DEFAULT_QUOTES_PATH = 'F:\\ShinyVaults\\ShinyDragon\\cowork\\quotes\\quotes.json'

// Solid versions of the highlight colors for the quote accent bars
const BAR_COLORS = {
  yellow: '#e0b53a',
  green:  '#6fb56f',
  pink:   '#e07898',
  blue:   '#5f9fdc',
}

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString() : ''
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

// Stored highlight text keeps the book's raw whitespace (needed for anchoring);
// for humans we collapse it.
const clean = (t) => (t || '').replace(/\s+/g, ' ').trim()

export default function Quotes() {
  const { toast, prefs, refreshPrefs, openReader, openAudiobook } = useApp()
  const [items, setItems]       = useState(null)
  const [marks, setMarks]       = useState([])
  const [pathEdit, setPathEdit] = useState(null)   // null = closed, string = editing
  const [exporting, setExporting] = useState(false)
  const [editingNote, setEditingNote] = useState(null)   // hid being edited
  const [noteDraft, setNoteDraft]     = useState('')

  const load = useCallback(() => {
    fetch(`${API}/highlights`).then(r => r.json()).then(setItems).catch(() => setItems([]))
    fetch(`${API}/audio-marks`).then(r => r.json()).then(setMarks).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const removeMark = async (m) => {
    await fetch(`${API}/audio-marks/${m.id}`, { method: 'DELETE' })
    setMarks(list => list.filter(x => x.id !== m.id))
    toast('Mark removed')
  }

  // Jump to one minute before the mark, so the listener catches the lead-up
  const jumpToMark = (m) => {
    openAudiobook(
      { abs_id: m.abs_id, title: m.title, author: m.author, cover_url: m.cover_url, external_url: m.external_url },
      Math.max(0, (m.time || 0) - 60),
    )
  }

  const quotesPath = prefs.quotes_json_path || ''

  const savePath = async () => {
    const p = (pathEdit || '').trim()
    await fetch(`${API}/preferences`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ quotes_json_path: p }),
    })
    await refreshPrefs()
    setPathEdit(null)
    if (p) toast('Quotes collection path saved', 'success')
  }

  const exportQuotes = async (quotes) => {
    if (!quotesPath) { setPathEdit(DEFAULT_QUOTES_PATH); return }
    setExporting(true)
    try {
      const res = await fetch(`${API}/quotes-export`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quotes }),
      }).then(r => r.json())
      if (res.ok) {
        toast(res.added > 0
          ? `Added ${res.added} quote${res.added > 1 ? 's' : ''} to your collection ✓`
          : 'Already in your collection', 'success')
      } else {
        toast(`Export failed: ${res.error}`, 'error')
      }
    } catch {
      toast('Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  const toQuote = (h) => ({ text: clean(h.text), author: h.book_author, book: h.book_title })

  const remove = async (h) => {
    await fetch(`${API}/books/${h.book_id}/highlights/${h.id}`, { method: 'DELETE' })
    setItems(list => list.filter(x => x.id !== h.id))
    toast('Highlight removed')
  }

  const startEditNote = (h) => { setEditingNote(h.id); setNoteDraft(h.note || '') }

  const saveNote = async (h) => {
    try {
      const res = await fetch(`${API}/books/${h.book_id}/highlights/${h.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: noteDraft }),
      }).then(r => { if (!r.ok) throw new Error(); return r.json() })
      setItems(list => list.map(x => x.id === h.id ? { ...x, note: res.note } : x))
      setEditingNote(null)
      toast('Note saved')
    } catch {
      toast('Could not save note', 'error')
    }
  }

  const openInBook = async (h) => {
    try {
      const book = await fetch(`${API}/books/${h.book_id}`).then(r => r.json())
      openReader(book, { spine: h.spine, hid: h.id })
    } catch {
      toast('Could not open book', 'error')
    }
  }

  if (items === null) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <div className="spin" style={{ fontSize: 32 }}>↻</div>
      </div>
    )
  }

  // Group by book, keeping the overall newest-first order between groups
  const groups = []
  const byBook = new Map()
  for (const h of items) {
    if (!byBook.has(h.book_id)) {
      const g = { book_id: h.book_id, title: h.book_title, author: h.book_author, cover_local: h.cover_local, quotes: [] }
      byBook.set(h.book_id, g)
      groups.push(g)
    }
    byBook.get(h.book_id).quotes.push(h)
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Quotes</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {items.length} highlight{items.length === 1 ? '' : 's'}
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            title={quotesPath ? `Collection: ${quotesPath}` : 'Set your quotes collection file'}
            onClick={() => setPathEdit(pathEdit === null ? (quotesPath || DEFAULT_QUOTES_PATH) : null)}
          >
            ⚙️ Collection
          </button>
        </div>
      </div>

      <div className="quotes-body">
        {pathEdit !== null && (
          <div className="quotes-path-row">
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Quotes collection file (JSON)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="pref-input"
                style={{ flex: 1, fontSize: 12 }}
                value={pathEdit}
                onChange={e => setPathEdit(e.target.value)}
                placeholder="Path to quotes.json"
              />
              <button className="btn btn-primary" onClick={savePath}>Save</button>
              <button className="btn btn-ghost" onClick={() => setPathEdit(null)}>Cancel</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              "Add to collection" appends highlights to this file as {'{ text, author, book, tags }'} entries, skipping duplicates.
            </div>
          </div>
        )}

        {groups.length === 0 && marks.length === 0 && (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-icon">❝</div>
            <h3>No highlights yet</h3>
            <p>Select any text while reading a book and pick a color — your highlights will gather here as quotes.</p>
          </div>
        )}

        {/* Audio marks — audiobook bookmarks saved from the player */}
        {marks.length > 0 && (
          <div className="quotes-group">
            <div className="quotes-group-head">
              <div className="quotes-cover quotes-cover-ph">🎧</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="quotes-book-title">Audio Marks</div>
                <div className="quotes-book-author">Audiobook bookmarks — jump back to one minute before the mark</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{marks.length}</span>
            </div>

            {marks.map(m => (
              <div key={m.id} className="quote-card" style={{ borderLeftColor: BAR_COLORS.blue }}>
                <div className="quote-text">{m.title}</div>
                <div className="quote-note">🎧 {m.author || 'Unknown'} — at {fmtTime(m.time)}</div>
                <div className="quote-meta">
                  <span>{fmtDate(m.created_at)}</span>
                  <span className="quote-actions">
                    <button title="Play from one minute before this mark" onClick={() => jumpToMark(m)}>▶</button>
                    <button title="Open in Audiobookshelf" onClick={() => {
                      if (window.electronAPI?.openExternal) window.electronAPI.openExternal(m.external_url)
                      else window.open(m.external_url, '_blank')
                    }}>↗</button>
                    <button title="Remove mark" onClick={() => removeMark(m)}>🗑</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.map(g => (
          <div key={g.book_id} className="quotes-group">
            <div className="quotes-group-head">
              {coverSrc(g, { thumb: true }) ? (
                <img className="quotes-cover" src={coverSrc(g, { thumb: true })} alt="" />
              ) : (
                <div className="quotes-cover quotes-cover-ph">{initials(g.title)}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="quotes-book-title">{g.title}</div>
                <div className="quotes-book-author">{g.author || 'Unknown'}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.quotes.length}</span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px' }}
                disabled={exporting}
                onClick={() => exportQuotes(g.quotes.map(toQuote))}
                title="Add all of this book's highlights to your quotes collection"
              >
                ✍️ Add all to collection
              </button>
            </div>

            {g.quotes.map(h => (
              <div key={h.id} className="quote-card" style={{ borderLeftColor: BAR_COLORS[h.color] || BAR_COLORS.yellow }}>
                <div className="quote-text">{clean(h.text)}</div>

                {editingNote === h.id ? (
                  <div className="quote-note-edit">
                    <textarea
                      autoFocus
                      className="quote-note-textarea"
                      value={noteDraft}
                      onChange={e => setNoteDraft(e.target.value)}
                      placeholder="Add a note…"
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                      <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setEditingNote(null)}>Cancel</button>
                      <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => saveNote(h)}>Save</button>
                    </div>
                  </div>
                ) : h.note ? (
                  <div className="quote-note" onClick={() => startEditNote(h)} title="Click to edit note">📝 {h.note}</div>
                ) : null}

                <div className="quote-meta">
                  <span>{fmtDate(h.created_at)}</span>
                  <span className="quote-actions">
                    <button title="Copy" onClick={() => { navigator.clipboard.writeText(clean(h.text)); toast('Quote copied') }}>📋</button>
                    <button title={h.note ? 'Edit note' : 'Add note'} onClick={() => startEditNote(h)}>📝</button>
                    <button title="Open in book" onClick={() => openInBook(h)}>📖</button>
                    <button title="Add to quotes collection" disabled={exporting} onClick={() => exportQuotes([toQuote(h)])}>✍️</button>
                    <button title="Remove highlight" onClick={() => remove(h)}>🗑</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
