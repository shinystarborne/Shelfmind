import { useState, useEffect, useRef } from 'react'
import { API, useApp } from '../App'
import LibraryImportModal from '../components/LibraryImportModal'

// ── Import / Export section ───────────────────────────────────────────────────
function ImportExportSection({ toast }) {
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef(null)

  const doExport = () => {
    const a = document.createElement('a')
    a.href = `${API}/export/storygraph`
    a.download = 'shelfmind-storygraph.csv'
    a.click()
  }

  const doImport = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { toast('Select a CSV file first'); return }
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const res = await fetch(`${API}/import/storygraph`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      }).then(r => r.json())
      setImportResult(res)
      toast(`Import done: ${res.matched} matched, ${res.unmatched} unmatched`, 'success')
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="prefs-section">
      <h3>📤 Import / Export</h3>

      <div className="pref-row">
        <div className="pref-label">Export to StoryGraph</div>
        <div className="pref-hint">Download your library as a StoryGraph-compatible CSV file.</div>
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={doExport}>
          ⬇️ Export CSV
        </button>
      </div>

      <div className="pref-row" style={{ marginTop: 8 }}>
        <div className="pref-label">Import from StoryGraph</div>
        <div className="pref-hint">
          Upload a StoryGraph export CSV. Matches books by title + author and imports status, rating, tags, and finish date.
        </div>
        <div className="import-row">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="pref-input"
          />
          <button
            className="btn btn-secondary"
            onClick={doImport}
            disabled={importing}
          >
            {importing ? <span className="spin">↻</span> : '⬆️'} Import
          </button>
        </div>
        {importResult && (
          <div style={{ fontSize: 12, marginTop: 8, color: 'var(--sage-dark)' }}>
            ✓ {importResult.matched} books matched and updated · {importResult.unmatched} unmatched out of {importResult.total} total
          </div>
        )}
      </div>
    </div>
  )
}

function UpdaterSection() {
  const [version, setVersion]     = useState('')
  const [status, setStatus]       = useState('idle')
  const [updateInfo, setUpdateInfo] = useState(null)
  const [progress, setProgress]   = useState(0)
  const [errorMsg, setErrorMsg]   = useState('')

  const api = window.electronAPI

  useEffect(() => {
    if (!api) return
    api.getAppVersion().then(setVersion)
    api.onUpdateAvailable(info  => { setUpdateInfo(info); setStatus('available') })
    api.onUpdateNotAvailable(()  => setStatus('up-to-date'))
    api.onUpdateProgress(p       => { setProgress(Math.round(p.percent)); setStatus('downloading') })
    api.onUpdateDownloaded(info  => { setUpdateInfo(info); setStatus('ready') })
    api.onUpdateError(msg        => { setErrorMsg(msg); setStatus('error') })
    return () => api.removeUpdateListeners()
  }, [])

  if (!api) return null

  const check = async () => {
    setStatus('checking')
    setErrorMsg('')
    try {
      await api.checkForUpdates()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message?.includes('packaged') ? 'Updates only work in the installed app, not dev mode.' : err.message)
    }
  }

  return (
    <div className="prefs-section">
      <h3>⬆️ Updates</h3>
      <div className="pref-row" style={{ marginBottom: 16 }}>
        <div className="pref-label">Current version</div>
        <div className="pref-hint">v{version}</div>
      </div>

      {status === 'idle' && (
        <button className="btn btn-secondary" onClick={check}>Check for Updates</button>
      )}
      {status === 'checking' && (
        <p style={{ fontSize: 13, color: 'var(--text-soft)' }}>
          <span className="spin">↻</span> Checking…
        </p>
      )}
      {status === 'up-to-date' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--sage-dark)', marginBottom: 8 }}>✓ You're on the latest version.</p>
          <button className="btn btn-secondary" onClick={check}>Check Again</button>
        </div>
      )}
      {status === 'available' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 8 }}>
            v{updateInfo?.version} is available.
          </p>
          <button className="btn btn-primary" onClick={() => { api.downloadUpdate(); setStatus('downloading') }}>
            Download Update
          </button>
        </div>
      )}
      {status === 'downloading' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 8 }}>Downloading… {progress}%</p>
          <div className="enrich-bar">
            <div className="enrich-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {status === 'ready' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--sage-dark)', marginBottom: 8 }}>
            v{updateInfo?.version} downloaded and ready to install.
          </p>
          <button className="btn btn-primary" onClick={() => api.installUpdate()}>
            Restart &amp; Install
          </button>
        </div>
      )}
      {status === 'error' && (
        <div>
          <p style={{ fontSize: 13, color: '#c0392b', marginBottom: 8 }}>
            {errorMsg || 'Update check failed.'}
          </p>
          <button className="btn btn-secondary" onClick={check}>Try Again</button>
        </div>
      )}
    </div>
  )
}

export default function Preferences({ onSave }) {
  const { toast } = useApp()
  const [prefs, setPrefs] = useState({})
  const [qr, setQr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [enrichState, setEnrichState] = useState({ running: false, done: false })
  const [showLibImport, setShowLibImport] = useState(false)

  useEffect(() => {
    fetch(`${API}/preferences`).then(r => r.json()).then(setPrefs)
  }, [])

  const set = (key, val) => setPrefs(p => ({ ...p, [key]: val }))

  const save = async () => {
    setSaving(true)
    await fetch(`${API}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    setSaving(false)
    toast('Preferences saved', 'success')
    onSave?.()
  }

  const loadQr = async () => {
    const data = await fetch(`${API}/qr`).then(r => r.json()).catch(() => null)
    setQr(data)
  }

  const enrichAll = async () => {
    if (enrichState.running) return
    setEnrichState({ running: true, done: false, current: 0, total: 0 })
    await fetch(`${API}/enrich/all`, { method: 'POST' })

    const poll = setInterval(async () => {
      const s = await fetch(`${API}/enrich/status`).then(r => r.json())
      setEnrichState(s)
      if (s.done || !s.running) clearInterval(poll)
    }, 1200)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="topbar">
        <div className="topbar-title">Preferences</div>
      </div>

      <div className="prefs-body">
        {/* Library */}
        <div className="prefs-section">
          <h3>📚 Library</h3>
          <div className="pref-row">
            <div className="pref-label">Library Path</div>
            <div className="pref-hint">The folder ShelfMind scans for your ebook files</div>
            <input
              className="pref-input"
              value={prefs.library_path || ''}
              onChange={e => set('library_path', e.target.value)}
              placeholder="E:\Books"
            />
          </div>
        </div>

        {/* Kindle */}
        <div className="prefs-section">
          <h3>📱 Kindle</h3>
          <div className="pref-row">
            <div className="pref-label">Kindle Email</div>
            <div className="pref-hint">Your @kindle.com email address (optional — enables email delivery mode)</div>
            <input
              className="pref-input"
              type="email"
              value={prefs.kindle_email || ''}
              onChange={e => set('kindle_email', e.target.value)}
              placeholder="yourname@kindle.com"
            />
          </div>
          <div className="pref-row">
            <div className="pref-label">Default Delivery Mode</div>
            <div className="pref-radio-group">
              {[
                { value: 'web',   label: '🌐 Send to Kindle Web' },
                { value: 'email', label: '✉️ Email Attachment' },
              ].map(opt => (
                <label key={opt.value} className={`pref-radio ${prefs.kindle_mode === opt.value ? 'active' : ''}`}>
                  <input
                    type="radio"
                    checked={prefs.kindle_mode === opt.value}
                    onChange={() => set('kindle_mode', opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="prefs-section">
          <h3>🎨 Appearance</h3>
          <div className="pref-row">
            <div className="pref-label">Default View</div>
            <div className="pref-radio-group">
              {[
                { value: 'grid', label: '▦ Grid' },
                { value: 'list', label: '☰ List' },
              ].map(opt => (
                <label key={opt.value} className={`pref-radio ${prefs.default_view === opt.value ? 'active' : ''}`}>
                  <input
                    type="radio"
                    checked={prefs.default_view === opt.value}
                    onChange={() => set('default_view', opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="prefs-section">
          <h3>🔍 Metadata Enrichment</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Fetch genres, canonical author names, and descriptions from{' '}
            <strong>Open Library</strong> for all un-enriched books.
            Rate-limited to 1 request/second — runs in the background.
          </p>
          {enrichState.running && (
            <div className="enrich-banner" style={{ marginBottom: 12, borderRadius: 8 }}>
              <span className="spin">↻</span>
              <span>Enriching… {enrichState.current}/{enrichState.total}</span>
              <div className="enrich-bar">
                <div
                  className="enrich-bar-fill"
                  style={{ width: enrichState.total > 0 ? `${(enrichState.current / enrichState.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}
          {enrichState.done && (
            <p style={{ fontSize: 12, color: 'var(--sage-dark)', marginBottom: 12 }}>
              ✓ Done! {enrichState.success}/{enrichState.total} books enriched.
            </p>
          )}
          <button
            className="btn btn-secondary"
            onClick={enrichAll}
            disabled={enrichState.running}
          >
            {enrichState.running ? <span className="spin">↻</span> : '🔍'} Enrich All Books
          </button>
        </div>

        {/* Library MD Import */}
        <div className="prefs-section">
          <h3>📖 Library Metadata Import</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Update titles, authors, series, and genres from{' '}
            <strong>library_series_genres.md</strong> in your library folder.
            Matches books by title + author and shows a preview before writing anything.
          </p>
          <button className="btn btn-secondary" onClick={() => setShowLibImport(true)}>
            🔍 Preview &amp; Apply Changes
          </button>
        </div>

        {showLibImport && (
          <LibraryImportModal
            toast={toast}
            onClose={() => setShowLibImport(false)}
          />
        )}

        {/* Import / Export */}
        <ImportExportSection toast={toast} />

        {/* Updates */}
        <UpdaterSection />

        {/* Mobile / QR */}
        <div className="prefs-section">
          <h3>📲 Mobile Access</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Open ShelfMind on any device on your local network by scanning the QR code.
          </p>
          {!qr ? (
            <button className="btn btn-secondary" onClick={loadQr}>Generate QR Code</button>
          ) : (
            <div className="qr-wrap">
              <img src={qr.qr} alt="QR code" width={120} height={120} />
              <div>
                <div className="qr-url">{qr.url}</div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  Scan with your phone's camera. Works on the same Wi-Fi network.
                </p>
              </div>
            </div>
          )}
        </div>

        <div style={{ height: 32 }} />
      </div>

      {/* Sticky save footer */}
      <div style={{
        padding: '12px 32px',
        borderTop: '1px solid var(--border)',
        background: 'var(--cream)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '…' : 'Save Changes'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Changes take effect immediately
        </span>
      </div>
    </div>
  )
}
