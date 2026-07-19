import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { API, useApp } from '../App'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Same pin note as pdfThumbnail.js: pdfjs-dist 4.x for this Electron version
GlobalWorkerOptions.workerSrc = workerUrl

const THEMES = {
  light: { bg: '#e6e1da', fg: '#3d2b1f', soft: '#7a5c50', accent: '#c97b84', chrome: 'rgba(253,246,240,0.97)', border: '#e0cfc4' },
  dark:  { bg: '#1b1815', fg: '#d8d0c4', soft: '#8f8578', accent: '#c9a06c', chrome: 'rgba(28,24,20,0.97)',   border: '#3a332c' },
}

const MIN_SCALE = 0.4
const MAX_SCALE = 4
const PAGE_GAP  = 18

export default function PdfReader({ doc: pdfDoc, onClose }) {
  const { prefs } = useApp()
  const [numPages, setNumPages] = useState(0)
  const [dims, setDims]         = useState([])     // base {w, h} per page at scale 1
  const [scale, setScale]       = useState(null)   // null until fit-width computed
  const [curPage, setCurPage]   = useState(1)
  const [error, setError]       = useState(null)

  const containerRef = useRef(null)
  const docRef       = useRef(null)     // pdfjs document
  const pageElsRef   = useRef([])       // wrapper divs
  const renderedRef  = useRef([])       // scale each page was last rendered at
  const tasksRef     = useRef([])       // in-flight pdfjs render tasks
  const prevScaleRef = useRef(null)
  const saveTimer    = useRef(null)
  const scaleRef     = useRef(null)
  scaleRef.current   = scale

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
      c.scrollTop = (c.scrollTop + c.clientHeight / 2) * ratio - c.clientHeight / 2
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
        c.scrollTop = el.offsetTop - PAGE_GAP
        if (c.scrollTop > 0 || tries >= 5) {
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
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch(`${API}/pdf-docs/${pdfDoc.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ last_page: page, zoom: s }),
      }).catch(() => {})
    }, 800)
  }, [pdfDoc.id])

  const curPageRef = useRef(1)
  const onScroll = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    const probe = c.scrollTop + c.clientHeight * 0.4
    let page = 1
    for (let i = 0; i < pageElsRef.current.length; i++) {
      const el = pageElsRef.current[i]?.parentElement
      if (el && el.offsetTop <= probe) page = i + 1
      else break
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === '+' || e.key === '=') zoom(1.15)
      else if (e.key === '-')                  zoom(1 / 1.15)
      else if (e.key === '0')                  fitWidth()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, fitWidth])

  const close = useCallback(() => {
    clearTimeout(saveTimer.current)
    if (restoredRef.current) {
      fetch(`${API}/pdf-docs/${pdfDoc.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ last_page: curPageRef.current, zoom: scaleRef.current }),
        keepalive: true,
      }).catch(() => {})
    }
    onClose()
  }, [pdfDoc.id, onClose])
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
          <button className="reader-icon-btn" onClick={() => zoom(1 / 1.15)} title="Zoom out (−)">−</button>
          <span className="pdf-zoom-pct">{scale ? `${Math.round(scale * 100)}%` : '…'}</span>
          <button className="reader-icon-btn" onClick={() => zoom(1.15)} title="Zoom in (+)">+</button>
          <button className="reader-icon-btn pdf-fit-btn" onClick={fitWidth} title="Fit width (0)">⇔</button>
        </div>
      </div>

      <div className="pdf-scroll" ref={containerRef}>
        <div className="pdf-pages">
          {scale && dims.map((d, i) => (
            <div
              key={i}
              className="pdf-page"
              style={{ width: Math.round(d.w * scale), height: Math.round(d.h * scale) }}
            >
              <div
                className="pdf-page-canvas"
                data-idx={i}
                ref={el => { pageElsRef.current[i] = el }}
              />
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
    </div>
  )
}
