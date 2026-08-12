// Cover thumbnails: ~400px-wide JPEGs in covers/thumbs/<id>.jpg, generated
// with sharp (N-API prebuilt — no toolchain, works under Electron as-is).
// Grids and lists render thumbs instead of the original covers, which can be
// several MB each; the full-size file stays for the drawer/reader.
const fs   = require('fs')
const path = require('path')

// If sharp can't load (broken install), thumbnails are simply skipped —
// the frontend falls back to full-size covers via the on-demand route's 404.
let sharp = null
try { sharp = require('sharp') } catch { console.warn('sharp unavailable — cover thumbnails disabled') }

const THUMB_WIDTH = 400
const COVER_EXTS  = ['jpg', 'jpeg', 'png', 'webp', 'gif']

function thumbsDir(coversDir) { return path.join(coversDir, 'thumbs') }
function thumbPath(coversDir, id) { return path.join(thumbsDir(coversDir), `${id}.jpg`) }

function findCover(coversDir, id) {
  for (const ext of COVER_EXTS) {
    const f = path.join(coversDir, `${id}.${ext}`)
    if (fs.existsSync(f)) return f
  }
  return null
}

// Generate (or replace) the thumbnail for one cover id. Returns true on success.
async function makeThumb(coversDir, id) {
  if (!sharp) return false
  const src = findCover(coversDir, id)
  if (!src) return false
  fs.mkdirSync(thumbsDir(coversDir), { recursive: true })
  // Writes to a temp file first so a crash mid-encode can't leave a corrupt
  // thumb that the static server would happily serve forever.
  const tmp = thumbPath(coversDir, id) + '.tmp'
  await sharp(src)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(tmp)
  fs.renameSync(tmp, thumbPath(coversDir, id))
  return true
}

// One-time pass over covers/ for libraries that predate thumbnails. Yields via
// setImmediate so the server stays responsive; safe to re-run (skips existing).
async function backfillThumbs(coversDir, onProgress) {
  let files = []
  try { files = fs.readdirSync(coversDir) } catch { files = [] }
  const ids = [...new Set(
    files
      .map(f => f.match(/^(.+)\.(jpg|jpeg|png|webp|gif)$/i))
      .filter(Boolean)
      .map(m => m[1])
  )].filter(id => !fs.existsSync(thumbPath(coversDir, id)))

  const total = ids.length
  let done = 0, success = 0
  for (const id of ids) {
    try { if (await makeThumb(coversDir, id)) success++ } catch { /* unreadable image — skip */ }
    done++
    onProgress?.({ current: done, total, success })
    await new Promise(r => setImmediate(r))
  }
  return { total, success }
}

module.exports = { makeThumb, backfillThumbs, thumbPath, findCover, THUMB_WIDTH }
