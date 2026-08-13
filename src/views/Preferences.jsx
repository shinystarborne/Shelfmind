import { useState, useEffect, useRef } from 'react'
import { API, useApp } from '../App'
import LibraryImportModal from '../components/LibraryImportModal'
import { formatFileSize } from '../components/BookCard'
import { applyPalette, syncTitlebar } from '../lib/theme'

// Color palettes — token definitions live in src/index.css ("Color Palettes").
// swatches: [light bg, light accent, dark bg, dark accent] preview dots.
const PALETTES = [
  { id: 'rose',     name: 'Rose',     swatches: ['#fdf6f0', '#c97b84', '#1c1410', '#c97b84'] },
  { id: 'ocean',    name: 'Ocean',    swatches: ['#f4f7f9', '#4a7ba6', '#10161d', '#6ba3cc'] },
  { id: 'forest',   name: 'Forest',   swatches: ['#f6f6ef', '#5e8a4e', '#11150f', '#8ab86e'] },
  { id: 'lavender', name: 'Lavender', swatches: ['#f8f6fa', '#8a6aae', '#141118', '#b294d4'] },
]

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

// ── Backup & Restore ──────────────────────────────────────────────────────────
function BackupSection() {
  const { toast } = useApp()
  const [restoring, setRestoring]   = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const fileInputRef = useRef(null)

  const doBackup = () => {
    const a = document.createElement('a')
    a.href = `${API}/backup`
    a.download = `shelfmind-backup-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
  }

  const onFileChosen = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file later
    if (!file) return
    setPendingFile(file)
    setConfirming(true)
  }

  const doRestore = async () => {
    if (!pendingFile) return
    setConfirming(false)
    setRestoring(true)
    try {
      const buf = await pendingFile.arrayBuffer()
      const res = await fetch(`${API}/backup/restore`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/zip' },
        body:    buf,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Restore failed')
      toast('Backup restored — restart ShelfMind for the changes to take effect', 'success')
    } catch (err) {
      toast(err.message || 'Restore failed', 'error')
    } finally {
      setRestoring(false)
      setPendingFile(null)
    }
  }

  return (
    <div className="prefs-section">
      <h3>💾 Backup &amp; Restore</h3>
      <div className="pref-row" style={{ marginBottom: 16 }}>
        <div className="pref-label">Back up your library data</div>
        <div className="pref-hint">
          Downloads a zip of your reading status, notes, highlights, tags, lists, and cached covers/search text —
          not the ebook files themselves, just ShelfMind's own data.
        </div>
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={doBackup}>
          ⬇️ Download Backup
        </button>
      </div>

      <div className="pref-row">
        <div className="pref-label">Restore from a backup</div>
        <div className="pref-hint">
          Overwrites your current reading status, notes, and covers with what's in the zip. Your library folder and
          ebook files are untouched.
        </div>
        <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onFileChosen} />
        {confirming ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', marginTop: 4 }}>
            <div style={{ fontSize: 13, color: '#c04040', fontWeight: 700 }}>
              Restore "{pendingFile?.name}"? This overwrites your current data.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ color: '#c04040' }} onClick={doRestore}>Yes, restore</button>
              <button className="btn btn-ghost" onClick={() => { setConfirming(false); setPendingFile(null) }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-secondary"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
          >
            {restoring ? <span className="spin">↻</span> : '📂'} Restore from Backup…
          </button>
        )}
      </div>
    </div>
  )
}

// ── PDF Tabs management ───────────────────────────────────────────────────────
function PdfTabsSection() {
  const { toast, loadPdfTabs, nudgeLibrary } = useApp()
  const [tabs, setTabs]         = useState([])
  const [newName, setNewName]   = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [drafts, setDrafts]     = useState({})
  const [confirmId, setConfirmId] = useState(null)

  const load = () => fetch(`${API}/pdf-tabs`).then(r => r.json()).then(setTabs).catch(() => {})
  useEffect(() => { load() }, [])

  const refresh = () => { load(); loadPdfTabs() }

  const pickFolder = async () => {
    if (!window.electronAPI?.pickFolder) return null
    return await window.electronAPI.pickFolder()
  }

  // Import new PDFs from a tab's folder right after it's set/changed
  const scanTabFolder = async (tab) => {
    const r = await fetch(`${API}/pdf-tabs/${tab.id}/scan-folder`, { method: 'POST' })
    const result = await r.json().catch(() => ({}))
    if (!r.ok) { toast(result.error || 'Folder scan failed', 'error'); return }
    toast(result.added
      ? `"${tab.name}": found ${result.found} PDF${result.found !== 1 ? 's' : ''} — added ${result.added} new`
      : `"${tab.name}": no new PDFs (${result.found} found, all already in this tab)`,
      result.added ? 'success' : '')
    if (result.added > 0) nudgeLibrary({ index: true })
  }

  const createTab = async () => {
    const name   = newName.trim()
    const folder = newFolder.trim()
    if (!name) return
    const r = await fetch(`${API}/pdf-tabs`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, folder_path: folder }),
    })
    const tab = await r.json().catch(() => ({}))
    if (!r.ok) { toast(tab.error || 'Could not create tab', 'error'); return }
    setNewName('')
    setNewFolder('')
    toast(`Tab "${name}" created`, 'success')
    refresh()
    if (folder) scanTabFolder(tab)
  }

  const setTabFolder = async (tab, folder) => {
    const r = await fetch(`${API}/pdf-tabs/${tab.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ folder_path: folder }),
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      toast(err.error || 'Could not save folder', 'error')
      return
    }
    refresh()
    if (folder) scanTabFolder(tab)
  }

  const browseTabFolder = async (tab) => {
    const folder = await pickFolder()
    if (folder) setTabFolder(tab, folder)
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
        Each tab can point at its own folder (kept separate from your ebooks), and new PDFs in that
        folder are picked up automatically by the library scan.
      </p>

      {tabs.map(tab => (
        <div key={tab.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <span
              style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={tab.folder_path || undefined}
            >
              {tab.folder_path ? `📂 ${tab.folder_path}` : 'No folder linked'}
            </span>
            {window.electronAPI?.pickFolder && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title="Choose the folder this tab imports PDFs from"
                onClick={() => browseTabFolder(tab)}
              >📂 {tab.folder_path ? 'Change…' : 'Choose folder…'}</button>
            )}
            {tab.folder_path && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title="Unlink the folder (imported PDFs stay in the tab)"
                onClick={() => setTabFolder(tab, '')}
              >✕ Clear</button>
            )}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: tabs.length ? 12 : 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="pref-input"
            style={{ flex: 1, marginBottom: 0 }}
            placeholder="PDF folder for this tab (optional) — e.g. D:\\PDFs"
            value={newFolder}
            onChange={e => setNewFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createTab() }}
          />
          {window.electronAPI?.pickFolder && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              onClick={async () => { const f = await pickFolder(); if (f) setNewFolder(f) }}
            >📂 Browse…</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Keyboard shortcuts reference ──────────────────────────────────────────────
function ShortcutsSection() {
  const groups = [
    {
      title: 'EPUB Reader',
      rows: [
        [['→', '↓', 'Space', 'PgDn'], 'Next page'],
        [['←', '↑', 'PgUp'], 'Previous page'],
        [['Ctrl+F'], 'Search in book'],
        [['Esc'], 'Close panel / back'],
      ],
    },
    {
      title: 'PDF Viewer',
      rows: [
        [['Ctrl+F'], 'Search in this PDF'],
        [['→', '↓', 'Space', 'PgDn'], 'Next page (swipe mode)'],
        [['←', '↑', 'PgUp'], 'Previous page (swipe mode)'],
        [['+', '='], 'Zoom in'],
        [['-'], 'Zoom out'],
        [['0'], 'Fit width (Fit page in swipe mode)'],
        [['Ctrl+Scroll'], 'Zoom in/out'],
        [['Esc'], 'Close panel / back'],
      ],
    },
    {
      title: 'Audiobook Player',
      rows: [
        [['Space'], 'Play / pause'],
        [['←'], 'Back 15 seconds'],
        [['→'], 'Forward 15 seconds'],
      ],
    },
  ]

  return (
    <div className="prefs-section">
      <h3>⌨️ Keyboard Shortcuts</h3>
      <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
        Shortcuts active while reading a book or PDF. Also available from the ⓘ button in the reader's topbar.
        Shortcuts are ignored while typing in a text field (e.g. a note or the search box).
      </p>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {groups.map(g => (
          <div key={g.title} style={{ minWidth: 220 }}>
            <div className="pref-shortcut-group-title">{g.title}</div>
            {g.rows.map(([keys, label], i) => (
              <div className="pref-shortcut-row" key={i}>
                <div className="pref-shortcut-keys">
                  {keys.map((k, j) => (
                    <span key={j}>
                      {j > 0 && <span className="pref-shortcut-or">/</span>}
                      <kbd className="pref-kbd">{k}</kbd>
                    </span>
                  ))}
                </div>
                <div className="pref-shortcut-label">{label}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const isPrerelease = (v) => !!v && v.includes('-')

function UpdaterSection() {
  const { updateState, checkForUpdate, downloadUpdate, installUpdateNow } = useApp()
  const { status, info: updateInfo, progress, error: errorMsg } = updateState
  const [version, setVersion]     = useState('')
  const [betaUpdates, setBetaUpdates] = useState(false)

  const api = window.electronAPI

  useEffect(() => {
    if (!api) return
    api.getAppVersion().then(setVersion)
    fetch(`${API}/preferences`).then(r => r.json()).then(p => setBetaUpdates(!!p.beta_updates)).catch(() => {})
  }, [])

  if (!api) return null

  const toggleBeta = async (checked) => {
    setBetaUpdates(checked)
    await fetch(`${API}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beta_updates: checked }),
    })
  }

  const check = () => checkForUpdate(betaUpdates)

  const friendlyError = (msg) => {
    if (!msg) return 'Update check failed.'
    if (msg.includes('No published versions') || msg.includes('Unable to find latest') || msg.includes('Cannot parse')) {
      return 'No valid release found on GitHub. Make sure the release is published (not a draft) and was built with "npm run release".'
    }
    if (msg.includes('latest.yml')) {
      return 'Release is missing update metadata. Publish using "npm run release" so latest.yml is included.'
    }
    if (msg.includes('packaged') || msg.includes('packed')) {
      return 'Updates only work in the installed app, not dev mode.'
    }
    return 'Update check failed.'
  }

  return (
    <div className="prefs-section">
      <h3>⬆️ Updates</h3>
      <div className="pref-row" style={{ marginBottom: 16 }}>
        <div className="pref-label">Current version</div>
        <div className="pref-hint">v{version}{isPrerelease(version) ? ' (beta)' : ''}</div>
      </div>

      <div className="pref-row" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={betaUpdates}
            onChange={e => toggleBeta(e.target.checked)}
            style={{ accentColor: 'var(--rose)' }}
          />
          <span className="pref-label" style={{ margin: 0 }}>Include beta releases</span>
        </label>
        <div className="pref-hint">
          Get early access to new features before they're stable. Uncheck this and check again to move back to the latest stable release.
        </div>
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
            {!isPrerelease(updateInfo?.version) && isPrerelease(version)
              ? `v${updateInfo?.version} (stable) is available — this will move you back off the beta channel.`
              : `v${updateInfo?.version}${isPrerelease(updateInfo?.version) ? ' (beta)' : ''} is available.`}
          </p>
          <button className="btn btn-primary" onClick={downloadUpdate}>
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
          <button className="btn btn-primary" onClick={installUpdateNow}>
            Restart &amp; Install
          </button>
        </div>
      )}
      {status === 'error' && (
        <div>
          <p style={{ fontSize: 13, color: '#c0392b', marginBottom: 8 }}>
            {friendlyError(errorMsg)}
          </p>
          <button className="btn btn-secondary" onClick={check}>Try Again</button>
        </div>
      )}
    </div>
  )
}

const PREFS_TABS = [
  { id: 'general',       icon: '⚙️', label: 'General' },
  { id: 'library-tools', icon: '🛠️', label: 'Library Tools' },
  { id: 'data',          icon: '📦', label: 'Data' },
  { id: 'updates',       icon: '⬆️', label: 'Updates' },
]

export default function Preferences({ onSave }) {
  const { toast } = useApp()
  const [tab, setTab] = useState('general')
  const [prefs, setPrefs] = useState({})
  const [qr, setQr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [enrichState, setEnrichState] = useState({ running: false, done: false })
  const [indexState, setIndexState]   = useState({ running: false, done: false })
  const [moodState, setMoodState]     = useState({ running: false, done: false })
  const [showLibImport, setShowLibImport] = useState(false)
  const enrichPollRef = useRef(null)
  const indexPollRef  = useRef(null)
  const moodPollRef   = useRef(null)

  useEffect(() => {
    fetch(`${API}/preferences`).then(r => r.json()).then(setPrefs)
  }, [])

  // Pick up a job already running (started from here or from the Library banner)
  useEffect(() => {
    fetch(`${API}/enrich/status`).then(r => r.json()).then(s => { if (s.running) { setEnrichState(s); startEnrichPoll() } }).catch(() => {})
    fetch(`${API}/search-index/status`).then(r => r.json()).then(s => { if (s.running) { setIndexState(s); startIndexPoll() } }).catch(() => {})
    fetch(`${API}/mood/status`).then(r => r.json()).then(s => { if (s.running) { setMoodState(s); startMoodPoll() } }).catch(() => {})
    return () => { clearInterval(enrichPollRef.current); clearInterval(indexPollRef.current); clearInterval(moodPollRef.current) }
  }, [])

  const set = (key, val) => setPrefs(p => ({ ...p, [key]: val }))

  // Palette applies live (attribute + titlebar); persisted on Save like the rest.
  const selectPalette = (id) => {
    set('palette', id)
    applyPalette(id)
    syncTitlebar(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  }

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

  const startEnrichPoll = () => {
    if (enrichPollRef.current) return
    enrichPollRef.current = setInterval(async () => {
      const s = await fetch(`${API}/enrich/status`).then(r => r.json()).catch(() => null)
      if (!s) return
      setEnrichState(s)
      if (s.done || !s.running) { clearInterval(enrichPollRef.current); enrichPollRef.current = null }
    }, 1200)
  }

  const enrichAll = async () => {
    if (enrichState.running) return
    setEnrichState({ running: true, done: false, current: 0, total: 0 })
    await fetch(`${API}/enrich/all`, { method: 'POST' })
    startEnrichPoll()
  }

  const startIndexPoll = () => {
    if (indexPollRef.current) return
    indexPollRef.current = setInterval(async () => {
      const s = await fetch(`${API}/search-index/status`).then(r => r.json()).catch(() => null)
      if (!s) return
      setIndexState(s)
      if (s.done || !s.running) { clearInterval(indexPollRef.current); indexPollRef.current = null }
    }, 1200)
  }

  const buildIndex = async () => {
    if (indexState.running) return
    setIndexState({ running: true, done: false, current: 0, total: 0 })
    await fetch(`${API}/search-index/all`, { method: 'POST' })
    startIndexPoll()
  }

  const startMoodPoll = () => {
    if (moodPollRef.current) return
    moodPollRef.current = setInterval(async () => {
      const s = await fetch(`${API}/mood/status`).then(r => r.json()).catch(() => null)
      if (!s) return
      setMoodState(s)
      if (s.done || !s.running) { clearInterval(moodPollRef.current); moodPollRef.current = null }
    }, 1200)
  }

  const profileAllMoods = async () => {
    if (moodState.running) return
    // Save first so the run uses exactly what's typed in the fields above —
    // otherwise an unsaved model/key edit is silently ignored by the server.
    await fetch(`${API}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    })
    setMoodState({ running: true, done: false, current: 0, total: 0 })
    await fetch(`${API}/mood/profile-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    startMoodPoll()
  }

  const stopMoodProfiling = async () => {
    await fetch(`${API}/mood/profile-stop`, { method: 'POST' }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="topbar">
        <div className="topbar-title">Preferences</div>
      </div>

      <div className="prefs-tabs">
        {PREFS_TABS.map(t => (
          <button
            key={t.id}
            className={`prefs-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="prefs-body">
      {tab === 'general' && (<>
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

        {/* Appearance */}
        <div className="prefs-section">
          <h3>🎨 Appearance</h3>
          <div className="pref-row">
            <div className="pref-label">Color Palette</div>
            <div className="pref-hint">Applies to both light and dark mode — each palette has its own dark variant</div>
            <div className="palette-grid">
              {PALETTES.map(p => (
                <button
                  key={p.id}
                  className={`palette-card ${(prefs.palette || 'rose') === p.id ? 'active' : ''}`}
                  onClick={() => selectPalette(p.id)}
                >
                  <span className="palette-swatches">
                    {p.swatches.map((c, i) => <span key={i} style={{ background: c }} />)}
                  </span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
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

        {/* Keyboard shortcuts */}
        <ShortcutsSection />
      </>)}

      {tab === 'library-tools' && (<>
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

        {/* Search index */}
        <div className="prefs-section">
          <h3>🔎 Search Index</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Extract and index the full text of your books and PDFs, so the Library's
            search can find matches inside them, not just in titles and authors.
          </p>
          {indexState.running && (
            <div className="enrich-banner" style={{ marginBottom: 12, borderRadius: 8 }}>
              <span className="spin">↻</span>
              <span>Indexing… {indexState.current}/{indexState.total}</span>
              <div className="enrich-bar">
                <div
                  className="enrich-bar-fill"
                  style={{ width: indexState.total > 0 ? `${(indexState.current / indexState.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}
          {indexState.done && (
            <p style={{ fontSize: 12, color: 'var(--sage-dark)', marginBottom: 12 }}>
              ✓ Done! {indexState.success}/{indexState.total} indexed.
            </p>
          )}
          <button
            className="btn btn-secondary"
            onClick={buildIndex}
            disabled={indexState.running}
          >
            {indexState.running ? <span className="spin">↻</span> : '🔎'} Build Search Index
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

        {/* PDF Tabs */}
        <PdfTabsSection />

        {/* Removed files cleanup */}
        <RemovedFolderSection />

        {/* Audiobookshelf */}
        <div className="prefs-section">
          <h3>🎧 Audiobookshelf</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Connect your self-hosted <strong>Audiobookshelf</strong> server to show an
            Audiobooks shelf in the sidebar. Leave empty to hide it.
          </p>
          <div className="pref-row">
            <div className="pref-label">Server URL</div>
            <div className="pref-hint">The address of your Audiobookshelf server</div>
            <input
              className="pref-input"
              value={prefs.abs_url || ''}
              onChange={e => set('abs_url', e.target.value)}
              placeholder="http://192.168.1.10:13378"
            />
          </div>
          <div className="pref-row">
            <div className="pref-label">API Token</div>
            <div className="pref-hint">Audiobookshelf → Settings → Users → your user → API token</div>
            <input
              className="pref-input"
              type="password"
              value={prefs.abs_token || ''}
              onChange={e => set('abs_token', e.target.value)}
              placeholder="eyJhbGciOi…"
            />
          </div>
        </div>

        {/* AI (Mood Suggestions) */}
        <div className="prefs-section">
          <h3>🔮 AI (Mood Suggestions)</h3>
          <p style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 16, lineHeight: 1.6 }}>
            Powers the <strong>Mood</strong> view: an AI model (via{' '}
            <strong>OpenRouter</strong>, bring your own key) reads each book's metadata
            plus a short excerpt and writes mood tags + a profile, so it can later
            suggest what matches your mood. Audiobooks are profiled from metadata only.
            Runs in the background; only unprofiled books are sent unless you force a re-run.
          </p>
          <div className="pref-row">
            <div className="pref-label">OpenRouter API Key</div>
            <div className="pref-hint">openrouter.ai → Keys. Stored locally in prefs.json (plaintext, like the ABS token). Not needed if you use a local LLM below.</div>
            <input
              className="pref-input"
              type="password"
              value={prefs.openrouter_key || ''}
              onChange={e => set('openrouter_key', e.target.value)}
              placeholder="sk-or-…"
            />
          </div>
          <div className="pref-row">
            <div className="pref-label">Local LLM URL (optional)</div>
            <div className="pref-hint">
              Any OpenAI-compatible server — LM Studio: http://localhost:1234/v1 · Ollama: http://localhost:11434/v1.
              When set, requests go here instead of OpenRouter and no API key is needed.
            </div>
            <input
              className="pref-input"
              value={prefs.llm_base_url || ''}
              onChange={e => set('llm_base_url', e.target.value)}
              placeholder="http://localhost:1234/v1"
            />
          </div>
          <div className="pref-row">
            <div className="pref-label">Cloudflare Access service token (optional)</div>
            <div className="pref-hint">
              Only if your LLM server is behind Cloudflare Zero Trust: Zero Trust dashboard → Access → Service Auth → Service Tokens.
              Without these, requests hit the Cloudflare login page instead of your server.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="pref-input"
                type="password"
                value={prefs.llm_cf_client_id || ''}
                onChange={e => set('llm_cf_client_id', e.target.value)}
                placeholder="CF-Access-Client-Id"
              />
              <input
                className="pref-input"
                type="password"
                value={prefs.llm_cf_client_secret || ''}
                onChange={e => set('llm_cf_client_secret', e.target.value)}
                placeholder="CF-Access-Client-Secret"
              />
            </div>
          </div>
          <div className="pref-row">
            <div className="pref-label">Model</div>
            <div className="pref-hint">Any OpenRouter model id — the default is cheap and good enough for mood profiling</div>
            <input
              className="pref-input"
              value={prefs.openrouter_model || ''}
              onChange={e => set('openrouter_model', e.target.value)}
              placeholder="google/gemma-3-27b-it"
            />
          </div>
          <div className="pref-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!prefs.openrouter_web_search}
                onChange={e => set('openrouter_web_search', e.target.checked)}
              />
              Let the AI search the web while profiling
            </label>
            <div className="pref-hint">
              Helps with obscure books the model doesn't know — but adds roughly $4–5 per full library pass. Off by default.
            </div>
          </div>
          {moodState.running && (
            <div className="enrich-banner" style={{ marginBottom: 12, borderRadius: 8 }}>
              <span className="spin">↻</span>
              <span>Profiling… {moodState.current}/{moodState.total}</span>
              <div className="enrich-bar">
                <div
                  className="enrich-bar-fill"
                  style={{ width: moodState.total > 0 ? `${(moodState.current / moodState.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}
          {moodState.done && (
            <p style={{ fontSize: 12, color: 'var(--sage-dark)', marginBottom: 12 }}>
              ✓ Done! {moodState.success}/{moodState.total} profiled
              {moodState.failed > 0 ? ` — ${moodState.failed} failed (retried next run)` : ''}.
            </p>
          )}
          <div className="pref-hint" style={{ marginBottom: 8 }}>
            Runs with model: <strong>{prefs.openrouter_model || 'google/gemma-3-27b-it'}</strong>
            {prefs.llm_base_url ? ` via ${prefs.llm_base_url}` : ' via OpenRouter'} — fields above are saved automatically when the run starts.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={profileAllMoods}
              disabled={moodState.running || !(prefs.openrouter_key || prefs.llm_base_url)}
              title={!(prefs.openrouter_key || prefs.llm_base_url) ? 'Add an OpenRouter API key or a local LLM URL first' : ''}
            >
              {moodState.running ? <span className="spin">↻</span> : '🔮'} Profile All Books
            </button>
            {moodState.running && (
              <button className="btn btn-secondary" onClick={stopMoodProfiling}>
                ■ Stop
              </button>
            )}
          </div>
          {moodState.log?.length > 0 && (
            <div className="mood-log" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
              {moodState.log.map((entry, i) => (
                <div key={i} className="mood-log-line">{entry.msg}</div>
              ))}
            </div>
          )}
        </div>
      </>)}

      {tab === 'data' && (<>
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

        {/* Export */}
        <ExportSection />

        {/* Backup & Restore */}
        <BackupSection />
      </>)}

      {tab === 'updates' && (<>
        {/* Updates */}
        <UpdaterSection />
      </>)}

      {showLibImport && (
        <LibraryImportModal
          toast={toast}
          onClose={() => setShowLibImport(false)}
        />
      )}

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
