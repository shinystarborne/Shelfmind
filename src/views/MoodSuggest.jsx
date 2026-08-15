import { useState, useEffect } from 'react'
import { API, useApp } from '../App'
import { coverSrc, initials, displayAuthor } from '../components/BookCard'
import BookDrawer from '../components/BookDrawer'

// ── AI mood suggestions ───────────────────────────────────────────────────────
// Chip row comes from the AI-profiled tag vocabulary (/api/mood/tags); the
// server pre-filters saved mood profiles and one LLM call picks 1–3 matches.
// Book metadata is resolved client-side from /api/books (same data the Library
// view uses); audiobook items from /api/audiobooks when ABS is configured.

// aiProfiles.json keys prefix audiobook ids with "abs_" — strip it defensively
// in case the suggest endpoint passes the raw profile key through as id.
function absId(id = '') {
  return id.startsWith('abs_') ? id.slice(4) : id
}

function SuggestionCard({ suggestion, book, audioItem, onOpenBook, onPlayAudio }) {
  const isAudio = suggestion.kind === 'audiobook'
  const title  = isAudio ? (audioItem?.title  || 'Unknown audiobook') : (book?.title || 'Unknown book')
  const author = isAudio ? (audioItem?.author || '') : (book ? displayAuthor(book) : '')
  const init   = initials(title)
  const src    = isAudio
    ? `${API}/audiobooks/${absId(suggestion.id)}/cover`
    : (book ? coverSrc(book, { thumb: true }) : null)

  return (
    <div className="chart-card mood-card">
      <div className="mood-card-head">
        {src ? (
          <img
            className="mood-card-cover"
            src={src}
            alt={title}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div className="mood-card-cover-ph" style={{ display: src ? 'none' : 'flex' }}>
          <div className="initials">{init}</div>
        </div>
        <div className="mood-card-info">
          <div className="book-title">{title}</div>
          <div className="book-author">{author}</div>
          <div className="book-badges">
            {isAudio
              ? <span className="badge badge-series">🎧 audiobook</span>
              : <span className={`badge badge-${book?.read_status || 'unread'}`}>{book?.read_status || 'unread'}</span>}
          </div>
        </div>
      </div>
      <p className="mood-reason">{suggestion.reason}</p>
      <div className="mood-card-actions">
        {isAudio
          ? audioItem && (
            <button className="btn btn-secondary" onClick={() => onPlayAudio(audioItem)}>
              ▶ Play
            </button>
          )
          : book && (
            <button className="btn btn-secondary" onClick={() => onOpenBook(book.id)}>
              Open book
            </button>
          )}
      </div>
    </div>
  )
}

export default function MoodSuggest() {
  const { prefs, toast, openAudiobook } = useApp()
  const [tags, setTags]               = useState([])
  const [chips, setChips]             = useState([])
  const [moodText, setMoodText]       = useState('')
  const [includeRereads, setIncludeRereads] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [suggestions, setSuggestions] = useState(null)   // null = haven't asked yet
  const [needsKey, setNeedsKey]       = useState(false)
  const [status, setStatus]           = useState(null)   // profiling job, enrich-shaped
  const [books, setBooks]             = useState({})     // id → book
  const [audio, setAudio]             = useState({})     // abs_id → item
  const [drawerBookId, setDrawerBookId] = useState(null)
  const [roast, setRoast]               = useState(null)
  const [roastLoading, setRoastLoading] = useState(false)

  useEffect(() => {
    fetch(`${API}/mood/tags`).then(r => r.json()).then(d => setTags(d.tags || [])).catch(() => {})
    fetch(`${API}/mood/status`).then(r => r.json()).then(setStatus).catch(() => {})
    fetch(`${API}/books`).then(r => r.json()).then(list => {
      const map = {}
      for (const b of list) map[b.id] = b
      setBooks(map)
    }).catch(() => {})
  }, [])

  // Poll while a profiling run is active so the counter updates live; refresh
  // the chip vocabulary when the run finishes (new profiles have landed).
  useEffect(() => {
    if (!status?.running) return
    const iv = setInterval(async () => {
      const s = await fetch(`${API}/mood/status`).then(r => r.json()).catch(() => null)
      if (!s) return
      setStatus(s)
      if (!s.running) {
        fetch(`${API}/mood/tags`).then(r => r.json()).then(d => setTags(d.tags || [])).catch(() => {})
      }
    }, 2000)
    return () => clearInterval(iv)
  }, [status?.running])

  useEffect(() => {
    if (!prefs.abs_url) return
    fetch(`${API}/audiobooks`).then(r => r.json()).then(d => {
      const map = {}
      for (const item of d.items || []) map[item.abs_id] = item
      setAudio(map)
    }).catch(() => {})
  }, [prefs.abs_url])

  const toggleChip = (tag) => {
    setChips(c => c.includes(tag) ? c.filter(t => t !== tag) : [...c, tag])
  }

  const suggest = async () => {
    if (loading) return
    setLoading(true)
    setNeedsKey(false)
    try {
      const r = await fetch(`${API}/mood/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moodText, chips, includeRereads }),
      })
      if (r.status === 400) { setNeedsKey(true); setSuggestions(null); return }
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.error || `Server error ${r.status}`)
      }
      const d = await r.json()
      setSuggestions(d.suggestions || [])
    } catch (err) {
      toast(err.message === 'Failed to fetch'
        ? 'Could not get suggestions — is the server running?'
        : `Suggestion failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const getRoast = async () => {
    if (roastLoading) return
    setRoastLoading(true)
    try {
      const r = await fetch(`${API}/roast`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.error || `Server error ${r.status}`)
      setRoast(d.roast || '')
    } catch (err) {
      toast(err.message === 'Failed to fetch'
        ? 'Could not get a roast — is the server running?'
        : `Roast failed: ${err.message}`)
    } finally {
      setRoastLoading(false)
    }
  }

  const hasKey = !!(prefs.openrouter_key || prefs.llm_base_url)
  const profiling = !!status?.running
  const profiledSoFar = status?.current ?? 0
  const profileTotal  = status?.total ?? 0

  if (!hasKey || needsKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="topbar">
          <div className="topbar-title">Mood</div>
        </div>
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-icon">🔮</div>
          <h3>No AI model configured yet</h3>
          <p>
            Mood suggestions are powered by an AI model — OpenRouter (bring your own key)
            or a local LLM server. Set one up in <strong>Preferences → Library Tools → AI (Mood Suggestions)</strong>,
            then run "Profile All Books" once.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="topbar">
        <div className="topbar-title">Mood</div>
      </div>

      <div className="mood-body">
        <div className="chart-card" style={{ marginBottom: 20 }}>
          <h3>What are you in the mood for?</h3>

          {tags.length > 0 && (
            <div className="mood-chips">
              {tags.map(t => (
                <button
                  key={t}
                  className={`filter-chip ${chips.includes(t) ? 'active' : ''}`}
                  onClick={() => toggleChip(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="mood-input-row">
            <input
              className="pref-input"
              style={{ flex: 1 }}
              value={moodText}
              onChange={e => setMoodText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') suggest() }}
              placeholder='e.g. "something cozy and a little sad" or "fast-paced space adventure"'
            />
            <button
              className="btn btn-primary"
              onClick={suggest}
              disabled={loading || (!moodText.trim() && chips.length === 0)}
            >
              {loading ? <span className="spin">↻</span> : '🔮'} Suggest
            </button>
            {loading && (
              <span style={{ fontSize: 12, color: 'var(--text-soft)', alignSelf: 'center' }}>
                thinking… a local model can take a minute or two
              </span>
            )}
          </div>

          <label className="mood-rereads">
            <input
              type="checkbox"
              checked={includeRereads}
              onChange={e => setIncludeRereads(e.target.checked)}
            />
            Include books I've already read
          </label>

          <div style={{ marginTop: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <button className="btn btn-secondary" onClick={getRoast} disabled={roastLoading}>
              {roastLoading ? <span className="spin">↻</span> : '🔥'} Roast my library
            </button>
            {roastLoading && (
              <span style={{ fontSize: 12, color: 'var(--text-soft)', marginLeft: 8 }}>
                judging your taste… a local model can take a minute or two
              </span>
            )}
          </div>

          {profiling && (
            <div className="enrich-banner" style={{ marginTop: 12, borderRadius: 8 }}>
              <span className="spin">↻</span>
              <span>
                Still profiling your library… {profiledSoFar}/{profileTotal} — suggestions improve as more books are profiled.
              </span>
              <div className="enrich-bar">
                <div
                  className="enrich-bar-fill"
                  style={{ width: profileTotal > 0 ? `${(profiledSoFar / profileTotal) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}
        </div>

        {suggestions !== null && (
          suggestions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p>No matches for that mood yet. Try different chips or wording — or profile more of your library first.</p>
            </div>
          ) : (
            <>
              <div className="mood-grid">
                {suggestions.map(s => (
                  <SuggestionCard
                    key={`${s.kind}-${s.id}`}
                    suggestion={s}
                    book={s.kind === 'book' ? books[s.id] : null}
                    audioItem={s.kind === 'audiobook' ? audio[absId(s.id)] : null}
                    onOpenBook={setDrawerBookId}
                    onPlayAudio={item => openAudiobook(item, 0)}
                  />
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <button className="btn btn-secondary" onClick={suggest} disabled={loading}>
                  {loading ? <span className="spin">↻</span> : '🎲'} Another one
                </button>
              </div>
            </>
          )
        )}

        {roast && (
          <div className="chart-card" style={{ marginTop: 20 }}>
            <h3>🔥 The Roast</h3>
            <p style={{ whiteSpace: 'pre-line', lineHeight: 1.7, color: 'var(--text)', margin: 0 }}>{roast}</p>
          </div>
        )}
      </div>

      {drawerBookId && (
        <BookDrawer
          bookId={drawerBookId}
          onClose={() => setDrawerBookId(null)}
          onStatusChange={(id, st) =>
            setBooks(m => m[id] ? { ...m, [id]: { ...m[id], read_status: st } } : m)
          }
        />
      )}
    </div>
  )
}
