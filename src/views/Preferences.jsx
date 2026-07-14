import { useState, useEffect } from 'react'
import { API, useApp } from '../App'
import LibraryImportModal from '../components/LibraryImportModal'
import { formatFileSize } from '../components/BookCard'

// ── _Removed folder cleanup ───────────────────────────────────────────────────
function RemovedFolderSection() {
  const { toast } = useApp()
  const [stats, setStats]     = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [emptying, setEmptying]     = useState(false)

  const load = () => fetch(`${API}/removed-folder`).then(r => r.json()).then(setStats).catch(() => setStats(null))
  useEffect(() => { load() }, [])

  const empty = async () => {
    setEmptying(true)
    try {
      const res = await fetch(`${API}/removed-folder/empty`, { method: 'POST' }).then(r => r.json())
      if (res.deleted) {
        toast(`Permanently deleted ${res.deleted} file${res.deleted !== 1 ? 's' : ''} (${formatFileSize(res.freedBytes)} freed)`, 'success')
      } else {
        toast('Nothing to delete')
      }
      for (const err of res.errors || []) toast(err, 'error')
      load()
    } catch {
      toast('Could not empty the _Removed folder', 'error')
    } finally {
      setEmptying(false)
      setConfirming(false)
    }
  }

  return (
    <div className="prefs-section">
      <h3>🗑️ Removed Files</h3>
      <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
        Books and duplicate copies you've removed are moved to a <code style={{ fontSize: 12 }}>_Removed</code> folder
        inside your library — nothing is deleted until you empty it here.
      </p>
      {stats && (
        <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16 }}>
          {stats.fileCount === 0
            ? '_Removed is empty.'
            : <>{stats.fileCount} file{stats.fileCount !== 1 ? 's' : ''} · {formatFileSize(stats.totalSize)}</>}
        </p>
      )}
      {confirming ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 13, color: '#c04040', fontWeight: 700 }}>
            Permanently delete {stats?.fileCount} file{stats?.fileCount !== 1 ? 's' : ''}? This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ color: '#c04040' }} onClick={empty} disabled={emptying}>
              {emptying ? <span className="spin">↻</span> : '🗑️'} Yes, delete permanently
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={emptying}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-secondary"
          style={{ color: '#c04040' }}
          onClick={() => setConfirming(true)}
          disabled={!stats || stats.fileCount === 0}
        >
          🗑️ Empty _Removed Folder
        </button>
      )}
    </div>
  )
}

// ── Export section ────────────────────────────────────────────────────────────
function ExportSection() {
  const doExport = () => {
    const a = document.createElement('a')
    a.href = `${API}/export/storygraph`
    a.download = 'shelfmind-storygraph.csv'
    a.click()
  }

  return (
    <div className="prefs-section">
      <h3>📤 Export</h3>
      <div className="pref-row">
        <div className="pref-label">Export to StoryGraph</div>
        <div className="pref-hint">Download your library as a StoryGraph-compatible CSV file.</div>
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={doExport}>
          ⬇️ Export CSV
        </button>
      </div>
    </div>
  )
}

// ── PDF Tabs management ───────────────────────────────────────────────────────
function PdfTabsSection() {
  const { toast, loadPdfTabs } = useApp()
  const [tabs, setTabs]         = useState([])
  const [newName, setNewName]   = useState('')
  const [drafts, setDrafts]     = useState({})
  const [confirmId, setConfirmId] = useState(null)

  const load = () => fetch(`${API}/pdf-tabs`).then(r => r.json()).then(setTabs).catch(() => {})
  useEffect(() => { load() }, [])

  const refresh = () => { load(); loadPdfTabs() }

  const createTab = async () => {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    await fetch(`${API}/pdf-tabs`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    })
    toast(`Tab "${name}" created`, 'success')
    refresh()
  }

  const renameTab = async (tab) => {
    const name = (drafts[tab.id] ?? '').trim()
    setDrafts(d => { const { [tab.id]: _, ...rest } = d; return rest })
    if (!name || name === tab.name) return
    await fetch(`${API}/pdf-tabs/${tab.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    })
    refresh()
  }

  const deleteTab = async (tab) => {
    setConfirmId(null)
    await fetch(`${API}/pdf-tabs/${tab.id}`, { method: 'DELETE' })
    toast(`Tab "${tab.name}" deleted`, 'success')
    refresh()
  }

  return (
    <div className="prefs-section">
      <h3>📄 PDF Tabs</h3>
      <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
        Create tabs to organise your PDF documents — they show up in the sidebar.
        Each tab holds its own set of PDFs with tags and notes.
      </p>

      {tabs.map(tab => (
        <div key={tab.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            className="pref-input"
            style={{ flex: 1, marginBottom: 0 }}
            value={drafts[tab.id] ?? tab.name}
            onChange={e => setDrafts(d => ({ ...d, [tab.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') renameTab(tab) }}
            onBlur={() => { if (tab.id in drafts) renameTab(tab) }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {tab.doc_count} PDF{tab.doc_count !== 1 ? 's' : ''}
          </span>
          {confirmId === tab.id ? (
            <>
              <button className="btn btn-ghost" style={{ color: '#c04040', fontSize: 12 }} onClick={() => deleteTab(tab)}>Delete?</button>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmId(null)}>✕</button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              style={{ color: '#c04040', fontSize: 12 }}
              title="Delete tab (files stay on disk)"
              onClick={() => setConfirmId(tab.id)}
            >🗑️</button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: tabs.length ? 12 : 0 }}>
        <input
          className="pref-input"
          style={{ flex: 1, marginBottom: 0 }}
          placeholder="New tab name (e.g. Sheet Music, Manuals)…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') createTab() }}
        />
        <button className="btn btn-secondary" onClick={createTab} disabled={!newName.trim()}>+ Create Tab</button>
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
      const msg = err.message || ''
      if (msg.includes('No published versions') || msg.includes('Unable to find latest') || msg.includes('Cannot parse')) {
        setStatus('error')
        setErrorMsg('No valid release found on GitHub. Make sure the release is published (not a draft) and was built with "npm run release".')
      } else if (msg.includes('latest.yml')) {
        setStatus('error')
        setErrorMsg('Release is missing update metadata. Publish using "npm run release" so latest.yml is included.')
      } else if (msg.includes('packaged') || msg.includes('packed')) {
        setStatus('error')
        setErrorMsg('Updates only work in the installed app, not dev mode.')
      } else {
        setStatus('error')
        setErrorMsg('Update check failed.')
        console.error('[updater]', msg)
      }
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

        {/* PDF Tabs */}
        <PdfTabsSection />

        {/* Removed files cleanup */}
        <RemovedFolderSection />

        {/* Export */}
        <ExportSection />

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
