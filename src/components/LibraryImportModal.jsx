import { useState, useEffect, useMemo } from 'react'
import { API } from '../App'

const COL = { fontSize: 12, padding: '6px 8px', verticalAlign: 'top', borderBottom: '1px solid var(--border)' }
const CHANGED = { color: 'var(--rose)', fontWeight: 600 }
const SAME    = { color: 'var(--text-muted)' }

function Diff({ cur, next, changed }) {
  if (!changed) return <span style={SAME}>{cur || '—'}</span>
  return (
    <span>
      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', fontSize: 11 }}>{cur || '—'}</span>
      {' → '}
      <span style={CHANGED}>{next || '—'}</span>
    </span>
  )
}

export default function LibraryImportModal({ onClose, toast }) {
  const [loading,    setLoading]    = useState(true)
  const [changes,    setChanges]    = useState([])
  const [unmatched,  setUnmatched]  = useState([])
  const [selected,   setSelected]   = useState(new Set())
  const [applying,   setApplying]   = useState(false)
  const [done,       setDone]       = useState(null)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [filter,     setFilter]     = useState('all') // 'all' | 'series' | 'standalone' | 'title' | 'subjects'

  useEffect(() => {
    fetch(`${API}/import/library-md/preview`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { toast(data.error, 'error'); onClose(); return }
        setChanges(data.changes || [])
        setUnmatched(data.unmatched || [])
        setSelected(new Set((data.changes || []).map(c => c.bookId)))
      })
      .catch(() => { toast('Failed to load preview', 'error'); onClose() })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return changes
    if (filter === 'series')     return changes.filter(c => c.newSeries)
    if (filter === 'standalone') return changes.filter(c => !c.newSeries)
    if (filter === 'title')      return changes.filter(c => c.titleChanged)
    if (filter === 'subjects')   return changes.filter(c => c.subjectsChanged)
    return changes
  }, [changes, filter])

  const toggleAll = (val) => {
    setSelected(val ? new Set(filtered.map(c => c.bookId)) : new Set())
  }

  const toggle = (id) => {
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const apply = async () => {
    setApplying(true)
    const toApply = changes.filter(c => selected.has(c.bookId))
    try {
      const res = await fetch(`${API}/import/library-md/apply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ changes: toApply }),
      }).then(r => r.json())
      setDone(res.applied)
      toast(`✓ Updated ${res.applied} books`, 'success')
    } catch {
      toast('Apply failed', 'error')
    } finally {
      setApplying(false)
    }
  }

  const selCount = filtered.filter(c => selected.has(c.bookId)).length

  if (loading) return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <span className="spin" style={{ display: 'inline-block', fontSize: 24 }}>↻</span>
          <div style={{ marginTop: 12 }}>Analysing library…</div>
        </div>
      </div>
    </div>
  )

  if (done !== null) return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 400, textAlign: 'center', padding: 40 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{done} books updated</div>
        <div style={{ color: 'var(--text-soft)', fontSize: 13, marginBottom: 24 }}>
          Titles, authors, series, and genres have been saved.
          Re-open any book to see the changes.
        </div>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  )

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Library MD Import — Preview</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {changes.length} proposed changes · {unmatched.length} unmatched
            </div>
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose}>✕</button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { key: 'all',        label: `All (${changes.length})` },
            { key: 'series',     label: `Series (${changes.filter(c => c.newSeries).length})` },
            { key: 'standalone', label: `Standalones (${changes.filter(c => !c.newSeries).length})` },
            { key: 'title',      label: `Title changes (${changes.filter(c => c.titleChanged).length})` },
            { key: 'subjects',   label: `Genre changes (${changes.filter(c => c.subjectsChanged).length})` },
          ].map(f => (
            <button
              key={f.key}
              className={`btn ${filter === f.key ? 'btn-secondary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', marginRight: 4 }} onClick={() => toggleAll(true)}>Select all</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => toggleAll(false)}>Deselect all</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--cream-dark)', zIndex: 1 }}>
                <th style={{ ...COL, width: 28 }} />
                <th style={{ ...COL, textAlign: 'left' }}>Current Title</th>
                <th style={{ ...COL, textAlign: 'left' }}>New Title</th>
                <th style={{ ...COL, textAlign: 'left' }}>Author</th>
                <th style={{ ...COL, textAlign: 'left' }}>Series</th>
                <th style={{ ...COL, textAlign: 'left', width: 30 }}>#</th>
                <th style={{ ...COL, textAlign: 'left' }}>Genres</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.bookId}
                  style={{ background: selected.has(c.bookId) ? 'transparent' : 'rgba(0,0,0,0.03)', cursor: 'pointer' }}
                  onClick={() => toggle(c.bookId)}
                >
                  <td style={{ ...COL, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.bookId)}
                      onChange={() => toggle(c.bookId)}
                      onClick={e => e.stopPropagation()}
                      style={{ accentColor: 'var(--rose)' }}
                    />
                  </td>
                  <td style={{ ...COL, maxWidth: 180 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.currentTitle}</span>
                  </td>
                  <td style={{ ...COL, maxWidth: 180 }}>
                    {c.titleChanged
                      ? <span style={CHANGED}>{c.newTitle}</span>
                      : <span style={SAME}>{c.newTitle}</span>
                    }
                  </td>
                  <td style={COL}>
                    <Diff cur={c.currentAuthor} next={c.newAuthor} changed={c.authorChanged} />
                  </td>
                  <td style={COL}>
                    <Diff cur={c.currentSeries} next={c.newSeries} changed={c.seriesChanged} />
                  </td>
                  <td style={COL}>
                    <Diff cur={c.currentNum} next={c.newNum} changed={c.numChanged} />
                  </td>
                  <td style={{ ...COL, maxWidth: 200 }}>
                    {c.subjectsChanged ? (
                      <span style={CHANGED}>{c.newSubjects.join(' · ')}</span>
                    ) : (
                      <span style={SAME}>{c.currentSubjects.join(' · ') || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Unmatched toggle */}
        {unmatched.length > 0 && (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setShowUnmatched(v => !v)}
            >
              {showUnmatched ? '▲' : '▼'} {unmatched.length} unmatched entries
            </button>
            {showUnmatched && (
              <div style={{ marginTop: 8, maxHeight: 150, overflowY: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                {unmatched.map((u, i) => (
                  <div key={i} style={{ padding: '2px 0' }}>
                    <em>{u.mdTitle}</em> — {u.mdAuthor}{u.mdSeries ? ` (${u.mdSeries})` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--cream)', flexShrink: 0 }}>
          <button
            className="btn btn-primary"
            onClick={apply}
            disabled={applying || selCount === 0}
          >
            {applying ? <span className="spin">↻</span> : '✓'} Apply {selCount} change{selCount !== 1 ? 's' : ''}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            Red = field will change · Grey = unchanged
          </span>
        </div>

      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 400,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
}
const modal = {
  background: 'var(--cream)',
  borderRadius: 'var(--radius-lg)',
  width: '100%',
  maxWidth: 1000,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}
