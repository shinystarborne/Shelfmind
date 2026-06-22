import { useState, useEffect, useMemo, useCallback } from 'react'
import { API, useApp } from '../App'
import BookCard from '../components/BookCard'
import BookDrawer from '../components/BookDrawer'

const PAGE_SIZE = 20

// ── Book picker modal ─────────────────────────────────────────────────────────
function BookPicker({ listBookIds, onAdd, onClose }) {
  const [allBooks, setAllBooks] = useState([])
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(0)

  useEffect(() => {
    fetch(`${API}/books`).then(r => r.json()).then(setAllBooks).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allBooks.filter(b => {
      if (listBookIds.includes(b.id)) return false
      if (!q) return true
      return (b.title || '').toLowerCase().includes(q) ||
             (b.author_canonical || b.author || '').toLowerCase().includes(q)
    })
  }, [allBooks, search, listBookIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages - 1)
  const visible    = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const handleSearch = useCallback(e => { setSearch(e.target.value); setPage(0) }, [])

  return (
    <div className="picker-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="picker-panel">
        <div className="picker-header">
          <h3>Add books to list</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <input
          className="search-input"
          style={{ margin: '0 16px 12px', width: 'calc(100% - 32px)' }}
          placeholder="Search title or author…"
          value={search}
          onChange={handleSearch}
          autoFocus
        />
        <div className="books-grid" style={{ padding: '12px 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {visible.map(book => (
            <BookCard
              key={book.id}
              book={book}
              selected={false}
              onClick={() => onAdd(book.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
              {search ? 'No books match your search' : 'All books are already in this list'}
            </div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="picker-pagination">
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}>← Prev</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{safePage + 1} / {totalPages}</span>
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function ReadingList({ listId, onListDeleted, onListUpdated }) {
  const { toast } = useApp()
  const [list,       setList]       = useState(null)
  const [editing,    setEditing]    = useState(false)
  const [editName,   setEditName]   = useState('')
  const [editDesc,   setEditDesc]   = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)

  const loadList = () => {
    fetch(`${API}/lists/${listId}`)
      .then(r => r.json())
      .then(setList)
      .catch(() => {})
  }

  useEffect(() => { loadList() }, [listId])

  const startEdit = () => {
    setEditName(list.name)
    setEditDesc(list.description || '')
    setEditing(true)
  }

  const saveEdit = async () => {
    await fetch(`${API}/lists/${listId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
    })
    setEditing(false)
    loadList()
    onListUpdated?.()
  }

  const addBook = async (bookId) => {
    await fetch(`${API}/lists/${listId}/books`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookId }),
    })
    loadList()
    onListUpdated?.()
  }

  const removeBook = async (bookId) => {
    await fetch(`${API}/lists/${listId}/books/${bookId}`, { method: 'DELETE' })
    toast('Book removed from list', 'success')
    loadList()
    onListUpdated?.()
  }

  const deleteList = async () => {
    await fetch(`${API}/lists/${listId}`, { method: 'DELETE' })
    onListDeleted()
  }

  if (!list) return <div className="empty-state"><div className="spin" style={{ fontSize: 32 }}>↻</div></div>

  const listBookIds = list.books.map(b => b.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="topbar" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '12px 150px 12px 20px' }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
            <input
              className="search-input"
              style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-serif)' }}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
              autoFocus
              placeholder="List name…"
            />
            <input
              className="search-input"
              style={{ fontSize: 13 }}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (optional)…"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={saveEdit}>Save</button>
              <button className="btn btn-ghost"   style={{ fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 20, lineHeight: 1.2 }}>{list.name}</h2>
              {list.description && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{list.description}</div>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{list.books.length} book{list.books.length !== 1 ? 's' : ''}</span>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={startEdit}>✏️ Edit</button>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setShowPicker(true)}>+ Add books</button>
            {confirmDel ? (
              <>
                <span style={{ fontSize: 12, color: '#c04040' }}>Delete this list?</span>
                <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} onClick={deleteList}>Yes, delete</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmDel(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} onClick={() => setConfirmDel(true)}>🗑️</button>
            )}
          </div>
        )}
      </div>

      {/* Books grid */}
      <div className="library-body">
        <div className="books-area">
          {list.books.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>This list is empty</h3>
              <p>Click "+ Add books" to add books from your library.</p>
              <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowPicker(true)}>+ Add books</button>
            </div>
          ) : (
            <>
              <div className="results-count">{list.books.length} book{list.books.length !== 1 ? 's' : ''}</div>
              <div className="books-grid">
                {list.books.map(book => (
                  <div key={book.id} style={{ position: 'relative' }}>
                    <BookCard
                      book={book}
                      selected={selectedId === book.id}
                      onClick={b => setSelectedId(b.id === selectedId ? null : b.id)}
                    />
                    <button
                      className="list-remove-btn"
                      title="Remove from list"
                      onClick={e => { e.stopPropagation(); removeBook(book.id) }}
                    >✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {showPicker && (
        <BookPicker
          listBookIds={listBookIds}
          onAdd={async (bookId) => { await addBook(bookId) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {selectedId && (
        <BookDrawer
          bookId={selectedId}
          onClose={() => setSelectedId(null)}
          onStatusChange={() => loadList()}
        />
      )}
    </div>
  )
}
