import { useState, useEffect, useRef, useCallback } from 'react'

const MIN_PANEL_SCALE = 0.25
const MAX_PANEL_SCALE = 25

// Floating "picture in picture" panel that shows a cropped region of one page,
// independently draggable, zoomable, and resizable from the main reader — used
// to keep a pattern's key/legend visible while scrolling the chart elsewhere.
export default function PdfPinPanel({ pin, index, pdfDocRef, onClose }) {
  const [pos, setPos]     = useState(() => ({ x: 24 + index * 28, y: 70 + index * 28 }))
  const [panelScale, setPanelScale] = useState(1)
  const canvasRef  = useRef(null)
  const dragRef    = useRef(null)
  const resizeRef  = useRef(null)
  const initedRef  = useRef(false)

  // Pick an initial scale so the crop renders at a legible ~280px wide, once.
  useEffect(() => {
    if (initedRef.current || !pin.rect.w) return
    initedRef.current = true
    setPanelScale(Math.max(MIN_PANEL_SCALE, Math.min(MAX_PANEL_SCALE, 280 / pin.rect.w)))
  }, [pin.rect.w])

  useEffect(() => {
    let alive = true
    async function render() {
      const doc = pdfDocRef.current
      if (!doc || !canvasRef.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const page = await doc.getPage(pin.page)
      const scale = panelScale * dpr
      const vp = page.getViewport({ scale })
      // Render just the crop's own pixel footprint — translate the render so the
      // pin's rect lands at the canvas origin — instead of rasterizing the whole
      // page at `scale` (which at high zoom would allocate a huge offscreen canvas).
      const sx = pin.rect.x * scale, sy = pin.rect.y * scale
      const sw = pin.rect.w * scale, sh = pin.rect.h * scale
      const canvas = canvasRef.current
      canvas.width  = Math.max(1, Math.round(sw))
      canvas.height = Math.max(1, Math.round(sh))
      canvas.style.width  = `${Math.round(sw / dpr)}px`
      canvas.style.height = `${Math.round(sh / dpr)}px`
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: vp,
        transform: [1, 0, 0, 1, -sx, -sy],
      }).promise
      if (!alive) return
    }
    render()
    return () => { alive = false }
  }, [pdfDocRef, pin, panelScale])

  const onDragPointerDown = useCallback((e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [pos])

  const onDragPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) })
  }, [])

  const onDragPointerUp = useCallback(() => { dragRef.current = null }, [])

  const zoomPanel = useCallback((factor) => {
    setPanelScale(s => Math.max(MIN_PANEL_SCALE, Math.min(MAX_PANEL_SCALE, +(s * factor).toFixed(3))))
  }, [])

  // Corner drag resize — scales the crop up/down by width, keeping the crop's
  // own aspect ratio (there's only one degree of freedom: panelScale).
  const onResizePointerDown = useCallback((e) => {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startScale: panelScale }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [panelScale])

  const onResizePointerMove = useCallback((e) => {
    const r = resizeRef.current
    if (!r || !pin.rect.w) return
    const newWidthCss = pin.rect.w * r.startScale + (e.clientX - r.startX)
    setPanelScale(Math.max(MIN_PANEL_SCALE, Math.min(MAX_PANEL_SCALE, newWidthCss / pin.rect.w)))
  }, [pin.rect.w])

  const onResizePointerUp = useCallback(() => { resizeRef.current = null }, [])

  return (
    <div className="pdf-pin-panel" style={{ left: pos.x, top: pos.y }}>
      <div
        className="pdf-pin-panel-header"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
      >
        <span className="pdf-pin-panel-title">📌 {index + 1} · p.{pin.page}</span>
        <div className="pdf-pin-panel-controls">
          <button className="reader-icon-btn" onClick={() => zoomPanel(1 / 1.2)} title="Zoom out">−</button>
          <button className="reader-icon-btn" onClick={() => zoomPanel(1.2)} title="Zoom in">+</button>
          <button className="reader-icon-btn" onClick={onClose} title="Hide">✕</button>
        </div>
      </div>
      <div className="pdf-pin-panel-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div
        className="pdf-pin-panel-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        title="Drag to resize"
      />
    </div>
  )
}
