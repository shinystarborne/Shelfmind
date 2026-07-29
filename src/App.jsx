import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import Library from './views/Library'
import Insights from './views/Insights'
import Preferences from './views/Preferences'
import ReadingList from './views/ReadingList'
import PdfTab from './views/PdfTab'
import Reader from './components/Reader'
import PdfReader from './components/PdfReader'
import Quotes from './views/Quotes'
import UpdateNotesModal from './components/UpdateNotesModal'

// When loaded in Electron (file://) hostname is empty — fall back to localhost.
// When opened in a browser via QR code the hostname is the LAN IP, so API calls go to the right machine.
const API_HOST = window.location.hostname || 'localhost'
// Default to 3001; Electron updates this dynamically if port was bumped.
export let API = `http://${API_HOST}:3001/api`

// ── Global context ────────────────────────────────────────────────────────────
export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Pinned pseudo-shelf id — computed server-side from series/read-status, not a
// user-saved filter, so Library special-cases it instead of treating it like
// a normal smart shelf.
export const CONTINUE_SERIES_SHELF_ID = '__continue-series__'

// ── Toast system ──────────────────────────────────────────────────────────────
function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type || ''}`}>
          <span>{t.msg}</span>
          <button className="toast-close" title="Dismiss" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Scan indicator ────────────────────────────────────────────────────────────
function ScanButton({ onScanDone }) {
  const [state, setState] = useState({ running: false, done: false, current: 0, total: 0, added: 0 })

  const triggerScan = async () => {
    if (state.running) return
    setState(s => ({ ...s, running: true, done: false, current: 0, added: 0 }))
    await fetch(`${API}/scan`, { method: 'POST' })

    const poll = setInterval(async () => {
      const r = await fetch(`${API}/scan/status`).then(r => r.json())
      setState(r)
      if (r.done || !r.running) {
        clearInterval(poll)
        if (r.done) onScanDone?.(r)
      }
    }, 600)
  }

  const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0

  return (
    <button
      className={`btn btn-secondary btn-scan ${state.running ? 'scanning' : ''}`}
      onClick={triggerScan}
      disabled={state.running}
      title={state.done ? `Last scan: +${state.added} books` : ''}
    >
      <span className={state.running ? 'spin' : ''}>↻</span>
      {state.running ? `Scanning… ${pct}%` : 'Scan'}
    </button>
  )
}

// ── Update suggestion banner ─────────────────────────────────────────────────
function UpdateBanner() {
  const { updateState, downloadUpdate, dismissUpdateBanner } = useApp()
  const { status, info, progress } = updateState
  if (status !== 'available' && status !== 'downloading') return null

  return (
    <div className="update-banner" style={{
      position: 'fixed', top: 'calc(var(--titlebar-h) + 8px)', right: 12, zIndex: 500,
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--cream)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '10px 14px', boxShadow: 'var(--shadow-lift)',
      fontSize: 13, color: 'var(--text)',
    }}>
      <span>
        {status === 'downloading'
          ? `Downloading v${info?.version}… ${progress}%`
          : `ShelfMind v${info?.version} is available.`}
      </span>
      {status === 'available' && (
        <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={downloadUpdate}>Update</button>
      )}
      <button
        className="btn btn-ghost"
        style={{ padding: '2px 6px', fontSize: 14 }}
        onClick={dismissUpdateBanner}
        title="Dismiss"
      >✕</button>
    </div>
  )
}

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'library',  icon: '📚', label: 'Library' },
  { id: 'quotes',   icon: '❝',  label: 'Quotes' },
  { id: 'insights', icon: '✨', label: 'Insights' },
]

export default function App() {
  const [view, setView] = useState('library')
  const [toasts, setToasts] = useState([])
  const [prefs, setPrefs] = useState({})
  const [bookCount, setBookCount] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [_refreshLibraryFn, _setRefreshLibraryFn] = useState(() => () => {})
  const setRefreshLibrary = useCallback(fn => _setRefreshLibraryFn(() => fn), [])
  const refreshLibrary    = useCallback(() => _refreshLibraryFn(), [_refreshLibraryFn])
  const [lists, setLists] = useState([])
  const [activeListId, setActiveListId] = useState(null)
  const [shelves, setShelves] = useState([])
  const [activeShelfId, setActiveShelfId] = useState(null)
  const [continueSeriesCount, setContinueSeriesCount] = useState(0)
  const [pdfTabs, setPdfTabs] = useState([])
  const [activePdfTabId, setActivePdfTabId] = useState(null)
  const [readerBook, setReaderBook] = useState(null)   // { book, target } → reader open

  // App-wide updater state — shared by the auto-check-on-launch banner/modal below
  // and Preferences' manual "Check for Updates" button, so both reflect one truth
  // and only App (which never unmounts) owns the electron-updater IPC listeners.
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, progress: 0, error: null })
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  const [readyModalDismissed, setReadyModalDismissed] = useState(false)
  const dismissUpdateBanner = useCallback(() => setUpdateBannerDismissed(true), [])

  const checkForUpdate = useCallback((beta) => {
    const api = window.electronAPI
    if (!api) return Promise.resolve()
    setUpdateState(s => ({ ...s, status: 'checking', error: null }))
    return api.checkForUpdates({ beta }).catch(err => {
      setUpdateState(s => ({ ...s, status: 'error', error: err.message || 'Update check failed' }))
    })
  }, [])

  const downloadUpdate = useCallback(() => {
    window.electronAPI?.downloadUpdate()
    setUpdateState(s => ({ ...s, status: 'downloading', progress: 0 }))
  }, [])

  const installUpdateNow = useCallback(() => {
    window.electronAPI?.installUpdate()
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    // These listeners live for the whole app session — deliberately never torn down
    // via removeUpdateListeners(), since Preferences' UpdaterSection now reads this
    // same shared state instead of registering its own.
    api.onUpdateAvailable(info => {
      setUpdateState(s => ({ ...s, status: 'available', info, error: null }))
      setUpdateBannerDismissed(false)
    })
    api.onUpdateNotAvailable(() => {
      setUpdateState(s => (s.status === 'checking' ? { ...s, status: 'up-to-date' } : s))
    })
    api.onUpdateProgress(p => {
      setUpdateState(s => ({ ...s, status: 'downloading', progress: Math.round(p.percent) }))
    })
    api.onUpdateDownloaded(info => {
      setUpdateState(s => ({ ...s, status: 'ready', info, error: null }))
      setReadyModalDismissed(false)
    })
    api.onUpdateError(msg => {
      setUpdateState(s => ({ ...s, status: 'error', error: msg }))
    })
  }, [])

  // Library front-page nudge banners (Enrich / Search Index) — hidden by default,
  // surfaced only right after a fresh scan finds books or PDFs get added, so they
  // don't sit there permanently. Independent of whether a job is actually running/done.
  const [libraryNudges, setLibraryNudges] = useState({ enrich: false, index: false })
  const nudgeLibrary  = useCallback((which) => setLibraryNudges(n => ({ ...n, ...which })), [])
  const dismissNudge  = useCallback((key)   => setLibraryNudges(n => ({ ...n, [key]: false })), [])

  const openReader  = useCallback((book, target = null) => setReaderBook({ book, target }), [])
  const closeReader = useCallback(() => setReaderBook(null), [])

  // Up to 2 PDF "panes" open at once — normally 1 (full width); a second one
  // appears via "Open alongside" / "Duplicate alongside" inside the reader.
  const [pdfPanes, setPdfPanes]         = useState([])   // [{ paneId, doc, target }]
  const [activePdfPane, setActivePdfPane] = useState(null)
  const pdfReaderDoc = pdfPanes[0] ?? null   // back-compat for consumers that only know about a single reader

  const openPdfReader = useCallback((doc, target = null) => {
    const paneId = Date.now().toString(36) + Math.random().toString(36).slice(2)
    setPdfPanes([{ paneId, doc, target }])
    setActivePdfPane(paneId)
  }, [])
  const closePdfReader = useCallback(() => setPdfPanes([]), [])

  const openPdfReaderAlongside = useCallback((doc, fromPaneId) => {
    const paneId = Date.now().toString(36) + Math.random().toString(36).slice(2)
    setPdfPanes(panes => {
      if (panes.length < 2) return [...panes, { paneId, doc, target: null }]
      return panes.map(p => (p.paneId === fromPaneId ? p : { paneId, doc, target: null }))
    })
    setActivePdfPane(paneId)
  }, [])

  const closePdfPane = useCallback((paneId) => {
    setPdfPanes(panes => panes.filter(p => p.paneId !== paneId))
  }, [])

  const loadLists = useCallback(() => {
    fetch(`${API}/lists`).then(r => r.json()).then(setLists).catch(() => {})
  }, [])

  const loadShelves = useCallback(() => {
    fetch(`${API}/smart-shelves`).then(r => r.json()).then(setShelves).catch(() => {})
    fetch(`${API}/continue-series`).then(r => r.json()).then(b => setContinueSeriesCount(b.length)).catch(() => {})
  }, [])

  const openShelf = useCallback((shelfId) => {
    setActiveShelfId(shelfId)
    setView('library')
  }, [])

  const loadPdfTabs = useCallback(() => {
    fetch(`${API}/pdf-tabs`).then(r => r.json()).then(setPdfTabs).catch(() => {})
  }, [])

  const createList = async () => {
    const name = 'New List'
    const list = await fetch(`${API}/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json())
    loadLists()
    setActiveListId(list.id)
    setView('list')
  }

  const toast = useCallback((msg, type = '') => {
    const id = Date.now() + Math.random()
    setToasts(ts => [...ts, { id, msg, type }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3000)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    async function init() {
      // In Electron, ask main process for the actual port (may have bumped from 3001)
      if (window.electronAPI?.getServerPort) {
        const port = await window.electronAPI.getServerPort()
        API = `http://${API_HOST}:${port}/api`
      }
      fetch(`${API}/preferences`).then(r => r.json()).then(p => {
        setPrefs(p)
        const theme = p.theme === 'dark' ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', theme)
        window.electronAPI?.setTheme(theme)
        // Quietly check for updates a few seconds after launch — respects the
        // beta-channel preference; only surfaces UI if something is actually found.
        if (window.electronAPI) setTimeout(() => checkForUpdate(!!p.beta_updates), 5000)
      }).catch(() => {})
      fetch(`${API}/books`).then(r => r.json()).then(b => setBookCount(b.length)).catch(() => {})
      fetch(`${API}/lists`).then(r => r.json()).then(setLists).catch(() => {})
      fetch(`${API}/pdf-tabs`).then(r => r.json()).then(setPdfTabs).catch(() => {})
      loadShelves()
    }
    init()
  }, [])

  const toggleTheme = useCallback(() => {
    const next = prefs.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    window.electronAPI?.setTheme(next)
    setPrefs(p => ({ ...p, theme: next }))
    fetch(`${API}/preferences`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ theme: next }),
    }).catch(() => {})
  }, [prefs.theme])

  const handleScanDone = useCallback((result) => {
    toast(`Scan complete — ${result.added ?? 0} new books added`, 'success')
    fetch(`${API}/books`).then(r => r.json()).then(b => setBookCount(b.length)).catch(() => {})
    if (result.added > 0) nudgeLibrary({ enrich: true, index: true })
  }, [toast, nudgeLibrary])

  const refreshPrefs = () => fetch(`${API}/preferences`).then(r => r.json()).then(setPrefs)

  return (
    <AppCtx.Provider value={{
      toast, prefs, refreshPrefs, toggleTheme, refreshLibrary, setRefreshLibrary,
      pdfTabs, loadPdfTabs, openReader, readerBook, openPdfReader, pdfReaderDoc,
      libraryNudges, nudgeLibrary, dismissNudge,
      updateState, checkForUpdate, downloadUpdate, installUpdateNow, dismissUpdateBanner,
      shelves, activeShelfId, setActiveShelfId, loadShelves, continueSeriesCount,
    }}>
      <div className={`app-shell${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Toggle button lives here — always in layout flow, never fights drag regions */}
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Hide menu' : 'Show menu'}
          >☰</button>

          {/* Full sidebar content — hidden when collapsed */}
          <div className="sidebar-inner">
            <div className="sidebar-logo">
              <h1>ShelfMind</h1>
              <div className="tagline">reading girls are cool</div>
            </div>

            <nav className="nav-section">
              <div className="nav-section-label">Menu</div>
              {NAV.map(n => (
                <button
                  key={n.id}
                  className={`nav-item ${view === n.id && !activeShelfId ? 'active' : ''}`}
                  onClick={() => { setView(n.id); if (n.id === 'library') setActiveShelfId(null) }}
                >
                  <span className="nav-icon">{n.icon}</span>
                  {n.label}
                  {n.id === 'library' && bookCount !== null && (
                    <span className="nav-badge">{bookCount}</span>
                  )}
                </button>
              ))}
            </nav>

            <div className="divider" style={{ margin: '0 16px' }} />

            <nav className="nav-section" style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 }}>
                <div className="nav-section-label">Reading Lists</div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 16, padding: '0 4px', lineHeight: 1, color: 'var(--text-muted)' }}
                  title="New list"
                  onClick={createList}
                >+</button>
              </div>
              {lists.map(l => (
                <button
                  key={l.id}
                  className={`nav-item ${view === 'list' && activeListId === l.id ? 'active' : ''}`}
                  onClick={() => { setActiveListId(l.id); setView('list') }}
                >
                  <span className="nav-icon">📋</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                  <span className="nav-badge">{l.book_count + (l.pdf_count || 0)}</span>
                </button>
              ))}
              {lists.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>No lists yet</div>
              )}

              {pdfTabs.length > 0 && (
                <>
                  <div className="nav-section-label" style={{ marginTop: 12 }}>PDF Tabs</div>
                  {pdfTabs.map(t => (
                    <button
                      key={t.id}
                      className={`nav-item ${view === 'pdftab' && activePdfTabId === t.id ? 'active' : ''}`}
                      onClick={() => { setActivePdfTabId(t.id); setView('pdftab') }}
                    >
                      <span className="nav-icon">📄</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      <span className="nav-badge">{t.doc_count}</span>
                    </button>
                  ))}
                </>
              )}

              <div className="nav-section-label" style={{ marginTop: 12 }}>Smart Shelves</div>
              <button
                className={`nav-item ${view === 'library' && activeShelfId === CONTINUE_SERIES_SHELF_ID ? 'active' : ''}`}
                onClick={() => openShelf(CONTINUE_SERIES_SHELF_ID)}
              >
                <span className="nav-icon">📖</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Continue the Series</span>
                {continueSeriesCount > 0 && <span className="nav-badge">{continueSeriesCount}</span>}
              </button>
              {shelves.map(s => (
                <button
                  key={s.id}
                  className={`nav-item ${view === 'library' && activeShelfId === s.id ? 'active' : ''}`}
                  onClick={() => openShelf(s.id)}
                >
                  <span className="nav-icon">🗂️</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </button>
              ))}
              {shelves.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>
                  Save a filter combo from the Library to create one
                </div>
              )}
            </nav>

            <div className="divider" style={{ margin: '0 16px' }} />

            <nav className="nav-section">
              <button
                className={`nav-item ${view === 'preferences' ? 'active' : ''}`}
                onClick={() => setView('preferences')}
              >
                <span className="nav-icon">⚙️</span>
                Preferences
              </button>
            </nav>

            <div className="sidebar-footer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ScanButton onScanDone={handleScanDone} />
              <button
                className="theme-toggle"
                onClick={toggleTheme}
                title={prefs.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {prefs.theme === 'dark' ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="main-content">
          {view === 'library'     && <Library />}
          {view === 'quotes'      && <Quotes />}
          {view === 'insights'    && <Insights />}
          {view === 'preferences' && <Preferences onSave={refreshPrefs} />}
          {view === 'list' && activeListId && (
            <ReadingList
              listId={activeListId}
              onListDeleted={() => { loadLists(); setView('library'); setActiveListId(null) }}
              onListUpdated={loadLists}
            />
          )}
          {view === 'pdftab' && activePdfTabId && (
            <PdfTab
              tabId={activePdfTabId}
              onTabDeleted={() => { loadPdfTabs(); setView('library'); setActivePdfTabId(null) }}
              onTabUpdated={loadPdfTabs}
            />
          )}
        </main>

        {/* Mobile bottom nav */}
        <nav className="mobile-bottom-nav">
          {[...NAV, { id: 'preferences', icon: '⚙️', label: 'Prefs' }].map(n => (
            <button
              key={n.id}
              className={`mobile-nav-btn ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
          <button className="mobile-nav-btn" onClick={toggleTheme}>
            <span>{prefs.theme === 'dark' ? '☀️' : '🌙'}</span>
            <span>Theme</span>
          </button>
        </nav>
      </div>

      {readerBook && <Reader book={readerBook.book} target={readerBook.target} onClose={closeReader} />}

      {pdfPanes.length === 1 && (
        <PdfReader
          doc={pdfPanes[0].doc}
          target={pdfPanes[0].target}
          onClose={() => closePdfPane(pdfPanes[0].paneId)}
          onOpenAlongside={doc => openPdfReaderAlongside(doc, pdfPanes[0].paneId)}
        />
      )}

      {pdfPanes.length === 2 && (
        <div className="pdf-split-wrap">
          {pdfPanes.map((pane, i) => (
            <div
              key={pane.paneId}
              style={{ display: 'flex', flex: 1, minWidth: 0 }}
              onPointerDown={() => setActivePdfPane(pane.paneId)}
              onMouseEnter={() => setActivePdfPane(pane.paneId)}
            >
              <PdfReader
                doc={pane.doc}
                target={pane.target}
                persistPosition={i === 0}
                active={activePdfPane === pane.paneId}
                onClose={() => closePdfPane(pane.paneId)}
                onOpenAlongside={doc => openPdfReaderAlongside(doc, pane.paneId)}
              />
              {i === 0 && <div className="pdf-split-divider" />}
            </div>
          ))}
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
      <UpdateBanner />
      {updateState.status === 'ready' && !readyModalDismissed && (
        <UpdateNotesModal
          info={updateState.info}
          onInstall={installUpdateNow}
          onLater={() => setReadyModalDismissed(true)}
        />
      )}
    </AppCtx.Provider>
  )
}
