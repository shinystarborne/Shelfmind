import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { API, useApp } from '../App'
import { initials } from '../components/BookCard'

// ── Audiobooks page ───────────────────────────────────────────────────────────
// First-class view for the user's Audiobookshelf server (Preferences → Library
// Tools). "Continue Listening" is fed by the ABS user progress (/api/me) and
// resumes playback at the saved position via the app-level player.

function formatDuration(sec) {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

function absCover(item) {
  // API (not a hardcoded port) so the cover proxy works after a port bump
  return item.cover_url ? `${API.replace(/\/api$/, '')}${item.cover_url}` : null
}

function openExternalUrl(url) {
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url)
  else window.open(url, '_blank')
}

// Square-cover grid card. Click starts the player — resuming at the saved ABS
// position when the book is in progress; ✓ marks it finished without playing;
// ↗ opens the ABS web UI.
function AudiobookCard({ item, progress, onChanged }) {
  const { openAudiobook } = useApp()
  const resumeAt = progress?.currentTime > 0 && !progress?.isFinished ? progress.currentTime : 0
  const src = absCover(item)
  const init = initials(item.title)
  const markFinished = async (e) => {
    e.stopPropagation()
    await fetch(`${API}/audiobooks/${item.abs_id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentTime: item.duration, duration: item.duration, progress: 1, isFinished: true }),
    }).catch(() => {})
    onChanged?.()
  }
  return (
    <div className="book-card-wrap">
      <div
        className="book-card abs-square"
        onClick={() => openAudiobook(item, resumeAt)}
        title={resumeAt ? `${item.title} — resume at ${formatDuration(resumeAt)}` : `${item.title} — play`}
      >
        {src ? (
          <img
            className="book-cover"
            src={src}
            alt={item.title}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div className="book-cover-placeholder" style={{ display: src ? 'none' : 'flex' }}>
          <div className="initials">{init}</div>
        </div>
        <div className="book-meta">
          <div className="book-title">{item.title}</div>
          <div className="book-author">{item.author || 'Unknown'}</div>
          <div className="book-badges">
            <span className="badge badge-unread">🎧 {formatDuration(item.duration)}</span>
            {progress?.isFinished && (
              <span className="badge badge-read">✓ finished</span>
            )}
            {item.series && !progress?.isFinished && (
              <span className="badge badge-series" title={item.series}>📖</span>
            )}
            <span
              className="badge badge-unread"
              style={{ cursor: 'pointer' }}
              title="Open in Audiobookshelf"
              onClick={e => { e.stopPropagation(); openExternalUrl(item.external_url) }}
            >↗</span>
            {!progress?.isFinished && (
              <span
                className="badge badge-unread"
                style={{ cursor: 'pointer' }}
                title="Mark as finished"
                onClick={markFinished}
              >✓</span>
            )}
          </div>
          {progress?.progress > 0 && (
            <div className="book-progress" title={`${Math.round(progress.progress * 100)}% listened`}>
              <div className="book-progress-fill" style={{ width: `${Math.min(100, progress.progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// "Continue Listening" — in-progress audiobooks only, most recent first.
// Within a series only the next book shows (earliest in sequence) — having
// three books of the same series half-listened shouldn't flood the row.
function ContinueListening({ items, progress, seriesInfo }) {
  const { openAudiobook } = useApp()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sm_abs_continue_collapsed') === 'true')

  const seqOf = item => {
    const s = seriesInfo[item.abs_id]?.sequence
    return isFinite(s) ? s : Infinity
  }

  const inProgressRaw = items.filter(item => {
    const p = progress[item.abs_id]
    return p && p.progress > 0 && !p.isFinished
  })

  const bySeries = new Map()
  const inProgress = []
  for (const item of inProgressRaw) {
    const sName = seriesInfo[item.abs_id]?.name || item.series
    if (!sName) { inProgress.push(item); continue }
    if (!bySeries.has(sName)) bySeries.set(sName, [])
    bySeries.get(sName).push(item)
  }
  for (const books of bySeries.values()) {
    books.sort((a, b) => (seqOf(a) - seqOf(b)) ||
      ((progress[b.abs_id]?.lastUpdate || 0) - (progress[a.abs_id]?.lastUpdate || 0)))
    inProgress.push(books[0])
  }
  inProgress.sort((a, b) => (progress[b.abs_id].lastUpdate || 0) - (progress[a.abs_id].lastUpdate || 0))

  if (inProgress.length === 0) return null

  return (
    <div className="read-next-section continue-reading-section">
      <div className="read-next-header" onClick={() => {
        const next = !collapsed
        setCollapsed(next)
        localStorage.setItem('sm_abs_continue_collapsed', String(next))
      }}>
        <span>🎧 Continue Listening</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
          ({inProgress.length})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>{collapsed ? '▾' : '▴'}</span>
      </div>
      {!collapsed && (
        <div className="read-next-scroll">
          {inProgress.map(item => {
            const p = progress[item.abs_id]
            const src = absCover(item)
            const remaining = Math.max(0, (p.duration || item.duration) - (p.currentTime || 0))
            return (
              <div
                key={item.id}
                className="read-next-card continue-reading-card abs-square"
                onClick={() => openAudiobook(item, p.currentTime)}
                title={`${item.title} — resume at ${formatDuration(p.currentTime)}`}
              >
                {src
                  ? <img src={src} alt={item.title} />
                  : <div className="read-next-ph">{initials(item.title)}</div>
                }
                <div className="read-next-title">{item.title}</div>
                <div className="read-next-author">
                  {remaining > 0 ? `${formatDuration(remaining)} left` : (item.author || 'Unknown')}
                </div>
                <div className="book-progress" title={`${Math.round(p.progress * 100)}% listened`}>
                  <div className="book-progress-fill" style={{ width: `${Math.min(100, p.progress * 100)}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// "Continue the Series" — next unheard audiobook in every series you've started
// but not finished, built from ABS's canonical series data (name + sequence),
// so books are ordered correctly and duplicate copies count as one.
function ContinueSeries({ items, progress, seriesInfo }) {
  const { openAudiobook } = useApp()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sm_abs_series_collapsed') === 'true')

  const bySeries = new Map()
  for (const item of items) {
    const info = seriesInfo[item.abs_id]
    const name = info?.name || item.series
    if (!name) continue
    const seq = isFinite(info?.sequence) ? info.sequence : (parseFloat(item.series_num) || Infinity)
    if (!bySeries.has(name)) bySeries.set(name, [])
    bySeries.get(name).push({ item, seq })
  }

  const rows = []
  for (const [name, entries] of bySeries) {
    // Collapse duplicate copies of the same book (same sequence, or same title
    // when no sequence) — finishing ANY copy counts as finished.
    const copiesOf = new Map()
    for (const e of entries) {
      const key = isFinite(e.seq) ? `n${e.seq}` : e.item.title.toLowerCase().trim()
      if (!copiesOf.has(key)) copiesOf.set(key, [])
      copiesOf.get(key).push(e)
    }
    const books = [...copiesOf.values()].map(copies => ({
      // show the copy with the most progress
      item: copies.slice().sort((a, b) =>
        (progress[b.item.abs_id]?.progress || 0) - (progress[a.item.abs_id]?.progress || 0))[0].item,
      seq: copies[0].seq,
      finished: copies.some(c => progress[c.item.abs_id]?.isFinished),
    }))
    if (!books.some(b => b.finished)) continue   // series not started
    const next = books
      .filter(b => !b.finished)
      .sort((a, b) => (a.seq - b.seq) || a.item.title.localeCompare(b.item.title))[0]
    if (!next) continue   // series finished
    const activity = Math.max(0, ...entries.map(e => progress[e.item.abs_id]?.lastUpdate || 0))
    rows.push({ book: next.item, seq: next.seq, series: name, activity })
  }
  rows.sort((a, b) => b.activity - a.activity)

  if (rows.length === 0) return null

  return (
    <div className="read-next-section continue-reading-section">
      <div className="read-next-header" onClick={() => {
        const next = !collapsed
        setCollapsed(next)
        localStorage.setItem('sm_abs_series_collapsed', String(next))
      }}>
        <span>📖 Continue the Series</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
          ({rows.length})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>{collapsed ? '▾' : '▴'}</span>
      </div>
      {!collapsed && (
        <div className="read-next-scroll">
          {rows.map(({ book, seq, series }) => {
            const p = progress[book.abs_id]
            const src = absCover(book)
            return (
              <div
                key={book.id}
                className="read-next-card continue-reading-card abs-square"
                onClick={() => openAudiobook(book, p?.currentTime > 0 ? p.currentTime : 0)}
                title={`${book.title} — ${series}`}
              >
                {src
                  ? <img src={src} alt={book.title} />
                  : <div className="read-next-ph">{initials(book.title)}</div>
                }
                <div className="read-next-title">{book.title}</div>
                <div className="read-next-author">
                  {isFinite(seq) ? `#${seq} · ` : ''}{series}
                </div>
                {p?.progress > 0 && (
                  <div className="book-progress" title={`${Math.round(p.progress * 100)}% listened`}>
                    <div className="book-progress-fill" style={{ width: `${Math.min(100, p.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Audiobooks() {
  const { player }        = useApp()
  const [data, setData]   = useState(null)   // null = loading
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    setData(null)
    fetch(`${API}/audiobooks`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ configured: true, items: [], progress: {}, seriesInfo: {}, error: 'Could not reach Audiobookshelf' }))
  }, [])

  useEffect(() => { load() }, [load])

  // The player writes progress to ABS — reload when it closes so Continue
  // Listening / finished badges reflect it (e.g. after "mark as finished").
  const wasPlaying = useRef(false)
  useEffect(() => {
    if (player) { wasPlaying.current = true; return }
    if (wasPlaying.current) { wasPlaying.current = false; load() }
  }, [player, load])

  const filtered = useMemo(() => {
    if (!data?.items) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.items
    return data.items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.author || '').toLowerCase().includes(q) ||
      (item.series || '').toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-title">Audiobooks</div>
        <div className="search-wrap">
          <input
            className="search-input"
            placeholder="Search audiobooks by title, author, or series…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 16, padding: '4px 8px' }}
          onClick={load}
          title="Reload audiobooks"
        >↻</button>
      </div>

      {data === null ? (
        <div className="empty-state">
          <div className="spin" style={{ fontSize: 32 }}>↻</div>
          <p>Loading audiobooks…</p>
        </div>
      ) : !data.configured ? (
        <div className="empty-state">
          <div className="empty-icon">🎧</div>
          <h3>Audiobookshelf not configured</h3>
          <p>Add your Audiobookshelf server URL and API token in Preferences → Library Tools.</p>
        </div>
      ) : data.error ? (
        <div className="empty-state">
          <div className="empty-icon">🎧</div>
          <h3>Audiobookshelf unreachable</h3>
          <p>{data.error} — check the server URL and API token in Preferences.</p>
        </div>
      ) : data.items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎧</div>
          <h3>No audiobooks found</h3>
          <p>Your Audiobookshelf libraries don't have any audiobooks yet.</p>
        </div>
      ) : (
        <div className="library-body">
          <div className="books-area">
            <ContinueListening items={data.items} progress={data.progress || {}} seriesInfo={data.seriesInfo || {}} />
            <ContinueSeries items={data.items} progress={data.progress || {}} seriesInfo={data.seriesInfo || {}} />
            <div className="results-count">{filtered.length} audiobook{filtered.length !== 1 ? 's' : ''}</div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <h3>No matches</h3>
                <p>No audiobooks match "{search}".</p>
              </div>
            ) : (
              <div className="books-grid">
                {filtered.map(item => (
                  <AudiobookCard key={item.id} item={item} progress={data.progress?.[item.abs_id] || null} onChanged={load} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
