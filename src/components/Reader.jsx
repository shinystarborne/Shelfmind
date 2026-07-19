import { useState, useEffect, useRef, useCallback } from 'react'
import { API, useApp } from '../App'

// ── Reader settings (per-device, localStorage) ────────────────────────────────
const SETTINGS_KEY = 'shelfmind-reader-settings'
const DEFAULT_SETTINGS = {
  theme:      'sepia',    // light | sepia | dark
  fontSize:   18,         // px base
  font:       'book',     // book | serif | sans
  lineHeight: 1.6,
  width:      'medium',   // narrow | medium | wide
  layout:     'auto',     // auto | single | double
}
const WIDTH_PX = { narrow: 560, medium: 700, wide: 880 }
const GAP = 56

const THEMES = {
  light: { bg: '#fbfaf8', fg: '#2c2c2c', soft: '#777',    accent: '#8a6a4f', chrome: 'rgba(251,250,248,0.96)', border: '#e2ddd6' },
  sepia: { bg: '#f4ecd8', fg: '#433422', soft: '#8a7358', accent: '#9c6644', chrome: 'rgba(244,236,216,0.96)', border: '#e0d3b8' },
  dark:  { bg: '#171412', fg: '#d8d0c4', soft: '#8f8578', accent: '#c9a06c', chrome: 'rgba(23,20,18,0.96)',   border: '#3a332c' },
}

const FONTS = {
  book:  null,
  serif: "Georgia, 'Times New Roman', 'Palatino Linotype', serif",
  sans:  "'Segoe UI', system-ui, -apple-system, sans-serif",
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } }
  catch { return { ...DEFAULT_SETTINGS } }
}

// Resolve href relative to a zip-internal file path (mirror of server logic)
function resolvePath(baseFile, href) {
  if (!href) return { path: '', fragment: '' }
  const hashIdx  = href.indexOf('#')
  const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : ''
  let rel = hashIdx >= 0 ? href.slice(0, hashIdx) : href
  try { rel = decodeURIComponent(rel) } catch { /* keep raw */ }
  if (!rel) return { path: baseFile, fragment }
  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : ''
  const parts   = baseDir ? baseDir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return { path: parts.join('/'), fragment }
}

// Books that hardcode pt/px font sizes would ignore the reader's base size —
// rewrite absolute sizes to rem so everything scales with the user setting.
function normalizeFontSizes(idoc) {
  const toRem = (val) => {
    const m = /^([\d.]+)(px|pt)$/.exec((val || '').trim())
    if (!m) return null
    return (parseFloat(m[1]) / (m[2] === 'pt' ? 12 : 16)).toFixed(3) + 'rem'
  }
  for (const sheet of idoc.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }   // inaccessible → skip
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) walk(rule.cssRules)          // @media etc.
        const st = rule.style
        if (!st) continue
        const rem = toRem(st.fontSize)
        if (rem) st.setProperty('font-size', rem, st.getPropertyPriority('font-size'))
      }
    }
    walk(rules)
  }
  idoc.querySelectorAll('[style*="font-size"]').forEach(el => {
    const rem = toRem(el.style.fontSize)
    if (rem) el.style.fontSize = rem
  })
}

export default function Reader({ book, onClose }) {
  const { toast, refreshLibrary } = useApp()
  const [structure, setStructure] = useState(null)
  const [settings, setSettings]   = useState(loadSettings)
  const [tocOpen, setTocOpen]     = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chrome, setChrome]       = useState(true)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  // Position shown in the UI — the source of truth lives in posRef
  const [ui, setUi] = useState({ spine: 0, page: 0, pages: 1, percent: 0 })

  const iframeRef  = useRef(null)
  const stageRef   = useRef(null)
  const posRef     = useRef({ spine: 0, page: 0, pages: 1 })
  const chromeTimer = useRef(null)
  const saveTimer  = useRef(null)
  const structRef  = useRef(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const resURL = useCallback((zipPath) =>
    `${API}/books/${book.id}/epub/res/${zipPath.split('/').map(encodeURIComponent).join('/')}`,
  [book.id])

  // ── Chrome auto-hide ────────────────────────────────────────────────────────
  const pokeChrome = useCallback(() => {
    setChrome(true)
    clearTimeout(chromeTimer.current)
    chromeTimer.current = setTimeout(() => setChrome(false), 3000)
  }, [])

  useEffect(() => {
    pokeChrome()
    return () => clearTimeout(chromeTimer.current)
  }, [pokeChrome])

  // Keep chrome up while a panel is open
  useEffect(() => {
    if (tocOpen || settingsOpen) { setChrome(true); clearTimeout(chromeTimer.current) }
    else pokeChrome()
  }, [tocOpen, settingsOpen, pokeChrome])

  // ── Geometry ────────────────────────────────────────────────────────────────
  const geometry = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const s      = settingsRef.current
    const availW = stage.clientWidth - 120            // room for the side arrows
    const availH = stage.clientHeight - 128           // generous top/bottom margins
    const cols   = s.layout === 'double' ? 2 : s.layout === 'single' ? 1 : (availW >= 1000 ? 2 : 1)
    const maxW   = WIDTH_PX[s.width] * cols + (cols - 1) * GAP
    const V      = Math.max(280, Math.min(availW, maxW))
    const H      = Math.max(200, availH)
    return { V, H, cols, step: V + GAP }
  }, [])

  // ── Percent bookkeeping ─────────────────────────────────────────────────────
  const computePercent = useCallback((spineIdx, page, pages) => {
    const st = structRef.current
    if (!st) return 0
    let before = 0
    for (let i = 0; i < spineIdx; i++) before += st.spine[i].size
    const fracWithin = pages > 0 ? (page + 1) / pages : 1
    return Math.min(100, 100 * (before + fracWithin * (st.spine[spineIdx]?.size || 0)) / st.totalSize)
  }, [])

  const schedulePositionSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const { spine, page, pages } = posRef.current
      const frac    = pages > 1 ? page / (pages - 1) : 0
      const percent = computePercent(spine, page, pages)
      fetch(`${API}/books/${book.id}/position`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ spine, frac, percent }),
      }).catch(() => {})
    }, 900)
  }, [book.id, computePercent])

  // ── Pagination inside the iframe ────────────────────────────────────────────
  const applyPage = useCallback((page, animate = true) => {
    const doc = iframeRef.current?.contentDocument
    const geo = geometry()
    if (!doc?.body || !geo) return
    doc.body.style.transition = animate ? 'transform 0.18s ease-out' : 'none'
    doc.body.style.transform  = `translateX(${-page * geo.step}px)`
  }, [geometry])

  const measurePages = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const geo = geometry()
    if (!doc?.body || !geo) return 1
    return Math.max(1, Math.round((doc.body.scrollWidth + GAP) / geo.step))
  }, [geometry])

  const setPosition = useCallback((spine, page, pages, animate = true) => {
    page = Math.max(0, Math.min(pages - 1, page))
    posRef.current = { spine, page, pages }
    applyPage(page, animate)
    setUi({ spine, page, pages, percent: computePercent(spine, page, pages) })
    schedulePositionSave()
  }, [applyPage, computePercent, schedulePositionSave])

  // ── Chapter loading ─────────────────────────────────────────────────────────
  // target: { frac } | { fragment } | { end: true }
  const loadChapter = useCallback(async (spineIdx, target = { frac: 0 }) => {
    const st = structRef.current
    if (!st || !st.spine[spineIdx]) return
    setLoading(true)
    const chapterPath = st.spine[spineIdx].href
    try {
      const raw = await fetch(resURL(chapterPath)).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })

      // Parse — try strict XHTML first, fall back to forgiving HTML
      let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml')
      if (doc.querySelector('parsererror')) {
        doc = new DOMParser().parseFromString(raw, 'text/html')
      }

      // Rewrite every internal reference to our resource endpoint
      doc.querySelectorAll('link[href]').forEach(el => {
        el.setAttribute('href', resURL(resolvePath(chapterPath, el.getAttribute('href')).path))
        el.setAttribute('crossorigin', 'anonymous')   // lets us rewrite the sheet's cssRules
      })
      doc.querySelectorAll('[src]').forEach(el => {
        const v = el.getAttribute('src')
        if (v && !/^[a-z]+:/i.test(v)) el.setAttribute('src', resURL(resolvePath(chapterPath, v).path))
      })
      doc.querySelectorAll('image').forEach(el => {
        const v = el.getAttribute('xlink:href') || el.getAttribute('href')
        if (v && !/^[a-z]+:/i.test(v)) {
          const u = resURL(resolvePath(chapterPath, v).path)
          el.setAttribute('xlink:href', u)
          el.setAttribute('href', u)
        }
      })
      // Internal links become data attributes we handle ourselves
      doc.querySelectorAll('a[href]').forEach(a => {
        const v = a.getAttribute('href')
        a.removeAttribute('href')
        if (!v) return
        if (/^[a-z]+:/i.test(v)) a.setAttribute('data-sm-external', v)
        else {
          const { path, fragment } = resolvePath(chapterPath, v)
          a.setAttribute('data-sm-link', path + (fragment ? '#' + fragment : ''))
        }
      })

      const s     = settingsRef.current
      const th    = THEMES[s.theme]
      const geo   = geometry()
      const colW  = (geo.V - (geo.cols - 1) * GAP) / geo.cols
      const fontRule = FONTS[s.font]
        ? `body, body p, body div, body li, body td, body blockquote { font-family: ${FONTS[s.font]} !important; }`
        : `body { font-family: Georgia, serif; }`

      const readerCss = `
        html { font-size: ${s.fontSize}px; -webkit-text-size-adjust: none; }
        html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }
        body {
          width: ${geo.V}px; height: ${geo.H}px;
          column-width: ${colW}px; column-gap: ${GAP}px; column-fill: auto;
          overflow: hidden;
          color: ${th.fg} !important;
          text-align: justify;
          hyphens: auto;
        }
        ${fontRule}
        body * { color: ${th.fg} !important; background-color: transparent !important; }
        body p, body li, body blockquote { line-height: ${s.lineHeight} !important; }
        h1, h2, h3, h4, h5, h6 { break-after: avoid; }
        img, svg, video { max-width: 100% !important; max-height: ${geo.H - 8}px !important; height: auto; object-fit: contain; break-inside: avoid; }
        a[data-sm-link] { color: ${th.accent} !important; cursor: pointer; text-decoration: underline; }
        table { max-width: 100%; }
        ::selection { background: ${th.accent}44; }
      `

      const headExtras = [...doc.querySelectorAll('link[rel~="stylesheet" i], style')]
        .map(el => el.outerHTML).join('\n')
      const bodyEl   = doc.body || doc.querySelector('body')
      const bodyHTML = bodyEl ? bodyEl.innerHTML : (doc.documentElement?.outerHTML || raw)
      const bodyCls  = bodyEl?.getAttribute('class') || ''

      const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
        ${headExtras}
        <style>${readerCss}</style>
        </head><body class="${bodyCls}">${bodyHTML}</body></html>`

      const iframe = iframeRef.current
      if (!iframe) return
      iframe.style.width  = `${geo.V}px`
      iframe.style.height = `${geo.H}px`

      iframe.onload = () => {
        const idoc = iframe.contentDocument
        if (!idoc) return

        try { normalizeFontSizes(idoc) } catch { /* never block rendering */ }

        const settle = () => {
          const pages = measurePages()
          let page = 0
          if (target.end)              page = pages - 1
          else if (target.fragment) {
            const el = idoc.getElementById(target.fragment) ||
                       idoc.querySelector(`[name="${CSS.escape(target.fragment)}"]`)
            // Fresh load = no transform yet, so left offset maps directly to a page
            if (el) page = Math.max(0, Math.floor(el.getBoundingClientRect().left / (geometry()?.step || 1)))
          }
          else if (target.frac)        page = Math.round(target.frac * (pages - 1))
          setPosition(spineIdx, page, pages, false)
          setLoading(false)
        }
        settle()

        // Images shift layout as they load — re-measure, keeping the page
        idoc.querySelectorAll('img').forEach(img => {
          if (!img.complete) img.addEventListener('load', () => {
            const pages = measurePages()
            const p = Math.min(posRef.current.page, pages - 1)
            setPosition(posRef.current.spine, p, pages, false)
          }, { once: true })
        })

        // Interactions inside the page
        idoc.addEventListener('mousemove', pokeChrome)
        idoc.addEventListener('click', (e) => {
          const link = e.target.closest?.('a[data-sm-link], a[data-sm-external]')
          if (link) {
            e.preventDefault()
            const ext = link.getAttribute('data-sm-external')
            if (ext) { window.electronAPI?.openExternal(ext); return }
            const [p, frag] = link.getAttribute('data-sm-link').split('#')
            const idx = structRef.current.spine.findIndex(sp => sp.href === p)
            if (idx >= 0) loadChapterRef.current(idx, frag ? { fragment: frag } : { frac: 0 })
            return
          }
          if (idoc.getSelection()?.toString()) return   // selecting text, not turning
          const x = e.clientX / idoc.documentElement.clientWidth
          if (x < 0.22)      turnRef.current(-1)
          else if (x > 0.78) turnRef.current(1)
          else               setChrome(c => !c)
        })
        idoc.addEventListener('keydown', (e) => keyHandlerRef.current(e))
        idoc.addEventListener('wheel', (e) => {
          e.preventDefault()
          if (Math.abs(e.deltaY) > 8) turnRef.current(e.deltaY > 0 ? 1 : -1)
        }, { passive: false })
      }
      iframe.srcdoc = srcdoc
    } catch (err) {
      setLoading(false)
      toast(`Could not load chapter: ${err.message}`, 'error')
    }
  }, [resURL, geometry, measurePages, setPosition, pokeChrome, toast])

  const loadChapterRef = useRef(loadChapter)
  loadChapterRef.current = loadChapter

  // ── Page turning ────────────────────────────────────────────────────────────
  const turn = useCallback((dir) => {
    const st = structRef.current
    if (!st) return
    const { spine, page, pages } = posRef.current
    if (dir > 0) {
      if (page < pages - 1) setPosition(spine, page + 1, pages)
      else if (spine < st.spine.length - 1) loadChapterRef.current(spine + 1, { frac: 0 })
    } else {
      if (page > 0) setPosition(spine, page - 1, pages)
      else if (spine > 0) loadChapterRef.current(spine - 1, { end: true })
    }
  }, [setPosition])
  const turnRef = useRef(turn)
  turnRef.current = turn

  // ── Keyboard ────────────────────────────────────────────────────────────────
  const handleKey = useCallback((e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turnRef.current(1) }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key))      { e.preventDefault(); turnRef.current(-1) }
    else if (e.key === 'Escape') {
      if (settingsOpen)      setSettingsOpen(false)
      else if (tocOpen)      setTocOpen(false)
      else                   closeRef.current()
    }
  }, [settingsOpen, tocOpen])
  const keyHandlerRef = useRef(handleKey)
  keyHandlerRef.current = handleKey

  useEffect(() => {
    const h = (e) => keyHandlerRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Close (flush position first) ────────────────────────────────────────────
  const close = useCallback(() => {
    clearTimeout(saveTimer.current)
    const { spine, page, pages } = posRef.current
    if (structRef.current) {
      const frac    = pages > 1 ? page / (pages - 1) : 0
      const percent = computePercent(spine, page, pages)
      fetch(`${API}/books/${book.id}/position`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ spine, frac, percent }),
      }).catch(() => {}).finally(() => refreshLibrary())
    }
    onClose()
  }, [book.id, computePercent, onClose, refreshLibrary])
  const closeRef = useRef(close)
  closeRef.current = close

  // ── Boot: structure + saved position ────────────────────────────────────────
  // The position is fetched fresh from the server — the book object passed in
  // may be a stale snapshot from a drawer opened before the last reading session.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`${API}/books/${book.id}/epub/structure`).then(r => { if (!r.ok) throw new Error('structure failed'); return r.json() }),
      fetch(`${API}/books/${book.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([st, fresh]) => {
        if (!alive) return
        if (!st.spine?.length) throw new Error('No readable chapters found')
        structRef.current = st
        setStructure(st)
        const pos = fresh?.reading_position || book.reading_position
        const spine = pos && pos.spine < st.spine.length ? pos.spine : 0
        loadChapterRef.current(spine, { frac: pos?.frac || 0 })
      })
      .catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [book.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // If the app quits or reloads mid-read, flush the position synchronously
  useEffect(() => {
    const flush = () => {
      if (!structRef.current) return
      const { spine, page, pages } = posRef.current
      fetch(`${API}/books/${book.id}/position`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          spine,
          frac:    pages > 1 ? page / (pages - 1) : 0,
          percent: computePercent(spine, page, pages),
        }),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [book.id, computePercent])

  // ── Re-render chapter when settings or window size change ───────────────────
  useEffect(() => {
    if (!structRef.current) return
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    const { spine, page, pages } = posRef.current
    loadChapterRef.current(spine, { frac: pages > 1 ? page / (pages - 1) : 0 })
  }, [settings])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let t
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (!structRef.current) return
        const { spine, page, pages } = posRef.current
        loadChapterRef.current(spine, { frac: pages > 1 ? page / (pages - 1) : 0 })
      }, 200)
    }
    window.addEventListener('resize', onResize)
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize) }
  }, [])

  // ── Seek via progress slider ────────────────────────────────────────────────
  const seekTo = useCallback((pct) => {
    const st = structRef.current
    if (!st) return
    const targetBytes = (pct / 100) * st.totalSize
    let cum = 0
    for (let i = 0; i < st.spine.length; i++) {
      const size = st.spine[i].size
      if (cum + size >= targetBytes || i === st.spine.length - 1) {
        loadChapterRef.current(i, { frac: size > 0 ? Math.min(1, (targetBytes - cum) / size) : 0 })
        return
      }
      cum += size
    }
  }, [])

  // ── Current chapter label from TOC ──────────────────────────────────────────
  const currentChapterLabel = (() => {
    if (!structure) return ''
    const href = structure.spine[ui.spine]?.href
    let label = ''
    const hunt = (nodes) => {
      for (const n of nodes || []) {
        if (n.href === href) label = n.label
        hunt(n.children)
      }
    }
    hunt(structure.toc)
    return label
  })()

  const th = THEMES[settings.theme]

  // ── TOC panel ───────────────────────────────────────────────────────────────
  const renderToc = (nodes, depth = 0) => (nodes || []).map((n, i) => {
    const idx    = structure.spine.findIndex(sp => sp.href === n.href)
    const active = idx === ui.spine
    return (
      <div key={`${depth}-${i}`}>
        <button
          className={`reader-toc-item ${active ? 'active' : ''}`}
          style={{ paddingLeft: 16 + depth * 16 }}
          onClick={() => {
            if (idx >= 0) loadChapterRef.current(idx, n.fragment ? { fragment: n.fragment } : { frac: 0 })
            setTocOpen(false)
          }}
        >
          {n.label}
        </button>
        {renderToc(n.children, depth + 1)}
      </div>
    )
  })

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))

  if (error) {
    return (
      <div className="reader theme-sepia" style={{ '--r-bg': THEMES.sepia.bg, '--r-fg': THEMES.sepia.fg }}>
        <div className="reader-error">
          <div style={{ fontSize: 40 }}>😔</div>
          <div>Couldn't open this book</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{error}</div>
          <button className="btn btn-secondary" onClick={onClose}>Back to library</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`reader theme-${settings.theme} ${chrome ? 'chrome-visible' : ''}`}
      style={{
        '--r-bg': th.bg, '--r-fg': th.fg, '--r-soft': th.soft,
        '--r-accent': th.accent, '--r-chrome': th.chrome, '--r-border': th.border,
      }}
      onMouseMove={pokeChrome}
    >
      {/* Top bar */}
      <div className="reader-topbar">
        <button className="reader-icon-btn" onClick={close} title="Back to library (Esc)">←</button>
        <div className="reader-book-title">
          <span className="reader-title-main">{book.title}</span>
          {currentChapterLabel && <span className="reader-title-chapter"> · {currentChapterLabel}</span>}
        </div>
        <div className="reader-topbar-actions">
          <button
            className={`reader-icon-btn ${tocOpen ? 'active' : ''}`}
            onClick={() => { setTocOpen(o => !o); setSettingsOpen(false) }}
            title="Table of contents"
          >☰</button>
          <button
            className={`reader-icon-btn reader-aa ${settingsOpen ? 'active' : ''}`}
            onClick={() => { setSettingsOpen(o => !o); setTocOpen(false) }}
            title="Reading settings"
          >Aa</button>
        </div>
      </div>

      {/* Stage */}
      <div className="reader-stage" ref={stageRef}>
        <button className="reader-arrow reader-arrow-left" onClick={() => turn(-1)} title="Previous page">‹</button>
        <div className="reader-page">
          <iframe
            ref={iframeRef}
            className="reader-frame"
            title="book"
            sandbox="allow-same-origin"
          />
          {loading && <div className="reader-loading"><span className="spin">↻</span></div>}
        </div>
        <button className="reader-arrow reader-arrow-right" onClick={() => turn(1)} title="Next page">›</button>
      </div>

      {/* Bottom bar */}
      <div className="reader-bottombar">
        <span className="reader-progress-label">
          {ui.pages > 1 ? `${ui.page + 1} / ${ui.pages}` : ''}
        </span>
        <input
          type="range"
          className="reader-slider"
          min="0" max="100" step="0.1"
          value={ui.percent}
          onChange={e => seekTo(parseFloat(e.target.value))}
        />
        <span className="reader-progress-label reader-progress-pct">
          {ui.percent >= 1 ? `${Math.round(ui.percent)}%` : ui.percent > 0 ? '<1%' : '0%'}
        </span>
      </div>

      {/* TOC panel */}
      {tocOpen && (
        <>
          <div className="reader-panel-dismiss" onClick={() => setTocOpen(false)} />
          <div className="reader-toc">
            <div className="reader-panel-title">Contents</div>
            <div className="reader-toc-list">
              {structure?.toc?.length
                ? renderToc(structure.toc)
                : structure?.spine.map((sp, i) => (
                    <button
                      key={sp.href}
                      className={`reader-toc-item ${i === ui.spine ? 'active' : ''}`}
                      onClick={() => { loadChapterRef.current(i, { frac: 0 }); setTocOpen(false) }}
                    >
                      Section {i + 1}
                    </button>
                  ))}
            </div>
          </div>
        </>
      )}

      {/* Settings flyout */}
      {settingsOpen && (
        <>
          <div className="reader-panel-dismiss" onClick={() => setSettingsOpen(false)} />
          <div className="reader-settings">
            <div className="reader-panel-title">Reading settings</div>

            <div className="reader-setting-label">Theme</div>
            <div className="reader-theme-row">
              {Object.entries(THEMES).map(([key, t]) => (
                <button
                  key={key}
                  className={`reader-theme-swatch ${settings.theme === key ? 'active' : ''}`}
                  style={{ background: t.bg, color: t.fg }}
                  onClick={() => set('theme', key)}
                  title={key}
                >Aa</button>
              ))}
            </div>

            <div className="reader-setting-label">Font size</div>
            <div className="reader-stepper">
              <button onClick={() => set('fontSize', Math.max(13, settings.fontSize - 1))}>−</button>
              <span>{settings.fontSize}px</span>
              <button onClick={() => set('fontSize', Math.min(28, settings.fontSize + 1))}>+</button>
            </div>

            <div className="reader-setting-label">Font</div>
            <div className="reader-seg">
              {[['book', 'Book'], ['serif', 'Serif'], ['sans', 'Sans']].map(([v, l]) => (
                <button key={v} className={settings.font === v ? 'active' : ''} onClick={() => set('font', v)}>{l}</button>
              ))}
            </div>

            <div className="reader-setting-label">Line spacing</div>
            <div className="reader-stepper">
              <button onClick={() => set('lineHeight', Math.max(1.2, +(settings.lineHeight - 0.1).toFixed(1)))}>−</button>
              <span>{settings.lineHeight.toFixed(1)}</span>
              <button onClick={() => set('lineHeight', Math.min(2.2, +(settings.lineHeight + 0.1).toFixed(1)))}>+</button>
            </div>

            <div className="reader-setting-label">Page width</div>
            <div className="reader-seg">
              {[['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']].map(([v, l]) => (
                <button key={v} className={settings.width === v ? 'active' : ''} onClick={() => set('width', v)}>{l}</button>
              ))}
            </div>

            <div className="reader-setting-label">Columns</div>
            <div className="reader-seg">
              {[['auto', 'Auto'], ['single', 'One'], ['double', 'Two']].map(([v, l]) => (
                <button key={v} className={settings.layout === v ? 'active' : ''} onClick={() => set('layout', v)}>{l}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
