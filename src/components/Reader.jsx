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

// ── Highlights ────────────────────────────────────────────────────────────────
export const HL_COLORS = {
  yellow: 'rgba(240, 195, 60, 0.45)',
  green:  'rgba(125, 195, 125, 0.45)',
  pink:   'rgba(240, 135, 165, 0.42)',
  blue:   'rgba(115, 175, 240, 0.42)',
}

// Absolute character offsets of a selection Range within root's textContent
function rangeToOffsets(root, range) {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0, start = -1, end = -1
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n === range.startContainer) start = acc + range.startOffset
    if (n === range.endContainer)   end   = acc + range.endOffset
    acc += n.nodeValue.length
  }
  if (start < 0 || end <= start) return null
  return { start, end }
}

// Wraps [start, end) of root's textContent in <mark class="{className}"> elements,
// splitting across text nodes as needed. Returns the created mark(s) (usually one,
// more if the range spans multiple nodes).
function wrapRange(doc, root, start, end, className) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets = []
  let acc = 0
  while (walker.nextNode()) {
    const n   = walker.currentNode
    const len = n.nodeValue.length
    if (acc + len > start && acc < end) {
      targets.push({ n, from: Math.max(0, start - acc), to: Math.min(len, end - acc) })
    }
    acc += len
    if (acc >= end) break
  }
  const marks = []
  for (const t of targets) {
    let node = t.n
    if (t.to < node.nodeValue.length) node.splitText(t.to)
    if (t.from > 0) node = node.splitText(t.from)
    const mark = doc.createElement('mark')
    mark.className = className
    node.parentNode.insertBefore(mark, node)
    mark.appendChild(node)
    marks.push(mark)
  }
  return marks
}

function unwrapMarks(doc, selector) {
  doc.querySelectorAll(selector).forEach(mark => {
    const parent = mark.parentNode
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

// Wrap [start, end) of the chapter text in <mark> elements. Re-anchors by
// searching for the stored text if the offsets no longer line up (book updated).
function applyHighlight(doc, h) {
  const root = doc.body
  const full = root.textContent
  let { start, end } = h
  if (full.slice(start, end) !== h.text) {
    const idx = full.indexOf(h.text)
    if (idx < 0) return false
    start = idx
    end   = idx + h.text.length
  }
  const marks = wrapRange(doc, root, start, end, 'sm-hl')
  for (const mark of marks) {
    mark.dataset.hid = h.id
    mark.style.setProperty('background-color', HL_COLORS[h.color] || HL_COLORS.yellow, 'important')
    if (h.note) mark.title = h.note
  }
  return marks.length > 0
}

function removeHighlightMarks(doc, hid) {
  unwrapMarks(doc, `mark.sm-hl[data-hid="${hid}"]`)
}

// Same re-anchoring strategy as applyHighlight (trust text over a numeric
// offset — server-side and browser-side HTML-to-text derivations don't
// necessarily agree on offsets), but for an ephemeral, non-persisted match
// (search results, not saved highlights). Returns the flashed mark's bounding
// rect for pagination, or null if the text genuinely can't be found anymore.
function locateAndFlash(idoc, offset, matchText) {
  if (!matchText) return null
  const root = idoc.body
  const full = root.textContent
  let start = offset
  if (full.slice(offset, offset + matchText.length).toLowerCase() !== matchText.toLowerCase()) {
    const idx = full.toLowerCase().indexOf(matchText.toLowerCase())
    if (idx < 0) return null
    start = idx
  }
  const end = start + matchText.length
  unwrapMarks(idoc, 'mark.sm-search-hit')
  const marks = wrapRange(idoc, root, start, end, 'sm-search-hit')
  if (marks.length === 0) return null
  setTimeout(() => { try { unwrapMarks(idoc, 'mark.sm-search-hit') } catch { /* iframe gone */ } }, 2500)
  return marks[0].getBoundingClientRect()
}

// CSS absolute-size keywords, as a ratio of "medium" (the spec-defined scale
// browsers use — medium == 1x, large == 1.2x, etc).
const KEYWORD_FONT_RATIOS = {
  'xx-small': 3 / 5, 'x-small': 3 / 4, small: 8 / 9, medium: 1,
  large: 6 / 5, 'x-large': 3 / 2, 'xx-large': 2, 'xxx-large': 3,
}

// Books that hardcode pt/px font sizes (or CSS absolute-size keywords like
// "large") would ignore the reader's base size — rewrite them to rem so
// everything scales with the user setting.
function normalizeFontSizes(idoc) {
  const toRem = (val) => {
    const v = (val || '').trim().toLowerCase()
    const m = /^([\d.]+)(px|pt)$/.exec(v)
    if (m) return (parseFloat(m[1]) / (m[2] === 'pt' ? 12 : 16)).toFixed(3) + 'rem'
    if (v in KEYWORD_FONT_RATIOS) return KEYWORD_FONT_RATIOS[v].toFixed(3) + 'rem'
    return null
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

export default function Reader({ book, target, onClose }) {
  const { toast, refreshLibrary } = useApp()
  const [structure, setStructure] = useState(null)
  const [settings, setSettings]   = useState(loadSettings)
  const [tocOpen, setTocOpen]     = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [chrome, setChrome]       = useState(true)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  // Position shown in the UI — the source of truth lives in posRef
  const [ui, setUi] = useState({ spine: 0, page: 0, pages: 1, percent: 0 })
  // Floating toolbars: over a fresh selection / over an existing highlight
  const [selBar, setSelBar]   = useState(null)   // { x, y, sel: {start, end, text} }
  const [markBar, setMarkBar] = useState(null)   // { x, y, hid }
  const [noteEditor, setNoteEditor] = useState(null)   // { hid, x, y, text }
  // In-book search — declared here (not down by the rest of the search logic)
  // because handleKey's useCallback deps reference searchOpen below, and a
  // dependency array is evaluated synchronously during render: referencing a
  // useState binding before its own declaration statement has run throws a
  // TDZ ReferenceError, unlike refs dereferenced lazily inside a callback body.
  const [searchOpen, setSearchOpen]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState('')
  const [searchChapters, setSearchChapters] = useState(null)
  const [searchHits, setSearchHits]         = useState([])
  const [searchIdx, setSearchIdx]           = useState(0)
  const hlRef = useRef([])                       // this book's highlights

  const iframeRef  = useRef(null)
  const stageRef   = useRef(null)
  const posRef     = useRef({ spine: 0, page: 0, pages: 1 })
  const chromeTimer = useRef(null)
  const saveTimer  = useRef(null)
  const structRef  = useRef(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const resURL = useCallback((zipPath) =>
    `${API}/books/${book.id}/reader/res/${zipPath.split('/').map(encodeURIComponent).join('/')}`,
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
    if (tocOpen || settingsOpen || shortcutsOpen) { setChrome(true); clearTimeout(chromeTimer.current) }
    else pokeChrome()
  }, [tocOpen, settingsOpen, shortcutsOpen, pokeChrome])

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
    setSelBar(null)
    setMarkBar(null)
    setNoteEditor(null)
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
        body * { color: ${th.fg} !important; }
        body *:not(.sm-hl):not(.sm-search-hit) { background-color: transparent !important; }
        mark.sm-hl { color: inherit !important; padding: 0 1px; border-radius: 2px; cursor: pointer; }
        mark.sm-search-hit {
          color: inherit !important;
          padding: 0;
          border-radius: 2px;
          animation: sm-search-flash 2.5s ease-out;
        }
        @keyframes sm-search-flash {
          0%   { background-color: rgba(255, 140, 0, 0.85); }
          70%  { background-color: rgba(255, 140, 0, 0.55); }
          100% { background-color: rgba(255, 140, 0, 0); }
        }
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

        // Paint saved highlights before measuring (marks are inline, layout-safe)
        for (const h of hlRef.current) {
          if (h.spine === spineIdx) { try { applyHighlight(idoc, h) } catch { /* skip */ } }
        }

        const step = () => geometry()?.step || 1
        const settle = () => {
          const pages = measurePages()
          let page = 0
          if (target.end)              page = pages - 1
          else if (target.fragment) {
            const el = idoc.getElementById(target.fragment) ||
                       idoc.querySelector(`[name="${CSS.escape(target.fragment)}"]`)
            // Fresh load = no transform yet, so left offset maps directly to a page
            if (el) page = Math.max(0, Math.floor(el.getBoundingClientRect().left / step()))
          }
          else if (target.highlight) {
            const el = idoc.querySelector(`mark.sm-hl[data-hid="${target.highlight}"]`)
            if (el) page = Math.max(0, Math.floor(el.getBoundingClientRect().left / step()))
          }
          else if (target.textOffset != null) {
            const rect = locateAndFlash(idoc, target.textOffset, target.matchText || '')
            if (rect) page = Math.max(0, Math.floor(rect.left / step()))
            else toast("Couldn't locate this match exactly", 'error')
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

        // Selecting text → floating highlight toolbar (positioned in parent coords)
        idoc.addEventListener('mouseup', () => {
          setTimeout(() => {
            const sel = idoc.getSelection()
            const text = sel?.toString() || ''
            if (!text.trim() || sel.rangeCount === 0) { setSelBar(null); return }
            const range = sel.getRangeAt(0)
            let off = rangeToOffsets(idoc.body, range)
            if (!off) {
              const idx = idoc.body.textContent.indexOf(text)
              if (idx < 0) return
              off = { start: idx, end: idx + text.length }
            }
            // Trim whitespace off the edges so stored offsets match trimmed text
            let { start, end } = off
            const full = idoc.body.textContent
            while (start < end && /\s/.test(full[start]))   start++
            while (end > start && /\s/.test(full[end - 1])) end--
            if (start >= end) return
            const rect  = range.getBoundingClientRect()
            const irect = iframe.getBoundingClientRect()
            setMarkBar(null)
            setSelBar({
              x: irect.left + rect.left + rect.width / 2,
              y: irect.top + rect.top,
              sel: { start, end, text: full.slice(start, end) },
            })
          }, 10)
        })

        idoc.addEventListener('click', (e) => {
          const mark = e.target.closest?.('mark.sm-hl')
          if (mark) {
            const irect = iframe.getBoundingClientRect()
            setSelBar(null)
            setMarkBar({ x: irect.left + e.clientX, y: irect.top + e.clientY, hid: mark.dataset.hid })
            return
          }
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
          setMarkBar(null)
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
    setSelBar(null)
    setMarkBar(null)
    setNoteEditor(null)
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearchRef.current() }
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turnRef.current(1) }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key))      { e.preventDefault(); turnRef.current(-1) }
    else if (e.key === 'Escape') {
      if (searchOpen)         closeSearchRef.current()
      else if (settingsOpen)  setSettingsOpen(false)
      else if (shortcutsOpen) setShortcutsOpen(false)
      else if (tocOpen)       setTocOpen(false)
      else                    closeRef.current()
    }
  }, [settingsOpen, shortcutsOpen, tocOpen, searchOpen])
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
      fetch(`${API}/books/${book.id}/reader/structure`).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || 'Could not open this book')
        return r.json()
      }),
      fetch(`${API}/books/${book.id}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/books/${book.id}/highlights`).then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([st, fresh, highlights]) => {
        if (!alive) return
        if (!st.spine?.length) throw new Error('No readable chapters found')
        structRef.current = st
        hlRef.current = highlights
        setStructure(st)
        // A jump target (from the Quotes view, or a search result) wins over the saved position
        if (target?.hid != null && target.spine < st.spine.length) {
          loadChapterRef.current(target.spine, { highlight: target.hid })
          return
        }
        if (target?.textOffset != null && target.spine < st.spine.length) {
          loadChapterRef.current(target.spine, { textOffset: target.textOffset, matchText: target.matchText })
          return
        }
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

  // ── Create / remove highlights ──────────────────────────────────────────────
  const createHighlight = useCallback(async (color) => {
    if (!selBar?.sel) return
    const { spine } = posRef.current
    const payload = { spine, ...selBar.sel, color }
    setSelBar(null)
    try {
      const h = await fetch(`${API}/books/${book.id}/highlights`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }).then(r => { if (!r.ok) throw new Error('save failed'); return r.json() })
      hlRef.current.push(h)
      const idoc = iframeRef.current?.contentDocument
      if (idoc) {
        applyHighlight(idoc, h)
        idoc.getSelection()?.removeAllRanges()
      }
    } catch {
      toast('Could not save highlight', 'error')
    }
  }, [book.id, selBar, toast])

  const deleteHighlight = useCallback(async (hid) => {
    setMarkBar(null)
    try {
      await fetch(`${API}/books/${book.id}/highlights/${hid}`, { method: 'DELETE' })
      hlRef.current = hlRef.current.filter(h => h.id !== hid)
      const idoc = iframeRef.current?.contentDocument
      if (idoc) removeHighlightMarks(idoc, hid)
    } catch {
      toast('Could not remove highlight', 'error')
    }
  }, [book.id, toast])

  const saveNote = useCallback(async (hid, note) => {
    try {
      const h = await fetch(`${API}/books/${book.id}/highlights/${hid}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note }),
      }).then(r => { if (!r.ok) throw new Error('save failed'); return r.json() })
      hlRef.current = hlRef.current.map(x => x.id === hid ? h : x)
      const mark = iframeRef.current?.contentDocument?.querySelector(`mark.sm-hl[data-hid="${hid}"]`)
      if (mark) mark.title = h.note || ''
      toast('Note saved')
    } catch {
      toast('Could not save note', 'error')
    }
  }, [book.id, toast])

  const copyHighlight = useCallback((hid) => {
    const h = hlRef.current.find(x => x.id === hid)
    if (h) { navigator.clipboard.writeText(h.text.replace(/\s+/g, ' ').trim()); toast('Quote copied') }
    setMarkBar(null)
  }, [toast])

  // ── In-book search ("find in this book only") ───────────────────────────────
  // searchChapters: null = not fetched yet, [] = fetched but empty/unsupported.
  const openSearch = useCallback(async () => {
    setSearchOpen(true)
    setSelBar(null); setMarkBar(null); setNoteEditor(null)
    if (searchChapters) return
    try {
      const data = await fetch(`${API}/books/${book.id}/search-text`).then(r => {
        if (!r.ok) throw new Error('unsupported')
        return r.json()
      })
      setSearchChapters(data.chapters || [])
    } catch {
      setSearchChapters([])
    }
  }, [book.id, searchChapters])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    const idoc = iframeRef.current?.contentDocument
    if (idoc) unwrapMarks(idoc, 'mark.sm-search-hit')
  }, [])

  const openSearchRef  = useRef(openSearch)
  openSearchRef.current  = openSearch
  const closeSearchRef = useRef(closeSearch)
  closeSearchRef.current = closeSearch

  // Recompute matches whenever the query or the (lazily-fetched) chapter text changes
  useEffect(() => {
    if (!searchOpen || !searchChapters) { setSearchHits([]); return }
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) { setSearchHits([]); return }
    const hits = []
    for (const ch of searchChapters) {
      const text = ch.text || ''
      if (!text) continue
      const lower = text.toLowerCase()
      let idx = lower.indexOf(q)
      while (idx !== -1) {
        hits.push({ spine: ch.spine, offset: idx, matchText: text.slice(idx, idx + q.length) })
        idx = lower.indexOf(q, idx + q.length)
      }
    }
    setSearchHits(hits)
    setSearchIdx(0)
  }, [searchQuery, searchOpen, searchChapters])

  const jumpToTextOffset = useCallback((spineIdx, offset, matchText) => {
    if (spineIdx !== posRef.current.spine) {
      loadChapterRef.current(spineIdx, { textOffset: offset, matchText })
      return
    }
    const idoc = iframeRef.current?.contentDocument
    if (!idoc) return
    const rect = locateAndFlash(idoc, offset, matchText)
    if (!rect) { toast("Couldn't locate this match exactly", 'error'); return }
    const geo = geometry()
    const page = Math.max(0, Math.floor(rect.left / (geo?.step || 1)))
    setPosition(posRef.current.spine, page, posRef.current.pages, true)
  }, [geometry, setPosition, toast])

  // Jump to the current hit whenever it changes (typing, prev/next, or Enter)
  useEffect(() => {
    if (!searchOpen || searchHits.length === 0) return
    const hit = searchHits[searchIdx]
    if (hit) jumpToTextOffset(hit.spine, hit.offset, hit.matchText)
  }, [searchIdx, searchHits, searchOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  const searchNext = useCallback(() => {
    setSearchIdx(i => searchHits.length ? (i + 1) % searchHits.length : 0)
  }, [searchHits.length])

  const searchPrev = useCallback(() => {
    setSearchIdx(i => searchHits.length ? (i - 1 + searchHits.length) % searchHits.length : 0)
  }, [searchHits.length])

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
            className={`reader-icon-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            title="Search in this book (Ctrl+F)"
          >🔎</button>
          <button
            className={`reader-icon-btn ${tocOpen ? 'active' : ''}`}
            onClick={() => { setTocOpen(o => !o); setSettingsOpen(false); setShortcutsOpen(false) }}
            title="Table of contents"
          >☰</button>
          <button
            className={`reader-icon-btn reader-aa ${settingsOpen ? 'active' : ''}`}
            onClick={() => { setSettingsOpen(o => !o); setTocOpen(false); setShortcutsOpen(false) }}
            title="Reading settings"
          >Aa</button>
          <button
            className={`reader-icon-btn ${shortcutsOpen ? 'active' : ''}`}
            onClick={() => { setShortcutsOpen(o => !o); setTocOpen(false); setSettingsOpen(false) }}
            title="Keyboard shortcuts"
          >ⓘ</button>
        </div>
      </div>

      {/* In-book search bar */}
      {searchOpen && (
        <div className="reader-searchbar">
          <input
            autoFocus
            className="reader-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={searchChapters === null ? 'Loading book text…' : 'Search this book…'}
            disabled={searchChapters === null}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
              else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) searchPrev(); else searchNext() }
            }}
          />
          <span className="reader-search-count">
            {searchQuery.trim().length < 2 ? '' : searchHits.length === 0 ? '0 / 0' : `${searchIdx + 1} / ${searchHits.length}`}
          </span>
          <button className="reader-icon-btn" onClick={searchPrev} disabled={searchHits.length === 0} title="Previous match">▲</button>
          <button className="reader-icon-btn" onClick={searchNext} disabled={searchHits.length === 0} title="Next match">▼</button>
          <button className="reader-icon-btn" onClick={closeSearch} title="Close search">✕</button>
        </div>
      )}

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

      {/* Highlight toolbar over a fresh selection */}
      {selBar && (
        <div
          className="reader-selbar"
          style={{ left: Math.max(90, Math.min(window.innerWidth - 90, selBar.x)), top: Math.max(52, selBar.y - 46) }}
        >
          {Object.entries(HL_COLORS).map(([name, c]) => (
            <button
              key={name}
              className="reader-hl-dot"
              style={{ background: c.replace(/[\d.]+\)$/, '0.9)') }}
              title={`Highlight ${name}`}
              onClick={() => createHighlight(name)}
            />
          ))}
          <button
            className="reader-hl-copy"
            title="Copy selection"
            onClick={() => { navigator.clipboard.writeText(selBar.sel.text.replace(/\s+/g, ' ').trim()); toast('Copied'); setSelBar(null) }}
          >📋</button>
        </div>
      )}

      {/* Actions over an existing highlight */}
      {markBar && (() => {
        const h = hlRef.current.find(x => x.id === markBar.hid)
        return (
          <div
            className="reader-selbar"
            style={{ left: Math.max(90, Math.min(window.innerWidth - 90, markBar.x)), top: Math.max(52, markBar.y - 46) }}
          >
            <button className="reader-hl-copy" onClick={() => copyHighlight(markBar.hid)}>📋 Copy</button>
            <button
              className="reader-hl-copy"
              onClick={() => {
                setNoteEditor({ hid: markBar.hid, x: markBar.x, y: markBar.y, text: h?.note || '' })
                setMarkBar(null)
              }}
            >📝 {h?.note ? 'Edit note' : 'Add note'}</button>
            <button className="reader-hl-copy" onClick={() => deleteHighlight(markBar.hid)}>🗑 Remove</button>
          </div>
        )
      })()}

      {/* Note editor over an existing highlight */}
      {noteEditor && (
        <div
          className="reader-note-editor"
          style={{ left: Math.max(140, Math.min(window.innerWidth - 140, noteEditor.x)), top: Math.max(52, noteEditor.y - 20) }}
        >
          <textarea
            autoFocus
            className="reader-note-textarea"
            value={noteEditor.text}
            placeholder="Add a note…"
            onChange={e => setNoteEditor(n => ({ ...n, text: e.target.value }))}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setNoteEditor(null) }}
          />
          <div className="reader-note-actions">
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setNoteEditor(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12 }}
              onClick={() => { saveNote(noteEditor.hid, noteEditor.text); setNoteEditor(null) }}
            >Save</button>
          </div>
        </div>
      )}

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

      {/* Keyboard shortcuts flyout */}
      {shortcutsOpen && (
        <>
          <div className="reader-panel-dismiss" onClick={() => setShortcutsOpen(false)} />
          <div className="reader-shortcuts">
            <div className="reader-panel-title">Keyboard shortcuts</div>
            <div className="reader-shortcut-list">
              {[
                [[['→'], ['↓'], ['Space'], ['PgDn']], 'Next page'],
                [[['←'], ['↑'], ['PgUp']], 'Previous page'],
                [[['Ctrl', 'F']], 'Search in book'],
                [[['Esc']], 'Close panel / back'],
              ].map(([combos, label], i) => (
                <div className="reader-shortcut-row" key={i}>
                  <div className="reader-shortcut-keys">
                    {combos.map((combo, j) => (
                      <span key={j}>
                        {j > 0 && <span className="reader-shortcut-or">/</span>}
                        {combo.map((k, m) => (
                          <span key={m}>
                            {m > 0 && <span className="reader-shortcut-plus">+</span>}
                            <kbd className="reader-kbd">{k}</kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </div>
                  <div className="reader-shortcut-label">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
