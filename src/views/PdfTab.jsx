import { useState, useEffect, useMemo, useRef } from 'react'
import { API, useApp } from '../App'
import PdfCard from '../components/PdfCard'
import PdfDrawer from '../components/PdfDrawer'
import { buildTagPayload, needsTagging } from '../lib/pdfAutoTag'

// ── Main view ─────────────────────────────────────────────────────────────────
export default function PdfTab({ tabId, onTabDeleted, onTabUpdated }) {
  const { toast, nudgeLibrary } = useApp()
  const [tab,        setTab]        = useState(null)
  const [editing,    setEditing]    = useState(false)
  const [editName,   setEditName]   = useState('')
  const [editFolder, setEditFolder] = useState('')
  const [scanning,   setScanning]   = useState(false)
  const [search,     setSearch]     = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [pathDraft,  setPathDraft]  = useState('')
  const [showPathInput, setShowPathInput] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [tagging,    setTagging]    = useState(null)   // { current, total, title, failed } while an auto-tag pass runs
  const tagStopRef = useRef(false)

  const loadTab = () => {
    fetch(`${API}/pdf-tabs/${tabId}`)
      .then(r => r.json())
      .then(setTab)
      .catch(() => {})
  }

  useEffect(() => { loadTab(); setSearch(''); setEditing(false); setConfirmDel(false); setSelectedId(null) }, [tabId])

  // ✨ Auto-tag: one click tags every untagged pattern in the tab via the LLM.
  // Sequential on purpose — a local model is the bottleneck, not the parsing.
  const autoTagAll = async () => {
    if (tagging) return
    const docs = tab.docs.filter(d => !d.missing && needsTagging(d))
    if (!docs.length) { toast('Everything here is already tagged', 'success'); return }
    tagStopRef.current = false
    let failed = 0, lastError = null, sameErrorCount = 0
    setTagging({ current: 0, total: docs.length, title: '', failed: 0 })
    for (let i = 0; i < docs.length; i++) {
      if (tagStopRef.current) break
      const d = docs[i]
      setTagging({ current: i + 1, total: docs.length, title: d.title, failed })
      try {
        const payload = await buildTagPayload(`${API}/pdf-docs/${d.id}/file`)
        const res = await fetch(`${API}/pdf-docs/${d.id}/auto-tag`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setTab(t => t ? { ...t, docs: t.docs.map(x => x.id === d.id ? { ...x, auto: data.auto, tags: data.tags } : x) } : t)
        sameErrorCount = 0
      } catch (err) {
        failed++
        setTab(t => t ? { ...t, docs: t.docs.map(x => x.id === d.id ? { ...x, auto: { failed: true, error: err.message } } : x) } : t)
        // Same error 5× in a row = config problem — stop instead of failing 691 times.
        sameErrorCount = err.message === lastError ? sameErrorCount + 1 : 1
        lastError = err.message
        if (sameErrorCount >= 5) {
          toast(`Same error 5 times in a row — stopping. ${err.message}`, 'error')
          break
        }
      }
    }
    const done = !tagStopRef.current
    setTagging(null)
    if (done) {
      toast(failed
        ? `Auto-tag finished — ${docs.length - failed}/${docs.length} tagged, ${failed} failed`
        : `Auto-tagged ${docs.length} pattern${docs.length !== 1 ? 's' : ''} ✨`,
        failed ? 'error' : 'success')
      onTabUpdated?.()
    }
  }

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
    if (result.added > 0) nudgeLibrary({ index: true })
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
    if (result.added > 0) nudgeLibrary({ index: true })
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
            {tagging ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tagging.title}>
                  ✨ {tagging.current}/{tagging.total}{tagging.failed ? ` (${tagging.failed} failed)` : ''}
                </span>
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { tagStopRef.current = true }}>Cancel</button>
              </>
            ) : (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={autoTagAll}
                title="AI: tag untagged patterns with craft, item type and yarn weight"
              >✨ Auto-tag</button>
            )}
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
      <div className="library-body">
        <div className="books-area">
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
              <div className="results-count">{filteredDocs.length} PDF{filteredDocs.length !== 1 ? 's' : ''}</div>
              <div className="books-grid">
                {filteredDocs.map(doc => (
                  <PdfCard
                    key={doc.id}
                    doc={doc}
                    selected={selectedId === doc.id}
                    onClick={d => setSelectedId(d.id === selectedId ? null : d.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedId && (
        <PdfDrawer
          docId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={loadTab}
          onRemoved={() => { setSelectedId(null); loadTab(); onTabUpdated?.() }}
        />
      )}
    </div>
  )
}
