import { useState, useEffect, useMemo, useRef } from 'react'
import { API, useApp } from '../App'

// ── Tags editor (custom tags only — chips + input) ────────────────────────────
function DocTags({ doc, onSave }) {
  const [custom, setCustom] = useState('')

  const remove = (tag) => onSave(doc.tags.filter(t => t !== tag))
  const addCustom = () => {
    const t = custom.trim()
    setCustom('')
    if (!t || doc.tags.includes(t)) return
    onSave([...doc.tags, t])
  }

  return (
    <div className="pdf-doc-tags">
      <div className="tags-wrap">
        {doc.tags.map(tag => (
          <span key={tag} className="tag-chip active">
            {tag}
            <span
              className="tag-remove"
              onClick={e => { e.stopPropagation(); remove(tag) }}
            >✕</span>
          </span>
        ))}
        <input
          className="tag-input"
          style={{ width: 110 }}
          placeholder="+ tag"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
          onBlur={addCustom}
        />
      </div>
    </div>
  )
}

// ── Single document row ───────────────────────────────────────────────────────
function DocRow({ doc, onChanged, onRemoved }) {
  const { toast } = useApp()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState(doc.title)
  const [showNote,     setShowNote]     = useState(!!doc.note)
  const [noteDraft,    setNoteDraft]    = useState(doc.note || '')
  const [confirmDel,   setConfirmDel]   = useState(false)
  const noteSaveTimer = useRef(null)

  const patch = async (fields) => {
    await fetch(`${API}/pdf-docs/${doc.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(fields),
    })
    onChanged()
  }

  const saveTitle = () => {
    setEditingTitle(false)
    const t = titleDraft.trim()
    if (t && t !== doc.title) patch({ title: t })
    else setTitleDraft(doc.title)
  }

  const saveNote = (text) => {
    setNoteDraft(text)
    clearTimeout(noteSaveTimer.current)
    noteSaveTimer.current = setTimeout(() => patch({ note: text }), 600)
  }

  const openDoc = async () => {
    if (!window.electronAPI?.openFile) return
    const err = await window.electronAPI.openFile(doc.path)
    if (err) toast(`Could not open file: ${err}`, 'error')
  }

  const removeDoc = async () => {
    await fetch(`${API}/pdf-docs/${doc.id}`, { method: 'DELETE' })
    toast('PDF removed from tab', 'success')
    onRemoved()
  }

  const fileName = doc.path.split(/[\\/]/).pop()

  return (
    <div className={`pdf-doc-row ${doc.missing ? 'missing' : ''}`}>
      <div className="pdf-doc-icon" onDoubleClick={openDoc}>📄</div>

      <div className="pdf-doc-main">
        {editingTitle ? (
          <input
            className="pdf-doc-title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') { setTitleDraft(doc.title); setEditingTitle(false) }
            }}
            onBlur={saveTitle}
            autoFocus
          />
        ) : (
          <div
            className="pdf-doc-title"
            title="Click to rename"
            onClick={() => { setTitleDraft(doc.title); setEditingTitle(true) }}
          >
            {doc.title}
            {doc.missing && <span className="pdf-doc-missing-badge">file not found</span>}
          </div>
        )}
        <div className="pdf-doc-path" title={doc.path}>{fileName}</div>

        <DocTags doc={doc} onSave={tags => patch({ tags })} />

        {showNote && (
          <textarea
            className="note-textarea"
            style={{ marginTop: 8 }}
            placeholder="Notes about this PDF…"
            value={noteDraft}
            onChange={e => saveNote(e.target.value)}
            rows={3}
          />
        )}
      </div>

      <div className="pdf-doc-actions">
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '4px 12px' }}
          onClick={openDoc}
          disabled={!window.electronAPI || doc.missing}
          title={window.electronAPI ? 'Open in your default PDF app' : 'Only available in the desktop app'}
        >Open</button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          title={showNote ? 'Hide note' : 'Add / edit note'}
          onClick={() => setShowNote(s => !s)}
        >📝</button>
        {window.electronAPI?.showItemInFolder && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            title="Show in folder"
            onClick={() => window.electronAPI.showItemInFolder(doc.path)}
          >📂</button>
        )}
        {confirmDel ? (
          <>
            <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} onClick={removeDoc}>Remove?</button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmDel(false)}>✕</button>
          </>
        ) : (
          <button
            className="btn btn-ghost"
            style={{ color: '#c04040', fontSize: 12 }}
            title="Remove from tab (file stays on disk)"
            onClick={() => setConfirmDel(true)}
          >🗑️</button>
        )}
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function PdfTab({ tabId, onTabDeleted, onTabUpdated }) {
  const { toast } = useApp()
  const [tab,        setTab]        = useState(null)
  const [editing,    setEditing]    = useState(false)
  const [editName,   setEditName]   = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [scanning,   setScanning]   = useState(false)
  const [search,     setSearch]     = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [pathDraft,  setPathDraft]  = useState('')
  const [showPathInput, setShowPathInput] = useState(false)

  const loadTab = () => {
    fetch(`${API}/pdf-tabs/${tabId}`)
      .then(r => r.json())
      .then(setTab)
      .catch(() => {})
  }

  useEffect(() => { loadTab(); setSearch(''); setEditing(false); setConfirmDel(false) }, [tabId])

  const scanFolder = async () => {
    if (scanning) return
    setScanning(true)
    const result = await fetch(`${API}/pdf-tabs/${tabId}/scan-folder`, { method: 'POST' })
      .then(r => r.json())
      .catch(() => null)
    setScanning(false)
    if (!result) return
    if (result.error) { toast(result.error, 'error'); return }
    toast(result.added
      ? `Found ${result.found} PDF${result.found !== 1 ? 's' : ''} — added ${result.added} new`
      : `No new PDFs (${result.found} found, all already in this tab)`,
      result.added ? 'success' : '')
    loadTab()
    onTabUpdated?.()
  }

  const saveEdit = async () => {
    const name = editName.trim()
    if (!name) return
    const folder = editFolder.trim()
    const folderChanged = folder !== (tab.folder_path || '')
    const r = await fetch(`${API}/pdf-tabs/${tabId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, folder_path: folder }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error || 'Could not save', 'error')
      return
    }
    setEditing(false)
    loadTab()
    onTabUpdated?.()
    if (folder && folderChanged) scanFolder()
  }

  const browseFolder = async () => {
    if (!window.electronAPI?.pickFolder) return
    const folder = await window.electronAPI.pickFolder()
    if (folder) setEditFolder(folder)
  }

  const deleteTab = async () => {
    await fetch(`${API}/pdf-tabs/${tabId}`, { method: 'DELETE' })
    onTabDeleted()
  }

  const addPaths = async (paths) => {
    if (!paths?.length) return
    const result = await fetch(`${API}/pdf-tabs/${tabId}/docs`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ paths }),
    }).then(r => r.json())
    if (result.added) toast(`Added ${result.added} PDF${result.added !== 1 ? 's' : ''}`, 'success')
    if (result.skipped) toast(`${result.skipped} already in this tab`)
    for (const err of result.errors || []) toast(err, 'error')
    loadTab()
    onTabUpdated?.()
  }

  const addPdfs = async () => {
    if (window.electronAPI?.pickPdfFiles) {
      const paths = await window.electronAPI.pickPdfFiles()
      addPaths(paths)
    } else {
      setShowPathInput(s => !s)
    }
  }

  const submitPath = () => {
    const p = pathDraft.trim()
    if (!p) return
    setPathDraft('')
    setShowPathInput(false)
    addPaths([p])
  }

  const filteredDocs = useMemo(() => {
    if (!tab) return []
    const q = search.toLowerCase().trim()
    if (!q) return tab.docs
    return tab.docs.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.path.toLowerCase().includes(q) ||
      d.tags.some(t => t.toLowerCase().includes(q)) ||
      (d.note || '').toLowerCase().includes(q)
    )
  }, [tab, search])

  if (!tab) return <div className="empty-state"><div className="spin" style={{ fontSize: 32 }}>↻</div></div>

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
              placeholder="Tab name…"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="search-input"
                style={{ fontSize: 13, flex: 1 }}
                value={editFolder}
                onChange={e => setEditFolder(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
                placeholder="Folder for this tab (optional) — its PDFs can be imported in one click…"
              />
              {window.electronAPI?.pickFolder && (
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={browseFolder}>📂 Browse…</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 14px' }} onClick={saveEdit}>Save</button>
              <button className="btn btn-ghost"   style={{ fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 20, lineHeight: 1.2 }}>📄 {tab.name}</h2>
              {tab.folder_path && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tab.folder_path}>
                  📂 {tab.folder_path}
                </div>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tab.docs.length} PDF{tab.docs.length !== 1 ? 's' : ''}</span>
            {tab.folder_path && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={scanFolder}
                disabled={scanning}
                title="Import new PDFs from this tab's folder"
              >
                <span className={scanning ? 'spin' : ''}>↻</span> Scan folder
              </button>
            )}
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setEditName(tab.name); setEditFolder(tab.folder_path || ''); setEditing(true) }}>✏️ Edit</button>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={addPdfs}>+ Add PDFs</button>
            {confirmDel ? (
              <>
                <span style={{ fontSize: 12, color: '#c04040' }}>Delete this tab?</span>
                <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} onClick={deleteTab}>Yes, delete</button>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmDel(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} title="Delete tab" onClick={() => setConfirmDel(true)}>🗑️</button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="pdf-tab-body">
        {showPathInput && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="search-input"
              style={{ flex: 1 }}
              placeholder="Paste the full path to a PDF file…"
              value={pathDraft}
              onChange={e => setPathDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPath() }}
              autoFocus
            />
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={submitPath}>Add</button>
          </div>
        )}

        {tab.docs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <h3>No PDFs yet</h3>
            <p>{tab.folder_path
              ? 'Scan this tab\'s folder or pick individual PDF files.'
              : 'Click "+ Add PDFs" to pick PDF files from your computer.'}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {tab.folder_path && (
                <button className="btn btn-secondary" onClick={scanFolder} disabled={scanning}>
                  <span className={scanning ? 'spin' : ''}>↻</span> Scan folder
                </button>
              )}
              <button className="btn btn-secondary" onClick={addPdfs}>+ Add PDFs</button>
            </div>
          </div>
        ) : (
          <>
            <input
              className="search-input"
              style={{ marginBottom: 14, maxWidth: 420 }}
              placeholder="Search title, tags, notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {filteredDocs.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32, fontSize: 13 }}>
                No PDFs match your search
              </div>
            )}
            <div className="pdf-doc-list">
              {filteredDocs.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onChanged={loadTab}
                  onRemoved={() => { loadTab(); onTabUpdated?.() }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
