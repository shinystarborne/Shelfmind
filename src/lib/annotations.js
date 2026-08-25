// Drawing + hit-testing for PDF reader annotations. Items are vector data in
// page-relative coordinates (x, y, width as 0..1 fractions of the page box),
// so marks survive zooming and re-rendering:
//   stroke: { type:'stroke', tool:'highlight'|'pencil', color, width, points:[[x,y],…] }
//   text:   { type:'text', x, y, text, color, size }
export const HIGHLIGHT_COLORS = ['#f7d354', '#f49ac1', '#8fd18b', '#7fb3e0']
export const PENCIL_COLORS    = ['#d03a2c', '#2b2b2b', '#2f5fb3']
export const TEXT_COLOR       = '#2b2b2b'
export const HIGHLIGHT_WIDTH  = 0.028   // fractions of page width
export const PENCIL_WIDTH     = 0.004
export const TEXT_SIZE        = 0.022   // fraction of page height

export function drawItem(ctx, item, W, H) {
  if (item.type === 'stroke') {
    const pts = item.points
    if (!pts || pts.length === 0) return
    ctx.save()
    ctx.globalAlpha = item.tool === 'highlight' ? 0.35 : 1
    ctx.lineCap  = 'round'
    ctx.lineJoin = 'round'
    if (pts.length === 1) {
      ctx.fillStyle = item.color
      ctx.beginPath()
      ctx.arc(pts[0][0] * W, pts[0][1] * H, Math.max(1, (item.width * W) / 2), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = item.color
      ctx.lineWidth = Math.max(1, item.width * W)
      ctx.beginPath()
      ctx.moveTo(pts[0][0] * W, pts[0][1] * H)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H)
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (item.type === 'text') {
    ctx.save()
    ctx.fillStyle = item.color
    ctx.font = `600 ${Math.max(8, item.size * H)}px system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(item.text, item.x * W, item.y * H)
    ctx.restore()
  }
}

function distToSegment(px, py, x1, y1, x2, y2, W, H) {
  const ax = px * W, ay = py * H
  const bx = x1 * W, by = y1 * H
  const cx = x2 * W, cy = y2 * H
  const dx = cx - bx, dy = cy - by
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((ax - bx) * dx + (ay - by) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(ax - (bx + t * dx), ay - (by + t * dy))
}

// tolPx is CSS pixels of extra slack around the stroke's own width.
export function hitTestItem(item, rx, ry, W, H, tolPx) {
  if (item.type === 'stroke') {
    const pts = item.points || []
    const tol = tolPx + (item.width * W) / 2
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        if (Math.hypot(rx * W - pts[0][0] * W, ry * H - pts[0][1] * H) <= tol) return true
      } else if (distToSegment(rx, ry, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], W, H) <= tol) {
        return true
      }
    }
    return false
  }
  if (item.type === 'text') {
    const fs = item.size * H
    const wPx = item.text.length * fs * 0.55   // rough width estimate
    return rx * W >= item.x * W - 4 && rx * W <= item.x * W + wPx + 4 &&
           ry * H >= item.y * H - 4 && ry * H <= item.y * H + fs + 4
  }
  return false
}
