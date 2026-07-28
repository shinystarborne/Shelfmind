import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { API, useApp } from '../App'
import { GlobalWorkerOptions, getDocument, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import PdfPinPanel from './PdfPinPanel'

// Same pin note as pdfThumbnail.js: pdfjs-dist 4.x for this Electron version
GlobalWorkerOptions.workerSrc = workerUrl

const THEMES = {
  light: { bg: '#e6e1da', fg: '#3d2b1f', soft: '#7a5c50', accent: '#c97b84', chrome: 'rgba(253,246,240,0.97)', border: '#e0cfc4' },
  dark:  { bg: '#1b1815', fg: '#d8d0c4', soft: '#8f8578', accent: '#c9a06c', chrome: 'rgba(28,24,20,0.97)',   border: '#3a332c' },
}

const MIN_SCALE = 0.4
const MAX_SCALE = 4
const PAGE_GAP  = 18

const VIEWMODE_KEY = 'shelfmind-pdf-viewmode'
const loadViewMode = () => (localStorage.getItem(VIEWMODE_KEY) === 'swipe' ? 'swipe' : 'scroll')

// ── Search highlighting on a rendered page's live TextLayer ──────────────────
// textDivs/textContentItemsStr are index-aligned (pdf.js pushes to both together
// per text item), so we can join the strings to search, then map an occurrence's
// offset back to the containing span. A match straddling two adjacent spans
// highlights only the first containing span in full — a deliberate simplification.
function resetLayerHighlights(layer) {
  if (!layer) return
  const items = layer.textContentItemsStr
  const divs  = layer.textDivs
  for (let i = 0; i < divs.length; i++) {
    if (divs[i].querySelector('.sm-pdf-hit')) divs[i].textContent = items[i]
  }
}

function highlightQueryOnLayer(layer, query, currentOccIdx = -1) {
  resetLayerHighlights(layer)
  if (!layer || !query) return
  const items = layer.textContentItemsStr
  const divs  = layer.textDivs
  const starts = []
  let acc = 0
  for (let i = 0; i < items.length; i++) { starts.push(acc); acc += items[i].length + 1 }
  const pageText = items.join(' ')
  const lower = pageText.toLowerCase()
  const q = query.toLowerCase()

  let pos = lower.indexOf(q)
  let hitNum = 0
  while (pos !== -1) {
    let itemIdx = -1
    for (let i = 0; i < items.length; i++) {
      const s = starts[i], e = s + items[i].length
      if (pos >= s && pos < e) { itemIdx = i; break }
    }
    if (itemIdx !== -1) {
      const div = divs[itemIdx]
      const original    = items[itemIdx]
      const localStart  = pos - starts[itemIdx]
      const localEnd     = Math.min(original.length, localStart + q.length)
      const before = original.slice(0, localStart)
      const match  = original.slice(localStart, localEnd)
      const after  = original.slice(localEnd)
      div.textContent = ''
      if (before) div.appendChild(document.createTextNode(before))
      const mark = document.createElement('span')
      mark.className = hitNum === currentOccIdx ? 'sm-pdf-hit sm-pdf-hit-current' : 'sm-pdf-hit'
      mark.textContent = match
      div.appendChild(mark)
      if (after) div.appendChild(document.createTextNode(after))
    }
    hitNum++
    pos = lower.indexOf(q, pos + q.length)
  }
}

export default function PdfReader({ doc: pdfDoc, target, onClose, onOpenAlongside, persistPosition = true, active = true }) {
  const { prefs, toast } = useApp()
  const [numPages, setNumPages] = useState(0)
  const [dims, setDims]         = useState([])     // base {w, h} per page at scale 1
  const [scale, setScale]       = useState(null)   // null until fit-width computed
  const [curPage, setCurPage]   = useState(1)
  const [error, setError]       = useState(null)
  const [viewMode, setViewMode] = useState(loadViewMode)   // 'scroll' (continuous) | 'swipe' (one page at a time)
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // ── Doc metadata fetched independently of the `doc` prop, which is sometimes
  // just a lightweight {id, title} (e.g. from a library search-result jump) ──
  const [docMeta, setDocMeta] = useState(null)   // { pins, tab_id, tab_name, ... } — the full server record
  useEffect(() => {
    let alive = true
    fetch(`${API}/pdf-docs/${pdfDoc.id}`).then(r => r.json()).then(d => { if (alive) setDocMeta(d) }).catch(() => {})
    return () => { alive = false }
  }, [pdfDoc.id])
  const pins = docMeta?.pins || []

  // ── Pinned reference crops: draw-a-rectangle mode + which pins are open ──
  const [pinMode, setPinMode]         = useState(false)
  const [openPinIds, setOpenPinIds]   = useState(() => new Set())
  const [draftSel, setDraftSel]       = useState(null)   // { pageIdx, x0, y0, x1, y1 } in page-local CSS px
  const pageOverlayElsRef             = useRef([])
  const draftStartRef                 = useRef(null)
  const pinModeRef                    = useRef(false)
  pinModeRef.current                  = pinMode
  const activeRef                     = useRef(active)
  activeRef.current                   = active

  // ── Split view: sibling-doc picker for "Open alongside" ──
  const [siblingPickerOpen, setSiblingPickerOpen] = useState(false)
  const [siblingDocs, setSiblingDocs]              = useState([])

  // ── Keyboard shortcuts help flyout ──
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const containerRef = useRef(null)
  const docRef       = useRef(null)     // pdfjs document
  const pageElsRef   = useRef([])       // wrapper divs
  const renderedRef  = useRef([])       // scale each page was last rendered at
  const tasksRef     = useRef([])       // in-flight pdfjs render tasks
  const prevScaleRef = useRef(null)
  const saveTimer    = useRef(null)
  const scaleRef     = useRef(null)
  scaleRef.current   = scale

  // ── Search (text layer + highlighting) ──────────────────────────────────────
  const textLayerElsRef      = useRef([])   // per-page container divs for the text layer
  const textLayersRef        = useRef([])   // per-page live TextLayer instances (once rendered)
  const textContentCacheRef  = useRef([])   // per-page page.getTextContent() result, cached across zoom
  const activeQueryRef       = useRef('')   // current search query, read inside renderPage's closure

  const th = THEMES[prefs.theme === 'dark' ? 'dark' : 'light']

  // ── Load document ───────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    const url = `${API}/pdf-docs/${pdfDoc.id}/file`
    getDocument({ url }).promise
      .then(async d => {
        if (!alive) { d.destroy(); return }
        docRef.current = d
        const sizes = []
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 })
          sizes.push({ w: vp.width, h: vp.height })
        }
        if (!alive) return
        setDims(sizes)
        setNumPages(d.numPages)
        // Restore zoom, else fit width
        const availW = (containerRef.current?.clientWidth || 900) - 48
        const fitW   = availW / (sizes[0]?.w || 600)
        setScale(pdfDoc.zoom && pdfDoc.zoom >= MIN_SCALE && pdfDoc.zoom <= MAX_SCALE
          ? pdfDoc.zoom
          : Math.max(MIN_SCALE, Math.min(2, fitW)))
      })
      .catch(err => { if (alive) setError(err.message) })
    return () => {
      alive = false
      tasksRef.current.forEach(t => t?.cancel?.())
      docRef.current?.destroy()
    }
  }, [pdfDoc.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Page rendering (lazy, at current scale) ─────────────────────────────────
  const renderPage = useCallback(async (idx) => {
    const d = docRef.current
    const s = scaleRef.current
    const wrap = pageElsRef.current[idx]
    if (!d || !s || !wrap || renderedRef.current[idx] === s) return
    renderedRef.current[idx] = s
    try {
      tasksRef.current[idx]?.cancel?.()
      const page = await d.getPage(idx + 1)
      const dpr  = Math.min(window.devicePixelRatio || 1, 2)
      const vp   = page.getViewport({ scale: s * dpr })
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      canvas.style.width  = `${Math.round(vp.width / dpr)}px`
      canvas.style.height = `${Math.round(vp.height / dpr)}px`
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      tasksRef.current[idx] = task
      await task.promise
      if (renderedRef.current[idx] !== s) return   // zoom changed mid-render
      wrap.replaceChildren(canvas)

      // Text layer for search highlighting — must occupy the same CSS-pixel box
      // as the canvas above. The canvas renders at s*dpr then is CSS-sized back
      // down to land at d.w*s CSS px, so the text layer's own viewport uses
      // plain scale s (not s*dpr) or its spans would be double-scaled.
      const textContainer = textLayerElsRef.current[idx]
      if (textContainer) {
        const textVp = page.getViewport({ scale: s })
        textContainer.replaceChildren()
        textContainer.style.width  = `${textVp.width}px`
        textContainer.style.height = `${textVp.height}px`
        let tc = textContentCacheRef.current[idx]
        if (!tc) {
          tc = await page.getTextContent()
          textContentCacheRef.current[idx] = tc
        }
        const layer = new TextLayer({ textContentSource: tc, container: textContainer, viewport: textVp })
        await layer.render()
        if (renderedRef.current[idx] !== s) return   // zoom changed again mid text-layer render
        textLayersRef.current[idx] = layer
        if (activeQueryRef.current.length >= 2) highlightQueryOnLayer(layer, activeQueryRef.current)
      }
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') renderedRef.current[idx] = null
    }
  }, [])

  // Render every page whose box is near the viewport. Driven by scroll/zoom
  // directly (not IntersectionObserver — Chromium throttles IO and rAF when
  // the window is occluded, which left pages blank).
  const renderVisible = useCallback(() => {
    const c = containerRef.current
    if (!c || !scaleRef.current) return
    if (viewModeRef.current === 'swipe') {
      const lo = c.scrollLeft - 800
      const hi = c.scrollLeft + c.clientWidth + 800
      for (let i = 0; i < pageElsRef.current.length; i++) {
        const el = pageElsRef.current[i]?.parentElement
        if (!el) continue
        if (el.offsetLeft + el.offsetWidth >= lo && el.offsetLeft <= hi) renderPage(i)
        else if (el.offsetLeft > hi) break
      }
      return
    }
    const lo = c.scrollTop - 800
    const hi = c.scrollTop + c.clientHeight + 800
    for (let i = 0; i < pageElsRef.current.length; i++) {
      const el = pageElsRef.current[i]?.parentElement
      if (!el) continue
      if (el.offsetTop + el.offsetHeight >= lo && el.offsetTop <= hi) renderPage(i)
      else if (el.offsetTop > hi) break
    }
  }, [renderPage])

  const renderVisibleRef = useRef(() => {})
  renderVisibleRef.current = renderVisible

  useEffect(() => {
    if (!scale || dims.length === 0) return
    const t = setTimeout(renderVisible, 30)
    return () => clearTimeout(t)
  }, [scale, dims, renderVisible])

  // Keep the reading spot when zoom changes
  useLayoutEffect(() => {
    if (!scale) return
    const c = containerRef.current
    if (c && prevScaleRef.current && prevScaleRef.current !== scale) {
      const ratio = scale / prevScaleRef.current
      if (viewModeRef.current === 'swipe') {
        c.scrollLeft = (c.scrollLeft + c.clientWidth / 2) * ratio - c.clientWidth / 2
      } else {
        c.scrollTop = (c.scrollTop + c.clientHeight / 2) * ratio - c.clientHeight / 2
      }
    }
    prevScaleRef.current = scale
  }, [scale])

  // Restore saved page once dims + scale are known (only on first load).
  // Until this has happened, scroll events must not save a position — the
  // initial scrollTop=0 would overwrite the saved page with 1.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !scale || dims.length === 0) return
    const target = pdfDoc.last_page
    if (!(target > 1 && target <= dims.length)) { restoredRef.current = true; return }
    let tries = 0
    const attempt = () => {
      const el = pageElsRef.current[target - 1]?.parentElement
      const c  = containerRef.current
      if (el && c) {
        const swipe = viewModeRef.current === 'swipe'
        if (swipe) c.scrollLeft = el.offsetLeft - PAGE_GAP
        else        c.scrollTop  = el.offsetTop - PAGE_GAP
        if ((swipe ? c.scrollLeft : c.scrollTop) > 0 || tries >= 5) {
          restoredRef.current = true
          curPageRef.current = target
          setCurPage(target)
          renderVisibleRef.current()
          return
        }
      }
      // setTimeout, not rAF — rAF never fires while the window is occluded
      if (++tries < 10) setTimeout(attempt, 40)
      else restoredRef.current = true
    }
    setTimeout(attempt, 0)
  }, [scale, dims, pdfDoc.last_page])

  // ── Current page tracking + position saving ─────────────────────────────────
  const savePosition = useCallback((page, s) => {
    if (!persistPosition) return   // secondary pane of a "duplicate alongside" — primary owns the saved position
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch(`${API}/pdf-docs/${pdfDoc.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ last_page: page, zoom: s }),
      }).catch(() => {})
    }, 800)
  }, [pdfDoc.id, persistPosition])

  const curPageRef = useRef(1)
  const onScroll = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    let page = 1
    if (viewModeRef.current === 'swipe') {
      const probeX = c.scrollLeft + c.clientWidth / 2
      let bestDist = Infinity
      for (let i = 0; i < pageElsRef.current.length; i++) {
        const el = pageElsRef.current[i]?.parentElement
        if (!el) continue
        const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - probeX)
        if (dist < bestDist) { bestDist = dist; page = i + 1 }
      }
    } else {
      const probe = c.scrollTop + c.clientHeight * 0.4
      for (let i = 0; i < pageElsRef.current.length; i++) {
        const el = pageElsRef.current[i]?.parentElement
        if (el && el.offsetTop <= probe) page = i + 1
        else break
      }
    }
    curPageRef.current = page
    setCurPage(page)
    renderVisibleRef.current()
    if (restoredRef.current) savePosition(page, scaleRef.current)
  }, [savePosition])

  // Native listener — React's synthetic onScroll proved unreliable here
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    c.addEventListener('scroll', onScroll, { passive: true })
    return () => c.removeEventListener('scroll', onScroll)
  }, [onScroll])

  // ── Zoom ────────────────────────────────────────────────────────────────────
  const zoom = useCallback((factor) => {
    setScale(s => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, +(s * factor).toFixed(3)))
      savePosition(curPage, next)
      return next
    })
  }, [curPage, savePosition])

  const fitWidth = useCallback(() => {
    const availW = (containerRef.current?.clientWidth || 900) - 48
    const base   = dims[curPage - 1]?.w || dims[0]?.w || 600
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, availW / base)))
  }, [dims, curPage])

  // Fit the whole page (width AND height) in view — used once when switching
  // into swipe mode so the first page-to-page turn doesn't need vertical
  // scrolling inside a page.
  const fitPage = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    const availW = c.clientWidth - 48
    const availH = c.clientHeight - 48
    const d = dims[curPage - 1] || dims[0]
    if (!d) return
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(availW / d.w, availH / d.h))))
  }, [dims, curPage])

  // ── Swipe mode: one page at a time, navigated left/right ────────────────────
  const toggleViewMode = useCallback(() => {
    setViewMode(m => {
      const next = m === 'swipe' ? 'scroll' : 'swipe'
      localStorage.setItem(VIEWMODE_KEY, next)
      return next
    })
  }, [])

  const turnPage = useCallback((dir) => {
    const total = pageElsRef.current.length
    const next = Math.min(total, Math.max(1, curPageRef.current + dir))
    if (next === curPageRef.current) return
    const el = pageElsRef.current[next - 1]?.parentElement
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [])

  // On mode switch: fit the whole page when entering swipe, and in both
  // directions re-sync scroll position to the page we were just on — the
  // scroll axis changes (vertical <-> horizontal), so the browser doesn't
  // carry it over on its own. Deferred a tick so it runs after the
  // scale/layout change from fitPage has actually reflowed the DOM.
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (prevViewModeRef.current === viewMode) return
    const enteringSwipe = viewMode === 'swipe'
    const targetPage = curPageRef.current
    prevViewModeRef.current = viewMode
    if (enteringSwipe) fitPage()
    const t = setTimeout(() => {
      const c = containerRef.current
      const el = pageElsRef.current[targetPage - 1]?.parentElement
      if (!c || !el) return
      if (enteringSwipe) el.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' })
      else c.scrollTop = el.offsetTop - PAGE_GAP
      renderVisibleRef.current()
    }, 60)
    return () => clearTimeout(t)
  }, [viewMode, fitPage])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoom(e.deltaY > 0 ? 1 / 1.1 : 1.1)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [zoom])

  // Swipe mode: a vertical wheel/trackpad scroll turns the page (mirroring the
  // EPUB reader's wheel-to-turn behavior); a real horizontal swipe is left to
  // the browser's native scroll-snap on `.pdf-scroll-swipe`.
  useEffect(() => {
    if (viewMode !== 'swipe') return
    const c = containerRef.current
    if (!c) return
    let lastTurn = 0
    const onWheel = (e) => {
      if (e.ctrlKey) return   // the zoom handler above owns this
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return   // real horizontal swipe — let it scroll natively
      if (Math.abs(e.deltaY) < 8) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastTurn < 350) return   // debounce fast wheel bursts / mid-smooth-scroll re-triggers
      lastTurn = now
      turnPage(e.deltaY > 0 ? 1 : -1)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [viewMode, turnPage])

  // ── Pinned reference crops ───────────────────────────────────────────────────
  const startPinMode = useCallback(() => {
    if (pins.length >= 5) { toast('Max 5 pins — remove one first (hover a numbered chip)', 'error'); return }
    setPinMode(true)
  }, [pins.length, toast])

  const cancelPinMode = useCallback(() => {
    setPinMode(false)
    setDraftSel(null)
    draftStartRef.current = null
  }, [])
  const cancelPinModeRef = useRef(cancelPinMode)
  cancelPinModeRef.current = cancelPinMode

  const onPinPointerDown = useCallback((e, pageIdx) => {
    if (!pinMode) return
    const rect = pageOverlayElsRef.current[pageIdx]?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    draftStartRef.current = { pageIdx, x, y }
    setDraftSel({ pageIdx, x0: x, y0: y, x1: x, y1: y })
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [pinMode])

  const onPinPointerMove = useCallback((e) => {
    const start = draftStartRef.current
    if (!start) return
    const rect = pageOverlayElsRef.current[start.pageIdx]?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(rect.width,  e.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
    setDraftSel({ pageIdx: start.pageIdx, x0: start.x, y0: start.y, x1: x, y1: y })
  }, [])

  const onPinPointerUp = useCallback(async () => {
    const sel = draftSel
    draftStartRef.current = null
    setDraftSel(null)
    setPinMode(false)
    if (!sel) return
    const left = Math.min(sel.x0, sel.x1), top = Math.min(sel.y0, sel.y1)
    const w = Math.abs(sel.x1 - sel.x0), h = Math.abs(sel.y1 - sel.y0)
    if (w < 12 || h < 12) return   // treat as an accidental click, not a real selection
    const s = scaleRef.current
    const rectPdf = { x: left / s, y: top / s, w: w / s, h: h / s }
    const res = await fetch(`${API}/pdf-docs/${pdfDoc.id}/pins`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ page: sel.pageIdx + 1, rect: rectPdf }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast(data.error || 'Could not save pin', 'error'); return }
    setDocMeta(m => m ? { ...m, pins: [...(m.pins || []), data] } : m)
    setOpenPinIds(ids => new Set(ids).add(data.id))
  }, [draftSel, pdfDoc.id, toast])

  const togglePin = useCallback((pinId) => {
    setOpenPinIds(ids => {
      const next = new Set(ids)
      if (next.has(pinId)) next.delete(pinId); else next.add(pinId)
      return next
    })
  }, [])

  const deletePin = useCallback(async (pinId) => {
    setOpenPinIds(ids => { const next = new Set(ids); next.delete(pinId); return next })
    setDocMeta(m => m ? { ...m, pins: (m.pins || []).filter(p => p.id !== pinId) } : m)
    await fetch(`${API}/pdf-docs/${pdfDoc.id}/pins/${pinId}`, { method: 'DELETE' }).catch(() => {})
  }, [pdfDoc.id])

  // ── Split view: "Open alongside" sibling picker ─────────────────────────────
  const openSiblingPicker = useCallback(async () => {
    setSiblingPickerOpen(o => !o)
    if (!docMeta?.tab_id || siblingDocs.length) return
    const tab = await fetch(`${API}/pdf-tabs/${docMeta.tab_id}`).then(r => r.json()).catch(() => null)
    setSiblingDocs((tab?.docs || []).filter(d => d.id !== pdfDoc.id))
  }, [docMeta, siblingDocs.length, pdfDoc.id])

  const pickSibling = useCallback((doc) => {
    setSiblingPickerOpen(false)
    onOpenAlongside?.(doc)
  }, [onOpenAlongside])

  const duplicateAlongside = useCallback(() => {
    onOpenAlongside?.({ id: pdfDoc.id, title: pdfDoc.title })
  }, [onOpenAlongside, pdfDoc.id, pdfDoc.title])

  // ── Search ("find in this PDF only") ────────────────────────────────────────
  // pdfSearchPages: null = not fetched yet, [] = fetched but empty/unsupported.
  const [searchOpen, setSearchOpen]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState('')
  const [pdfSearchPages, setPdfSearchPages] = useState(null)
  const [pdfHits, setPdfHits]               = useState([])
  const [pdfSearchIdx, setPdfSearchIdx]     = useState(0)

  useEffect(() => { activeQueryRef.current = (searchOpen ? searchQuery.trim() : '') }, [searchQuery, searchOpen])

  const clearAllHighlights = useCallback(() => {
    textLayersRef.current.forEach(layer => resetLayerHighlights(layer))
  }, [])

  const openSearch = useCallback(async () => {
    setSearchOpen(true)
    if (pdfSearchPages) return
    try {
      const data = await fetch(`${API}/pdf-docs/${pdfDoc.id}/search-text`).then(r => {
        if (!r.ok) throw new Error('unsupported')
        return r.json()
      })
      setPdfSearchPages(data.pages || [])
    } catch {
      setPdfSearchPages([])
    }
  }, [pdfDoc.id, pdfSearchPages])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    clearAllHighlights()
  }, [clearAllHighlights])

  // Recompute matches whenever the query or the (lazily-fetched) page text changes.
  // Tracks which occurrence-number-within-page each hit is, so highlightQueryOnLayer
  // (which independently re-scans the *live* rendered page text) can mark the same
  // occurrence as "current" without the two derivations needing identical offsets.
  useEffect(() => {
    if (!searchOpen || !pdfSearchPages) { setPdfHits([]); return }
    const q = searchQuery.trim().toLowerCase()
    if (q.length < 2) { setPdfHits([]); return }
    const hits = []
    for (const pg of pdfSearchPages) {
      const text = pg.text || ''
      if (!text) continue
      const lower = text.toLowerCase()
      let idx = lower.indexOf(q)
      let occ = 0
      while (idx !== -1) {
        hits.push({ page: pg.page, offset: idx, matchText: text.slice(idx, idx + q.length), occurrenceIndexOnPage: occ })
        occ++
        idx = lower.indexOf(q, idx + q.length)
      }
    }
    setPdfHits(hits)
    const preferred = target?.page ? hits.findIndex(h => h.page === target.page) : -1
    setPdfSearchIdx(preferred >= 0 ? preferred : 0)
  }, [searchQuery, searchOpen, pdfSearchPages, target])

  const jumpToPdfMatch = useCallback(async (hit) => {
    const idx = hit.page - 1
    await renderPage(idx)
    const layer = textLayersRef.current[idx]
    if (layer) highlightQueryOnLayer(layer, searchQuery.trim(), hit.occurrenceIndexOnPage)
    const el = pageElsRef.current[idx]?.parentElement
    const c  = containerRef.current
    if (el && c) {
      if (viewModeRef.current === 'swipe') el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      else c.scrollTo({ top: el.offsetTop - PAGE_GAP, behavior: 'smooth' })
    }
  }, [renderPage, searchQuery])

  // Jump to the current hit whenever it changes (typing, prev/next, or Enter)
  useEffect(() => {
    if (!searchOpen || pdfHits.length === 0) return
    const hit = pdfHits[pdfSearchIdx]
    if (hit) jumpToPdfMatch(hit)
  }, [pdfSearchIdx, pdfHits, searchOpen])   // eslint-disable-line react-hooks/exhaustive-deps

  const searchNext = useCallback(() => {
    setPdfSearchIdx(i => pdfHits.length ? (i + 1) % pdfHits.length : 0)
  }, [pdfHits.length])

  const searchPrev = useCallback(() => {
    setPdfSearchIdx(i => pdfHits.length ? (i - 1 + pdfHits.length) % pdfHits.length : 0)
  }, [pdfHits.length])

  const openSearchRef  = useRef(openSearch)
  openSearchRef.current  = openSearch
  const closeSearchRef = useRef(closeSearch)
  closeSearchRef.current = closeSearch

  // Jump-on-open target from the Library's full-text search results
  useEffect(() => {
    if (!target?.matchText || !scale || dims.length === 0) return
    setSearchQuery(target.matchText)
    openSearchRef.current()
  }, [target, scale, dims.length])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (!activeRef.current) return   // split view: only the hovered/focused pane reacts to shortcuts
      if (pinModeRef.current && e.key === 'Escape') { cancelPinModeRef.current(); return }
      if (searchOpen && e.key === 'Escape') { closeSearchRef.current(); return }
      if (shortcutsOpen && e.key === 'Escape') { setShortcutsOpen(false); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearchRef.current(); return }
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === '+' || e.key === '=') zoom(1.15)
      else if (e.key === '-')                  zoom(1 / 1.15)
      else if (e.key === '0')                  (viewModeRef.current === 'swipe' ? fitPage() : fitWidth())
      else if (viewModeRef.current === 'swipe' && ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turnPage(1) }
      else if (viewModeRef.current === 'swipe' && ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key))          { e.preventDefault(); turnPage(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, fitWidth, fitPage, searchOpen, shortcutsOpen, turnPage])

  const close = useCallback(() => {
    clearTimeout(saveTimer.current)
    if (restoredRef.current && persistPosition) {
      fetch(`${API}/pdf-docs/${pdfDoc.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ last_page: curPageRef.current, zoom: scaleRef.current }),
        keepalive: true,
      }).catch(() => {})
    }
    onClose()
  }, [pdfDoc.id, onClose, persistPosition])
  const closeRef = useRef(close)
  closeRef.current = close

  const vars = {
    '--r-bg': th.bg, '--r-fg': th.fg, '--r-soft': th.soft,
    '--r-accent': th.accent, '--r-chrome': th.chrome, '--r-border': th.border,
  }

  if (error) {
    return (
      <div className="reader pdf-reader chrome-visible" style={vars}>
        <div className="reader-error">
          <div style={{ fontSize: 40 }}>😔</div>
          <div>Couldn't open this PDF</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{error}</div>
          <button className="btn btn-secondary" onClick={onClose}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="reader pdf-reader chrome-visible" style={vars}>
      <div className="reader-topbar">
        <button className="reader-icon-btn" onClick={close} title="Back (Esc)">←</button>
        <div className="reader-book-title">
          <span className="reader-title-main">{pdfDoc.title}</span>
        </div>
        <div className="pdf-toolbar">
          {numPages > 0 && (
            <span className="pdf-page-indicator">{curPage} / {numPages}</span>
          )}
          <button
            className={`reader-icon-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            title="Search in this PDF (Ctrl+F)"
          >🔎</button>
          <button className="reader-icon-btn" onClick={() => zoom(1 / 1.15)} title="Zoom out (−)">−</button>
          <span className="pdf-zoom-pct">{scale ? `${Math.round(scale * 100)}%` : '…'}</span>
          <button className="reader-icon-btn" onClick={() => zoom(1.15)} title="Zoom in (+)">+</button>
          <button
            className="reader-icon-btn pdf-fit-btn"
            onClick={() => (viewMode === 'swipe' ? fitPage() : fitWidth())}
            title={viewMode === 'swipe' ? 'Fit page (0)' : 'Fit width (0)'}
          >⇔</button>
          <button
            className="reader-icon-btn"
            onClick={toggleViewMode}
            title={viewMode === 'swipe' ? 'Swipe pages — click for continuous scroll' : 'Continuous scroll — click to swipe pages'}
          >{viewMode === 'swipe' ? '⬌' : '↕'}</button>
          <button
            className={`reader-icon-btn ${shortcutsOpen ? 'active' : ''}`}
            onClick={() => setShortcutsOpen(o => !o)}
            title="Keyboard shortcuts"
          >ⓘ</button>

          <div className="pdf-pin-tray">
            {pins.map((pin, i) => (
              <button
                key={pin.id}
                className={`pdf-pin-chip ${openPinIds.has(pin.id) ? 'active' : ''}`}
                onClick={() => togglePin(pin.id)}
                title={`Pin ${i + 1} · p.${pin.page} — click to show/hide`}
              >
                {i + 1}
                <span
                  className="pdf-pin-chip-delete"
                  title="Remove this pin"
                  onClick={e => { e.stopPropagation(); deletePin(pin.id) }}
                >✕</span>
              </button>
            ))}
            <button
              className={`reader-icon-btn ${pinMode ? 'active' : ''}`}
              onClick={() => (pinMode ? cancelPinMode() : startPinMode())}
              title="Draw a new pinned reference crop (Esc to cancel)"
            >📌</button>
          </div>

          <div className="pdf-split-actions">
            <button className="reader-icon-btn" onClick={duplicateAlongside} title="Duplicate this PDF alongside">⧉</button>
            <div style={{ position: 'relative' }}>
              <button
                className={`reader-icon-btn ${siblingPickerOpen ? 'active' : ''}`}
                onClick={openSiblingPicker}
                title="Open another PDF from this tab alongside"
              >⇄</button>
              {siblingPickerOpen && (
                <div className="pdf-sibling-picker">
                  {siblingDocs.length === 0 && <div className="pdf-sibling-empty">No other PDFs in this tab</div>}
                  {siblingDocs.map(d => (
                    <div key={d.id} className="pdf-sibling-item" onClick={() => pickSibling(d)}>{d.title}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {pinMode && (
        <div className="pdf-pin-hint">Drag a rectangle around the area you want to pin — Esc to cancel</div>
      )}

      {/* In-PDF search bar */}
      {searchOpen && (
        <div className="reader-searchbar">
          <input
            autoFocus
            className="reader-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={pdfSearchPages === null ? 'Loading PDF text…' : 'Search this PDF…'}
            disabled={pdfSearchPages === null}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
              else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) searchPrev(); else searchNext() }
            }}
          />
          <span className="reader-search-count">
            {searchQuery.trim().length < 2 ? '' : pdfHits.length === 0 ? '0 / 0' : `${pdfSearchIdx + 1} / ${pdfHits.length}`}
          </span>
          <button className="reader-icon-btn" onClick={searchPrev} disabled={pdfHits.length === 0} title="Previous match">▲</button>
          <button className="reader-icon-btn" onClick={searchNext} disabled={pdfHits.length === 0} title="Next match">▼</button>
          <button className="reader-icon-btn" onClick={closeSearch} title="Close search">✕</button>
        </div>
      )}

      <div className="pdf-stage">
        {viewMode === 'swipe' && (
          <button className="reader-arrow reader-arrow-left" onClick={() => turnPage(-1)} title="Previous page">‹</button>
        )}
        <div className={`pdf-scroll ${viewMode === 'swipe' ? 'pdf-scroll-swipe' : ''}`} ref={containerRef}>
          <div className="pdf-pages">
            {scale && dims.map((d, i) => (
              <div
                key={i}
                className="pdf-page"
                style={{ width: Math.round(d.w * scale), height: Math.round(d.h * scale), '--scale-factor': scale }}
              >
                <div
                  className="pdf-page-canvas"
                  data-idx={i}
                  ref={el => { pageElsRef.current[i] = el }}
                />
                <div
                  className="pdf-page-text textLayer"
                  ref={el => { textLayerElsRef.current[i] = el }}
                />
                <div
                  className={`pdf-pin-draw-layer ${pinMode ? 'active' : ''}`}
                  ref={el => { pageOverlayElsRef.current[i] = el }}
                  onPointerDown={e => onPinPointerDown(e, i)}
                  onPointerMove={onPinPointerMove}
                  onPointerUp={onPinPointerUp}
                >
                  {draftSel && draftSel.pageIdx === i && (
                    <div
                      className="pdf-pin-draft-rect"
                      style={{
                        left:   Math.min(draftSel.x0, draftSel.x1),
                        top:    Math.min(draftSel.y0, draftSel.y1),
                        width:  Math.abs(draftSel.x1 - draftSel.x0),
                        height: Math.abs(draftSel.y1 - draftSel.y0),
                      }}
                    />
                  )}
                </div>
                <div className="pdf-page-num">{i + 1}</div>
              </div>
            ))}
            {!scale && !error && (
              <div className="reader-loading" style={{ position: 'static', background: 'transparent', marginTop: 80 }}>
                <span className="spin">↻</span>
              </div>
            )}
          </div>
        </div>
        {viewMode === 'swipe' && (
          <button className="reader-arrow reader-arrow-right" onClick={() => turnPage(1)} title="Next page">›</button>
        )}
      </div>

      {pins.filter(p => openPinIds.has(p.id)).map(pin => (
        <PdfPinPanel
          key={pin.id}
          pin={pin}
          index={pins.findIndex(p => p.id === pin.id)}
          pdfDocRef={docRef}
          onClose={() => togglePin(pin.id)}
        />
      ))}

      {/* Keyboard shortcuts flyout */}
      {shortcutsOpen && (
        <>
          <div className="reader-panel-dismiss" onClick={() => setShortcutsOpen(false)} />
          <div className="reader-shortcuts">
            <div className="reader-panel-title">Keyboard shortcuts</div>
            <div className="reader-shortcut-list">
              {[
                [[['Ctrl', 'F']], 'Search in this PDF'],
                ...(viewMode === 'swipe' ? [
                  [[['→'], ['↓'], ['Space'], ['PgDn'], ['Scroll ↓']], 'Next page'],
                  [[['←'], ['↑'], ['PgUp'], ['Scroll ↑']], 'Previous page'],
                ] : []),
                [[['+'], ['=']], 'Zoom in'],
                [[['-']], 'Zoom out'],
                [[['0']], viewMode === 'swipe' ? 'Fit page' : 'Fit width'],
                [[['Ctrl', 'Scroll']], 'Zoom in/out'],
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
