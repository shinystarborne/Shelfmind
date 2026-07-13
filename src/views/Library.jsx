import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Fuse from 'fuse.js'
import { API, useApp } from '../App'
import BookCard, { BookListItem } from '../components/BookCard'
import BookDrawer from '../components/BookDrawer'
import { coverSrc, initials, displayAuthor } from '../components/BookCard'

const SORT_OPTIONS = [
  { value: 'title',   label: 'Title A–Z' },
  { value: 'author',  label: 'Author A–Z' },
  { value: 'added',   label: 'Recently Added' },
  { value: 'status',  label: 'Status' },
]

const STATUS_FILTERS = [
  { value: 'unread',   label: '📖 Unread' },
  { value: 'reading',  label: '🔖 Reading' },
  { value: 'read',     label: '✅ Read' },
  { value: 'dnf',      label: '🚫 DNF' },
]

// Flag emoji for common language codes; anything else falls back to 🌐
const LANG_FLAGS = {
  en: '🇬🇧', ru: '🇷🇺', de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹', pt: '🇵🇹', nl: '🇳🇱',
  pl: '🇵🇱', uk: '🇺🇦', ja: '🇯🇵', zh: '🇨🇳', ko: '🇰🇷', sv: '🇸🇪', no: '🇳🇴', da: '🇩🇰',
  fi: '🇫🇮', cs: '🇨🇿', tr: '🇹🇷', ar: '🇸🇦', he: '🇮🇱', hi: '🇮🇳', el: '🇬🇷', hu: '🇭🇺',
  ro: '🇷🇴', bg: '🇧🇬', sr: '🇷🇸', be: '🇧🇾', kk: '🇰🇿', ka: '🇬🇪', lv: '🇱🇻', lt: '🇱🇹', et: '🇪🇪',
}

function langLabel(code) {
  let name
  try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) } catch { /* bad code */ }
  if (!name || name === code) name = code.toUpperCase()
  else name = name[0].toUpperCase() + name.slice(1)
  return `${LANG_FLAGS[code] || '🌐'} ${name}`
}

// ── Enrich progress bar ───────────────────────────────────────────────────────
function EnrichBar({ state, onStart, onDismiss }) {
  const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0

  if (state.done) return (
    <div className="enrich-banner">
      <span style={{ color: 'var(--sage-dark)' }}>✓</span>
      <span>
        {state.total === 0
          ? 'All books already enriched'
          : `Enrichment done — ${state.success}/${state.total} books updated`}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className="btn btn-ghost"
          style={{ padding: '3px 10px', fontSize: 11 }}
          onClick={() => onStart({ reset_failed: true })}
          title="Retry books that previously failed to match"
        >
          ↻ Retry failed
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: '3px 10px', fontSize: 11 }}
          onClick={() => onStart({ force: true })}
          title="Re-fetch metadata for all books from Open Library"
        >
          ↻ Re-enrich all
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: '3px 8px', fontSize: 11 }}
          onClick={onDismiss}
          title="Dismiss"
        >✕</button>
      </div>
    </div>
  )

  if (state.running) return (
    <div className="enrich-banner">
      <span className="spin">↻</span>
      <span>Fetching metadata… {state.current}/{state.total} ({pct}%)</span>
      <div className="enrich-bar">
        <div className="enrich-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
        ~{Math.round((state.total - state.current) * 1.1 / 60)} min left
      </span>
    </div>
  )

  return (
    <div className="enrich-banner">
      <span>🔍</span>
      <span>Fetch metadata from Open Library for all books</span>
      <button
        className="btn btn-secondary"
        style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12 }}
        onClick={() => onStart()}
      >
        Enrich All
      </button>
    </div>
  )
}

// ── Dropdown with fixed positioning ───────────────────────────────────────────
function FixedDropdown({ label, active, items, selected, onSelect, onClose }) {
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [open, setOpen] = useState(false)

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen(o => !o)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!triggerRef.current?.contains(e.target)) { setOpen(false); onClose?.() }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={`filter-chip ${active ? 'active' : ''}`}
        onClick={toggle}
      >
        {label} ▾
      </button>
      {open && (
        <div
          className="filter-dropdown-menu"
          style={{ top: pos.top, left: pos.left }}
        >
          <div
            className={`filter-dropdown-item ${!selected ? 'active' : ''}`}
            onMouseDown={() => { onSelect(''); setOpen(false) }}
          >
            All
          </div>
          {items.map(item => (
            <div
              key={item.value}
              className={`filter-dropdown-item ${selected === item.value ? 'active' : ''}`}
              onMouseDown={() => { onSelect(item.value); setOpen(false) }}
            >
              {item.label}
              {item.count != null && <span className="item-count">{item.count}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Read Next section ─────────────────────────────────────────────────────────
function ReadNextSection({ onBookClick }) {
  const [books,     setBooks]     = useState([])
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    fetch(`${API}/recommendations?limit=5`)
      .then(r => r.json())
      .then(setBooks)
      .catch(() => {})
  }, [])

  if (books.length === 0) return null

  return (
    <div className="read-next-section">
      <div className="read-next-header" onClick={() => setCollapsed(c => !c)}>
        <span>✨ Read Next</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
          ({books.length} suggestions)
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>{collapsed ? '▾' : '▴'}</span>
      </div>
      {!collapsed && (
        <div className="read-next-scroll">
          {books.map(book => {
            const src = coverSrc(book)
            const init = initials(book.title)
            return (
              <div key={book.id} className="read-next-card" onClick={() => onBookClick(book.id)}>
                {src
                  ? <img src={src} alt={book.title} />
                  : <div className="read-next-ph">{init}</div>
                }
                <div className="read-next-title">{book.title}</div>
                <div className="read-next-author">{displayAuthor(book)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Bulk action bar ───────────────────────────────────────────────────────────
function BulkBar({ selectedIds, onClear, onAction, toast }) {
  const count = selectedIds.length
  const [tagInput, setTagInput] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const doStatus = async (status) => {
    await fetch(`${API}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, action: 'status', value: status }),
    })
    toast(`${count} book${count > 1 ? 's' : ''} marked as ${status}`, 'success')
    onAction()
  }

  const doTag = async () => {
    const tag = tagInput.trim()
    if (!tag) return
    await fetch(`${API}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, action: 'tags', value: tag }),
    })
    toast(`Tag "${tag}" added to ${count} book${count > 1 ? 's' : ''}`, 'success')
    setTagInput('')
    setShowTagInput(false)
    onAction()
  }

  const doRemove = async () => {
    await fetch(`${API}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selectedIds, action: 'remove' }),
    })
    toast(`${count} book${count > 1 ? 's' : ''} removed`, 'success')
    setConfirmRemove(false)
    onAction()
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>
      <button className="btn btn-secondary" onClick={() => doStatus('read')}>✅ Mark Read</button>
      <button className="btn btn-secondary" onClick={() => doStatus('reading')}>🔖 Mark Reading</button>
      <button className="btn btn-secondary" onClick={() => doStatus('unread')}>📖 Mark Unread</button>
      {showTagInput ? (
        <>
          <input
            style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text)', width: 120 }}
            placeholder="Tag name…"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doTag() }}
            autoFocus
          />
          <button className="btn btn-secondary" onClick={doTag}>Add</button>
          <button className="btn btn-ghost" onClick={() => setShowTagInput(false)}>✕</button>
        </>
      ) : (
        <button className="btn btn-secondary" onClick={() => setShowTagInput(true)}>🏷️ Add Tag</button>
      )}
      {confirmRemove ? (
        <>
          <span style={{ fontSize: 12, color: '#c04040' }}>Remove {count} book{count > 1 ? 's' : ''}?</span>
          <button className="btn btn-ghost" style={{ color: '#c04040' }} onClick={doRemove}>Yes, remove</button>
          <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>Cancel</button>
        </>
      ) : (
        <button className="btn btn-ghost" style={{ color: '#c04040' }} onClick={() => setConfirmRemove(true)}>🗑️ Remove</button>
      )}
      <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClear}>✕ Deselect all</button>
    </div>
  )
}

// ── Grouped section (by-author / by-series) ───────────────────────────────────
function GroupSection({ name, books, selectedId, selectMode, selectedIds, onCheck, onCardClick }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 14, paddingBottom: 8,
        borderBottom: '1.5px solid var(--border)',
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          background: 'var(--cream-dark)', borderRadius: 10, padding: '2px 8px',
        }}>
          {books.length}
        </span>
      </div>
      <div className="books-grid">
        {books.map(book => (
          <BookCard
            key={book.id}
            book={book}
            selected={selectedId === book.id}
            onClick={b => !selectMode && onCardClick(b.id === selectedId ? null : b.id)}
            selectable={selectMode}
            checked={selectedIds.includes(book.id)}
            onCheck={onCheck}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main Library view ─────────────────────────────────────────────────────────
export default function Library() {
  const { toast, prefs, setRefreshLibrary, refreshLibrary } = useApp()
  const [books, setBooks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [view, setView]             = useState(() => localStorage.getItem('sm_view') || 'grid')
  const [sort, setSort]             = useState('title')
  const [filters, setFilters]       = useState({ status: '', language: '', format: '' })
  const [authorFilter, setAuthorFilter] = useState('')
  const [seriesFilter, setSeriesFilter] = useState('')
  const [tagFilter,    setTagFilter]    = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [authors, setAuthors]       = useState([])
  const [series, setSeries]         = useState([])
  const [languages, setLanguages]   = useState([])
  const [allTags, setAllTags]       = useState([])
  const [enrichState, setEnrichState] = useState({ running: false, done: false, current: 0, total: 0, success: 0 })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [duplicates, setDuplicates] = useState([])
  const [showDupsOnly, setShowDupsOnly] = useState(false)
  const searchRef = useRef(null)
  const enrichPollRef = useRef(null)

  const loadBooks = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filters.status)   params.set('status',   filters.status)
    if (filters.language) params.set('language',  filters.language)
    if (filters.format)   params.set('format',    filters.format)
    if (authorFilter)     params.set('author',    authorFilter)
    if (seriesFilter)     params.set('series',    seriesFilter)

    fetch(`${API}/books?${params}`)
      .then(r => r.json())
      .then(data => { setBooks(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filters, authorFilter, seriesFilter])

  useEffect(() => { loadBooks() }, [loadBooks])
  useEffect(() => { setRefreshLibrary(loadBooks) }, [loadBooks, setRefreshLibrary])

  useEffect(() => {
    fetch(`${API}/meta/authors`).then(r => r.json()).then(setAuthors).catch(() => {})
    fetch(`${API}/meta/series`).then(r => r.json()).then(setSeries).catch(() => {})
    fetch(`${API}/meta/tags`).then(r => r.json()).then(setAllTags).catch(() => {})
    fetch(`${API}/meta/languages`).then(r => r.json()).then(setLanguages).catch(() => {})
    fetch(`${API}/duplicates`).then(r => r.json()).then(setDuplicates).catch(() => {})
  }, [])

  // Check if enrichment is already running when page loads.
  // Deliberately don't restore a stale "done" state — that banner used to stick forever.
  useEffect(() => {
    fetch(`${API}/enrich/status`).then(r => r.json()).then(s => {
      if (s.running) { setEnrichState(s); startEnrichPoll() }
    }).catch(() => {})
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault(); searchRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
        setSelectMode(false)
        setSelectedIds([])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Fuse search
  const fuse = useMemo(() => new Fuse(books, {
    keys: ['title', 'author', 'author_canonical', 'series_name'],
    threshold: 0.35,
    ignoreLocation: true,
  }), [books])

  // Duplicate ids set for quick lookup
  const dupIds = useMemo(() => {
    const ids = new Set()
    for (const g of duplicates) for (const b of g.books) ids.add(b.id)
    return ids
  }, [duplicates])

  const filtered = useMemo(() => {
    let result = search.length > 1
      ? fuse.search(search).map(r => r.item)
      : [...books]

    // Tag filter (client-side)
    if (tagFilter) result = result.filter(b => (b.tags || []).includes(tagFilter))

    // Duplicates-only filter
    if (showDupsOnly) result = result.filter(b => dupIds.has(b.id))

    result.sort((a, b) => {
      if (sort === 'title')  return a.title.localeCompare(b.title)
      if (sort === 'author') return (a.author_canonical || a.author || '').localeCompare(b.author_canonical || b.author || '')
      if (sort === 'added')  return (b.added_at || 0) - (a.added_at || 0)
      if (sort === 'status') {
        const order = { reading: 0, unread: 1, read: 2, dnf: 3 }
        return (order[a.read_status] ?? 1) - (order[b.read_status] ?? 1)
      }
      return 0
    })
    return result
  }, [books, search, sort, fuse, tagFilter, showDupsOnly, dupIds])

  const groupedByAuthor = useMemo(() => {
    if (view !== 'by-author') return null
    const groups = {}
    for (const book of filtered) {
      const author = book.author_canonical || book.author || 'Unknown'
      if (!groups[author]) groups[author] = []
      groups[author].push(book)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, books]) => ({
        name,
        books: [...books].sort((a, b) => {
          const sa = a.series_name || '', sb = b.series_name || ''
          if (sa !== sb) return sa.localeCompare(sb)
          const na = a.series_num ?? Infinity, nb = b.series_num ?? Infinity
          if (na !== nb) return na - nb
          return a.title.localeCompare(b.title)
        }),
      }))
  }, [filtered, view])

  const groupedBySeries = useMemo(() => {
    if (view !== 'by-series') return null
    const seriesMap = {}
    const standalone = []
    for (const book of filtered) {
      if (!book.series_name) { standalone.push(book); continue }
      if (!seriesMap[book.series_name]) seriesMap[book.series_name] = []
      seriesMap[book.series_name].push(book)
    }
    const groups = Object.entries(seriesMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, books]) => ({
        name,
        books: [...books].sort((a, b) => {
          const na = a.series_num ?? Infinity, nb = b.series_num ?? Infinity
          return na !== nb ? na - nb : a.title.localeCompare(b.title)
        }),
      }))
    if (standalone.length) {
      groups.push({
        name: 'Standalone',
        books: [...standalone].sort((a, b) => a.title.localeCompare(b.title)),
      })
    }
    return groups
  }, [filtered, view])

  const setFilter = (key, val) =>
    setFilters(f => ({ ...f, [key]: f[key] === val ? '' : val }))

  const clearAll = () => {
    setFilters({ status: '', language: '', format: '' })
    setAuthorFilter('')
    setSeriesFilter('')
    setTagFilter('')
    setShowDupsOnly(false)
    setSearch('')
  }

  const hasFilters = Object.values(filters).some(Boolean) || authorFilter || seriesFilter || tagFilter || showDupsOnly

  const handleStatusChange = (id, status) =>
    setBooks(bs => bs.map(b => b.id === id ? { ...b, read_status: status } : b))

  const saveView = (v) => { setView(v); localStorage.setItem('sm_view', v) }

  // Enrich
  const startEnrichPoll = () => {
    if (enrichPollRef.current) return
    enrichPollRef.current = setInterval(async () => {
      const s = await fetch(`${API}/enrich/status`).then(r => r.json()).catch(() => null)
      if (!s) return
      setEnrichState(s)
      if (s.done || !s.running) {
        clearInterval(enrichPollRef.current)
        enrichPollRef.current = null
        loadBooks()
        // Auto-dismiss the "done" banner back to the idle prompt after 3s
        setTimeout(() => {
          setEnrichState(es => es.running ? es : { running: false, done: false, current: 0, total: 0, success: 0 })
        }, 3000)
      }
    }, 1500)
  }

  const handleEnrichAll = async (opts = {}) => {
    await fetch(`${API}/enrich/all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    setEnrichState({ running: true, current: 0, total: 0, success: 0, done: false })
    startEnrichPoll()
  }

  // Bulk select helpers
  const toggleSelectMode = () => {
    setSelectMode(m => !m)
    setSelectedIds([])
  }
  const handleCheck = (id, checked) => {
    setSelectedIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id))
  }

  // Yearly goal progress
  const goal = parseInt(prefs?.reading_goal) || 0
  const currentYear = new Date().getFullYear()
  const booksReadThisYear = useMemo(() => {
    return books.filter(b => {
      if (b.read_status !== 'read') return false
      if (!b.finished_at) return false
      return new Date(b.finished_at * 1000).getFullYear() === currentYear
    }).length
  }, [books, currentYear])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-title">My Library</div>
        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input
            ref={searchRef}
            className="search-input"
            placeholder="Search title, author, series… ( / )"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {(view === 'grid' || view === 'list') && (
          <select
            className="btn btn-ghost"
            style={{ fontWeight: 400, fontSize: 13 }}
            value={sort}
            onChange={e => setSort(e.target.value)}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button
          className={`btn ${selectMode ? 'btn-primary' : 'btn-ghost'}`}
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={toggleSelectMode}
          title="Bulk select"
        >
          ☑ Select
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 16, padding: '4px 8px' }}
          onClick={loadBooks}
          title="Reload library"
        >↻</button>
        <div className="view-toggle">
          <button className={view === 'grid'      ? 'active' : ''} onClick={() => saveView('grid')}      title="Grid">▦</button>
          <button className={view === 'list'      ? 'active' : ''} onClick={() => saveView('list')}      title="List">☰</button>
          <button className={view === 'by-author' ? 'active' : ''} onClick={() => saveView('by-author')} title="By Author">A</button>
          <button className={view === 'by-series' ? 'active' : ''} onClick={() => saveView('by-series')} title="By Series">#</button>
        </div>
      </div>

      {/* Enrich progress banner */}
      <EnrichBar
        state={enrichState}
        onStart={handleEnrichAll}
        onDismiss={() => setEnrichState({ running: false, done: false, current: 0, total: 0, success: 0 })}
      />

      {/* Yearly goal bar */}
      {goal > 0 && (
        <div className="goal-bar-wrap">
          <span>📚</span>
          <span style={{ fontWeight: 700 }}>{booksReadThisYear} / {goal}</span>
          <span>books read this year</span>
          <div className="goal-bar-track">
            <div className="goal-bar-fill" style={{ width: `${Math.min(100, (booksReadThisYear / goal) * 100)}%` }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {goal - booksReadThisYear > 0 ? `${goal - booksReadThisYear} to go` : '🎉 Goal reached!'}
          </span>
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && selectedIds.length > 0 && (
        <BulkBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
          onAction={() => { loadBooks(); setSelectedIds([]) }}
          toast={toast}
        />
      )}

      {/* Filter chips */}
      <div className="filter-bar">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            className={`filter-chip ${filters.status === f.value ? 'active' : ''}`}
            onClick={() => setFilter('status', f.value)}
          >
            {f.label}
          </button>
        ))}

        {languages.length > 0 && (
          <>
            <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
            {languages.slice(0, 10).map(l => (
              <button
                key={l.code}
                className={`filter-chip ${filters.language === l.code ? 'active' : ''}`}
                onClick={() => setFilter('language', l.code)}
                title={`${l.count} book${l.count !== 1 ? 's' : ''}`}
              >
                {langLabel(l.code)}
              </button>
            ))}
          </>
        )}

        <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />

        <FixedDropdown
          label={authorFilter ? `✍️ ${authorFilter.split(' ')[0]}…` : 'Author'}
          active={!!authorFilter}
          selected={authorFilter}
          items={authors.map(a => ({ value: a.name, label: a.name, count: a.count }))}
          onSelect={setAuthorFilter}
        />

        {series.length > 0 && (
          <FixedDropdown
            label={seriesFilter ? `📚 ${seriesFilter.split(' ')[0]}…` : 'Series'}
            active={!!seriesFilter}
            selected={seriesFilter}
            items={series.map(s => ({ value: s.name, label: s.name, count: s.count }))}
            onSelect={setSeriesFilter}
          />
        )}

        {allTags.length > 0 && (
          <FixedDropdown
            label={tagFilter ? `🏷️ ${tagFilter}` : 'Tags'}
            active={!!tagFilter}
            selected={tagFilter}
            items={allTags.map(t => ({ value: t.tag, label: t.tag, count: t.count }))}
            onSelect={setTagFilter}
          />
        )}

        {duplicates.length > 0 && (
          <button
            className={`filter-chip dup-chip ${showDupsOnly ? 'active' : ''}`}
            onClick={() => setShowDupsOnly(d => !d)}
          >
            ⚠️ {duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''}
          </button>
        )}

        {hasFilters && (
          <button className="filter-chip" onClick={clearAll} style={{ color: 'var(--rose-deep)' }}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* Read Next */}
      <ReadNextSection onBookClick={id => setSelectedId(id)} />

      {/* Books */}
      <div className="library-body">
        <div className="books-area">
          {loading ? (
            <div className="empty-state">
              <div className="spin" style={{ fontSize: 32 }}>↻</div>
              <p>Loading your library…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h3>No books found</h3>
              <p>{search ? `No results for "${search}"` : 'Try adjusting your filters, or hit Scan to pick up new books.'}</p>
              {hasFilters && (
                <button className="btn btn-secondary" onClick={clearAll} style={{ marginTop: 8 }}>Clear filters</button>
              )}
            </div>
          ) : (
            <>
              <div className="results-count">{filtered.length} book{filtered.length !== 1 ? 's' : ''}</div>
              {view === 'grid' ? (
                <div className="books-grid">
                  {filtered.map(book => (
                    <BookCard
                      key={book.id}
                      book={book}
                      selected={selectedId === book.id}
                      onClick={b => !selectMode && setSelectedId(b.id === selectedId ? null : b.id)}
                      selectable={selectMode}
                      checked={selectedIds.includes(book.id)}
                      onCheck={handleCheck}
                    />
                  ))}
                </div>
              ) : view === 'list' ? (
                <div className="books-list">
                  {filtered.map(book => (
                    <BookListItem
                      key={book.id}
                      book={book}
                      selected={selectedId === book.id}
                      onClick={b => !selectMode && setSelectedId(b.id === selectedId ? null : b.id)}
                      selectable={selectMode}
                      checked={selectedIds.includes(book.id)}
                      onCheck={handleCheck}
                    />
                  ))}
                </div>
              ) : view === 'by-author' ? (
                groupedByAuthor.map(({ name, books }) => (
                  <GroupSection
                    key={name}
                    name={name}
                    books={books}
                    selectedId={selectedId}
                    selectMode={selectMode}
                    selectedIds={selectedIds}
                    onCheck={handleCheck}
                    onCardClick={setSelectedId}
                  />
                ))
              ) : (
                groupedBySeries.map(({ name, books }) => (
                  <GroupSection
                    key={name}
                    name={name}
                    books={books}
                    selectedId={selectedId}
                    selectMode={selectMode}
                    selectedIds={selectedIds}
                    onCheck={handleCheck}
                    onCardClick={setSelectedId}
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>

      {selectedId && (
        <BookDrawer
          bookId={selectedId}
          onClose={() => setSelectedId(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  )
}
