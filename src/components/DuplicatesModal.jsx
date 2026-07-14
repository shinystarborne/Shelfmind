import { useState, useEffect } from 'react'
import { API, useApp } from '../App'
import { coverSrc, initials, displayAuthor, formatFileSize } from './BookCard'

function DupBookRow({ book, onRemoved }) {
  const { toast, refreshLibrary } = useApp()
  const [removing, setRemoving] = useState(false)
  const src  = coverSrc(book)
  const init = initials(book.title)

  const remove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      const res = await fetch(`${API}/books/${book.id}/remove`, { method: 'POST' }).then(r => r.json())
      if (res.ok) {
        toast(`Moved "${book.title}" to _Removed`, 'success')
        onRemoved(book.id)
        refreshLibrary()
      } else {
        toast(res.error || 'Could not remove this copy', 'error')
        setRemoving(false)
      }
    } catch {
      toast('Could not remove this copy', 'error')
      setRemoving(false)
    }
  }

  return (
    <div className={`dup-book-row ${book.suggested_keep ? 'suggested-keep' : ''}`}>
      {src ? (
        <img
          className="dup-book-cover"
          src={src}
          alt=""
          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
        />
      ) : null}
      <div className="dup-book-cover-ph" style={{ display: src ? 'none' : 'flex' }}>{init}</div>
      <div className="dup-book-info">
        <div className="dup-book-path" title={book.path}>{book.path}</div>
        <div className="dup-book-meta">
          {(book.format || '').toUpperCase()}
          {book.file_size ? ` · ${formatFileSize(book.file_size)}` : ''}
          {book.read_status && book.read_status !== 'unread' ? ` · ${book.read_status}` : ''}
          {book.suggested_keep && <span className="dup-keep-badge">✓ best name — will be kept</span>}
        </div>
      </div>
      <button
        className="btn btn-secondary"
        style={{ color: '#c04040', fontSize: 12, flexShrink: 0 }}
        onClick={remove}
        disabled={removing}
        title="Move this copy to _Removed (file stays on disk, just hidden from ShelfMind)"
      >
        {removing ? <span className="spin">↻</span> : '🗑️'} Remove
      </button>
    </div>
  )
}

function DupGroup({ group, onEmptied }) {
  const [books, setBooks] = useState(group.books)

  const handleRemoved = (id) => {
    const next = books.filter(b => b.id !== id)
    setBooks(next)
    if (next.length <= 1) onEmptied(group.key)
  }

  if (books.length <= 1) return null

  return (
    <div className="dup-group">
      <div className="dup-group-title">{books[0].title}</div>
      <div className="dup-group-author">{displayAuthor(books[0])}</div>
      <div className="dup-group-books">
        {books.map(b => <DupBookRow key={b.id} book={b} onRemoved={handleRemoved} />)}
      </div>
    </div>
  )
}

export default function DuplicatesModal({ onClose }) {
  const { toast, refreshLibrary } = useApp()
  const [groups, setGroups] = useState(null)
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false)
  const [removingAll, setRemovingAll] = useState(false)

  const load = () => fetch(`${API}/duplicates`).then(r => r.json()).then(setGroups).catch(() => setGroups([]))
  useEffect(() => { load() }, [])

  const handleEmptied = (key) => setGroups(gs => gs.filter(g => g.key !== key))

  const removeAll = async () => {
    setRemovingAll(true)
    try {
      const res = await fetch(`${API}/duplicates/remove-all`, { method: 'POST' }).then(r => r.json())
      const copyWord = res.removed === 1 ? 'copy' : 'copies'
      toast(
        res.removed
          ? `Moved ${res.removed} duplicate ${copyWord} to _Removed across ${res.groups} group${res.groups !== 1 ? 's' : ''}`
          : 'Nothing to remove',
        res.removed ? 'success' : ''
      )
      for (const err of res.errors || []) toast(err, 'error')
      refreshLibrary()
      load()
    } catch {
      toast('Could not remove duplicates', 'error')
    } finally {
      setRemovingAll(false)
      setConfirmRemoveAll(false)
    }
  }

  const totalCopiesToRemove = groups ? groups.reduce((n, g) => n + g.books.length - 1, 0) : 0

  return (
    <div className="picker-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="picker-panel" style={{ width: 'min(720px, 94vw)' }}>
        <div className="picker-header">
          <h3>⚠️ Duplicates</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {groups && groups.length > 0 && (
              confirmRemoveAll ? (
                <>
                  <span style={{ fontSize: 12, color: '#c04040' }}>
                    Remove {totalCopiesToRemove} cop{totalCopiesToRemove !== 1 ? 'ies' : 'y'}?
                  </span>
                  <button className="btn btn-secondary" style={{ color: '#c04040', fontSize: 12 }} onClick={removeAll} disabled={removingAll}>
                    {removingAll ? <span className="spin">↻</span> : '🗑️'} Confirm
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmRemoveAll(false)} disabled={removingAll}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-secondary"
                  style={{ color: '#c04040', fontSize: 12 }}
                  onClick={() => setConfirmRemoveAll(true)}
                  title="Keeps the best-named copy in each group, moves the rest to _Removed"
                >
                  🗑️ Remove All Duplicates
                </button>
              )
            )}
            <button className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{ padding: '12px 16px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {groups === null ? (
            <div className="empty-state"><div className="spin" style={{ fontSize: 32 }}>↻</div></div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--sage-dark)', padding: 32 }}>
              ✓ No duplicates left!
            </div>
          ) : (
            groups.map(g => <DupGroup key={g.key} group={g} onEmptied={handleEmptied} />)
          )}
        </div>
      </div>
    </div>
  )
}
