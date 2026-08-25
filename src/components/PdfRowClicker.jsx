import { useState, useEffect, useRef, useCallback } from 'react'
import { API, useApp } from '../App'
import { playClick } from '../lib/clickSound'

let counterSeq = 0
const newCounter = (label = 'row') => ({
  id: `c${Date.now().toString(36)}${(counterSeq++).toString(36)}`,
  label,
  value: 0,
})

// Floating row-counter ("clicker") for following knitting/crochet charts.
// Unlimited named counters per pattern, one active at a time; a user-assigned
// keyboard key ticks the active counter with a mechanical click sound, so the
// knitter never has to touch the mouse — or wonder whether they counted.
// Counters persist on the doc (row_counters / active_counter in pdfDocs.json);
// the key and sound toggle are global prefs (row_clicker_key / row_clicker_sound).
export default function PdfRowClicker({ docId, docMeta, patchDocMeta, active, onClose }) {
  const { prefs, refreshPrefs } = useApp()
  const [pos,            setPos]            = useState({ x: 24, y: 70 })
  const [expanded,       setExpanded]       = useState(false)
  const [assigning,      setAssigning]      = useState(false)
  const [pulse,          setPulse]          = useState(0)
  const [confirmReset,   setConfirmReset]   = useState(false)
  const [adding,         setAdding]         = useState(false)
  const [newLabel,       setNewLabel]       = useState('')
  const [renamingId,     setRenamingId]     = useState(null)
  const [renameDraft,    setRenameDraft]    = useState('')
  const [confirmDelId,   setConfirmDelId]   = useState(null)
  const dragRef   = useRef(null)
  const saveTimer = useRef(null)

  const counters = docMeta?.row_counters || []
  const activeId = docMeta?.active_counter || counters[0]?.id || null
  const activeCounter = counters.find(c => c.id === activeId) || counters[0] || null

  // Seed a first counter the first time a doc without any is opened.
  useEffect(() => {
    if (docMeta && !docMeta.row_counters) {
      const first = newCounter()
      patchDocMeta({ row_counters: [first], active_counter: first.id })
      persist({ row_counters: [first], active_counter: first.id })
    }
  }, [docMeta])   // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback((fields) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch(`${API}/pdf-docs/${docId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
      }).catch(() => {})
    }, 500)
  }, [docId])

  const update = useCallback((nextCounters, nextActiveId) => {
    const fields = { row_counters: nextCounters, active_counter: nextActiveId }
    patchDocMeta(fields)
    persist(fields)
  }, [patchDocMeta, persist])

  const tick = useCallback((delta) => {
    if (!activeCounter) return
    const next = counters.map(c =>
      c.id === activeCounter.id ? { ...c, value: Math.max(0, c.value + delta) } : c)
    update(next, activeCounter.id)
    if (prefs.row_clicker_sound !== false) playClick(delta < 0)
    setPulse(p => p + 1)
  }, [activeCounter, counters, update, prefs.row_clicker_sound])

  const savePrefs = useCallback(async (patch) => {
    await fetch(`${API}/preferences`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...prefs, ...patch }),
    }).catch(() => {})
    refreshPrefs()
  }, [prefs, refreshPrefs])

  // Global key listener — capture phase so the clicker key (e.g. Space) wins
  // over the reader's own page-turn shortcuts; stopPropagation keeps it that way.
  useEffect(() => {
    const onKey = (e) => {
      if (!active) return
      if (assigning) {
        e.preventDefault()
        e.stopPropagation()
        // Single chars stored lowercase so Shift+key (decrement) still matches
        if (e.key !== 'Escape') savePrefs({ row_clicker_key: e.key.length === 1 ? e.key.toLowerCase() : e.key })
        setAssigning(false)
        return
      }
      const key = prefs.row_clicker_key
      if (!key) return
      const matches = key.length === 1 ? e.key.toLowerCase() === key : e.key === key
      if (!matches) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      e.stopPropagation()
      tick(e.shiftKey ? -1 : 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, assigning, prefs.row_clicker_key, tick, savePrefs])

  // Dragging (same pattern as PdfPinPanel)
  const onDragPointerDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [pos])
  const onDragPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) })
  }, [])
  const onDragPointerUp = useCallback(() => { dragRef.current = null }, [])

  const addCounter = () => {
    const label = newLabel.trim() || `counter ${counters.length + 1}`
    const c = newCounter(label)
    setNewLabel('')
    setAdding(false)
    update([...counters, c], c.id)
  }

  const renameCounter = (id) => {
    const label = renameDraft.trim()
    setRenamingId(null)
    if (!label) return
    update(counters.map(c => (c.id === id ? { ...c, label } : c)), activeId)
  }

  const deleteCounter = (id) => {
    setConfirmDelId(null)
    const next = counters.filter(c => c.id !== id)
    update(next, id === activeId ? next[0]?.id ?? null : activeId)
  }

  const resetActive = () => {
    setConfirmReset(false)
    update(counters.map(c => (c.id === activeCounter.id ? { ...c, value: 0 } : c)), activeCounter.id)
  }

  if (!docMeta || !activeCounter) return null

  return (
    <div className="pdf-row-clicker" style={{ left: pos.x, top: pos.y }}>
      <div
        className="pdf-pin-panel-header"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
      >
        <span className="pdf-pin-panel-title">🧶 clicker</span>
        <div className="pdf-pin-panel-controls">
          <button
            className="reader-icon-btn"
            onClick={() => savePrefs({ row_clicker_sound: prefs.row_clicker_sound === false })}
            title={prefs.row_clicker_sound === false ? 'Click sound off — click to enable' : 'Click sound on — click to mute'}
          >{prefs.row_clicker_sound === false ? '🔇' : '🔊'}</button>
          <button
            className={`reader-icon-btn ${assigning ? 'active' : ''}`}
            onClick={() => setAssigning(a => !a)}
            title={prefs.row_clicker_key
              ? `Clicker key: ${prefs.row_clicker_key} — click to reassign (Shift+key counts down)`
              : 'Assign a keyboard key that counts a row'}
          >⌨</button>
          <button
            className="reader-icon-btn"
            onClick={() => setExpanded(x => !x)}
            title={expanded ? 'Collapse counter list' : 'Show all counters'}
          >{expanded ? '▴' : '▾'}</button>
          <button className="reader-icon-btn" onClick={onClose} title="Hide clicker">✕</button>
        </div>
      </div>

      {assigning && (
        <div className="pdf-clicker-assign">Press any key to make it the clicker — Esc cancels</div>
      )}

      <div className="pdf-clicker-body">
        <div className="pdf-clicker-label" title="Active counter">{activeCounter.label}</div>
        <div className="pdf-clicker-row">
          <button className="reader-icon-btn pdf-clicker-btn" onClick={() => tick(-1)} title="Count down (or Shift+clicker key)">−</button>
          <div key={pulse} className="pdf-clicker-value">{activeCounter.value}</div>
          <button className="reader-icon-btn pdf-clicker-btn" onClick={() => tick(1)} title="Count up">＋</button>
        </div>
        <div className="pdf-clicker-subrow">
          {confirmReset ? (
            <>
              <button className="reader-icon-btn" style={{ color: '#c04040' }} onClick={resetActive} title="Confirm reset">reset to 0?</button>
              <button className="reader-icon-btn" onClick={() => setConfirmReset(false)} title="Cancel">✕</button>
            </>
          ) : (
            <button className="reader-icon-btn" onClick={() => setConfirmReset(true)} title={`Reset "${activeCounter.label}" to 0`}>↺</button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pdf-clicker-list">
          {counters.map(c => (
            <div key={c.id} className={`pdf-clicker-item ${c.id === activeCounter.id ? 'active' : ''}`}>
              {renamingId === c.id ? (
                <input
                  className="pdf-clicker-rename"
                  value={renameDraft}
                  autoFocus
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameCounter(c.id); if (e.key === 'Escape') setRenamingId(null) }}
                  onBlur={() => renameCounter(c.id)}
                />
              ) : (
                <span
                  className="pdf-clicker-item-label"
                  title={c.id === activeCounter.id ? 'Active counter' : 'Click to make active'}
                  onClick={() => update(counters, c.id)}
                >{c.label}</span>
              )}
              <span className="pdf-clicker-item-value">{c.value}</span>
              <button
                className="reader-icon-btn"
                onClick={() => { setRenamingId(c.id); setRenameDraft(c.label) }}
                title="Rename"
              >✏️</button>
              {confirmDelId === c.id ? (
                <button className="reader-icon-btn" style={{ color: '#c04040' }} onClick={() => deleteCounter(c.id)} title="Confirm delete">✕?</button>
              ) : (
                <button
                  className="reader-icon-btn"
                  onClick={() => setConfirmDelId(c.id)}
                  title="Delete counter"
                  disabled={counters.length <= 1}
                >✕</button>
              )}
            </div>
          ))}
          {adding ? (
            <div className="pdf-clicker-item">
              <input
                className="pdf-clicker-rename"
                placeholder="name (e.g. sleeve 1)…"
                value={newLabel}
                autoFocus
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCounter(); if (e.key === 'Escape') setAdding(false) }}
              />
              <button className="reader-icon-btn" onClick={addCounter} title="Add counter">＋</button>
            </div>
          ) : (
            <button className="pdf-clicker-add" onClick={() => setAdding(true)}>＋ new counter</button>
          )}
        </div>
      )}
    </div>
  )
}
