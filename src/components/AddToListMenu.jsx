import { useState } from 'react'
import { API, useApp } from '../App'

// Shared "add to a reading list" helper — books and PDFs use sibling endpoints.
export async function addToList(listId, kind, id) {
  const body = kind === 'book' ? { bookId: id } : { docId: id }
  await fetch(`${API}/lists/${listId}/${kind === 'book' ? 'books' : 'pdfs'}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

// Small popover listing the user's lists (+ inline "new list") — opened from
// card hover buttons and the book/PDF drawers. onClose after a successful add.
export default function AddToListMenu({ kind, id, onClose }) {
  const { lists, loadLists, toast } = useApp()
  const [newName, setNewName] = useState('')

  const add = async (listId, name) => {
    try {
      await addToList(listId, kind, id)
      toast(`Added to ${name}`, 'success')
      loadLists()
    } catch {
      toast('Could not add to list', 'error')
    }
    onClose?.()
  }

  const createAndAdd = async () => {
    const name = newName.trim()
    if (!name) return
    const list = await fetch(`${API}/lists`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    }).then(r => r.json()).catch(() => null)
    if (list) add(list.id, list.name)
  }

  return (
    <div className="add-to-list-menu" onClick={e => e.stopPropagation()}>
      {lists.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}>No lists yet</div>
      )}
      {lists.map(l => (
        <button key={l.id} className="add-to-list-item" onClick={() => add(l.id, l.name)}>
          📋 {l.name}
        </button>
      ))}
      <div className="add-to-list-new">
        <input
          className="search-input"
          style={{ fontSize: 12, padding: '3px 8px' }}
          placeholder="New list…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createAndAdd() }}
          autoFocus={lists.length === 0}
        />
        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '3px 10px' }} onClick={createAndAdd}>Add</button>
      </div>
    </div>
  )
}
