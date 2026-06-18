import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import Library from './views/Library'
import Insights from './views/Insights'
import Preferences from './views/Preferences'

// When loaded in Electron (file://) hostname is empty — fall back to localhost.
// When opened in a browser via QR code the hostname is the LAN IP, so API calls go to the right machine.
const API_HOST = window.location.hostname || 'localhost'
// Default to 3001; Electron updates this dynamically if port was bumped.
export let API = `http://${API_HOST}:3001/api`

// ── Global context ────────────────────────────────────────────────────────────
export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// ── Toast system ──────────────────────────────────────────────────────────────
function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type || ''}`}>{t.msg}</div>
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

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'library',  icon: '📚', label: 'Library' },
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

  const toast = useCallback((msg, type = '') => {
    const id = Date.now()
    setToasts(ts => [...ts, { id, msg, type }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3500)
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
      }).catch(() => {})
      fetch(`${API}/books`).then(r => r.json()).then(b => setBookCount(b.length)).catch(() => {})
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
  }, [toast])

  const refreshPrefs = () => fetch(`${API}/preferences`).then(r => r.json()).then(setPrefs)

  return (
    <AppCtx.Provider value={{ toast, prefs, refreshPrefs, toggleTheme, refreshLibrary, setRefreshLibrary }}>
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
                  className={`nav-item ${view === n.id ? 'active' : ''}`}
                  onClick={() => setView(n.id)}
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
          {view === 'insights'    && <Insights />}
          {view === 'preferences' && <Preferences onSave={refreshPrefs} />}
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

      <Toasts toasts={toasts} />
    </AppCtx.Provider>
  )
}
