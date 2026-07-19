import { useState, useEffect, useRef } from 'react'
import { API, useApp } from '../App'
import { pdfCoverSrc } from './PdfCard'
import { initials } from './BookCard'

// ── Tags editor (custom tags only — chips + input) ────────────────────────────
function DocTags({ tags, onSave }) {
  const [custom, setCustom] = useState('')

  const remove = (tag) => onSave(tags.filter(t => t !== tag))
  const addCustom = () => {
    const t = custom.trim()
    setCustom('')
    if (!t || tags.includes(t)) return
    onSave([...tags, t])
  }

  return (
    <div className="tags-wrap">
      {tags.map(tag => (
        <span key={tag} className="tag-chip active">
          {tag}
          <span className="tag-remove" onClick={e => { e.stopPropagation(); remove(tag) }}>✕</span>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder="+ tag"
        value={custom}
        onChange={e => setCustom(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
        onBlur={addCustom}
      />
    </div>
  )
}

export default function PdfDrawer({ docId, onClose, onChanged, onRemoved }) {
  const { toast, openPdfReader, pdfReaderDoc } = useApp()
  const [doc,          setDoc]          = useState(null)
  const [note,         setNote]         = useState('')
  const [noteDirty,    setNoteDirty]    = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState('')
  const [confirmDel,   setConfirmDel]   = useState(false)

  const load = () => fetch(`${API}/pdf-docs/${docId}`).then(r => r.json()).then(d => { setDoc(d); setNote(d.note || '') })
  useEffect(() => { load(); setEditingTitle(false); setConfirmDel(false) }, [docId])

  // When the in-app PDF viewer closes, re-fetch so Continue page is fresh
  const prevPdfReader = useRef(pdfReaderDoc)
  useEffect(() => {
    if (prevPdfReader.current && !pdfReaderDoc) load()
    prevPdfReader.current = pdfReaderDoc
  }, [pdfReaderDoc])

  useEffect(() => {
    if (!noteDirty) return
    const t = setTimeout(() => {
      fetch(`${API}/pdf-docs/${docId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note }),
      })
      setNoteDirty(false)
    }, 800)
    return () => clearTimeout(t)
  }, [note, noteDirty, docId])

  const patch = async (fields) => {
    const updated = await fetch(`${API}/pdf-docs/${docId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields),
    }).then(r => r.json())
    setDoc(d => ({ ...d, ...updated }))
    onChanged?.()
  }

  const saveTitle = () => {
    setEditingTitle(false)
    const t = titleDraft.trim()
    if (t && t !== doc.title) patch({ title: t })
  }

  const openDoc = async () => {
    if (!window.electronAPI?.openFile) return
    const err = await window.electronAPI.openFile(doc.path)
    if (err) toast(`Could not open file: ${err}`, 'error')
  }

  const removeDoc = async () => {
    await fetch(`${API}/pdf-docs/${docId}`, { method: 'DELETE' })
    toast('PDF removed', 'success')
    onRemoved?.()
  }

  if (!doc) return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="book-drawer">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    </>
  )

  const src      = pdfCoverSrc(doc)
  const init     = initials(doc.title) || '📄'
  const fileName = doc.path.split(/[\\/]/).pop()

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="book-drawer">

        <div className="drawer-cover-area">
          <button className="drawer-close" onClick={onClose}>✕</button>
          {src
            ? <img className="drawer-cover" src={src} alt={doc.title} />
            : <div className="drawer-cover-ph"><div className="initials">{init}</div></div>
          }
        </div>

        <div className="drawer-body">
          <div>
            {editingTitle ? (
              <input
                className="search-input"
                style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-serif)' }}
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                onBlur={saveTitle}
                autoFocus
              />
            ) : (
              <div
                className="drawer-title"
                style={{ cursor: 'text' }}
                title="Click to rename"
                onClick={() => { setTitleDraft(doc.title); setEditingTitle(true) }}
              >
                {doc.title}
              </div>
            )}
            <div className="drawer-author">{doc.tab_name ? `in 📄 ${doc.tab_name}` : 'PDF'}</div>
            {doc.missing && (
              <div style={{ fontSize: 12, color: '#c04040', marginTop: 4 }}>
                ⚠️ File not found at its saved location
              </div>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-label">Tags</div>
            <DocTags tags={doc.tags || []} onSave={tags => patch({ tags })} />
          </div>

          <div className="drawer-section">
            <div className="drawer-section-label">Personal Note</div>
            <textarea
              className="note-textarea"
              placeholder="Any thoughts, quotes, or reminders…"
              value={note}
              onChange={e => { setNote(e.target.value); setNoteDirty(true) }}
            />
          </div>

          <div className="drawer-section">
            <div className="drawer-section-label">File Info</div>
            <div className="file-info">
              <div className="file-info-row"><span className="label">File</span><span className="value">{fileName}</span></div>
              <div className="file-info-row"><span className="label">Path</span><span className="value" style={{ wordBreak: 'break-all', textAlign: 'right' }}>{doc.path}</span></div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-label">Actions</div>
            <div className="drawer-actions">
              <button
                className="btn btn-primary"
                onClick={() => openPdfReader(doc)}
                disabled={doc.missing}
                title="Read in ShelfMind"
              >
                📖 {doc.last_page > 1 ? `Continue · p.${doc.last_page}` : 'Read'}
              </button>
              {window.electronAPI && (
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--brown)', borderColor: 'var(--brown)' }}
                  onClick={openDoc}
                  disabled={doc.missing}
                  title="Open in your default PDF app"
                >
                  📂 Open
                </button>
              )}
              {window.electronAPI?.showItemInFolder && (
                <button className="btn btn-secondary" onClick={() => window.electronAPI.showItemInFolder(doc.path)}>
                  📁 Show in Explorer
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => { navigator.clipboard.writeText(doc.path); toast('Path copied', 'success') }}
              >
                📋 Copy File Path
              </button>
              {confirmDel ? (
                <>
                  <button className="btn btn-secondary" style={{ color: '#c04040' }} onClick={removeDoc}>Confirm Remove</button>
                  <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn btn-secondary" style={{ color: '#c04040' }} onClick={() => setConfirmDel(true)}>
                  🗑️ Remove from Tab…
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
