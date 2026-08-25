import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Pinned to pdfjs-dist 4.x: v5/v6 call browser APIs (Promise.try, URL.parse)
// that this app's bundled Electron/Chromium version predates.
GlobalWorkerOptions.workerSrc = workerUrl

const TARGET_WIDTH = 400

// A grid can mount hundreds of PdfCards at once (e.g. a 691-doc tab). Without
// a cap, every coverless card starts a pdf.js load simultaneously and the
// renderer runs out of memory. Two at a time is plenty for cache warming.
const MAX_CONCURRENT = 2
let active = 0
const queue = []

function runNext() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return
  active++
  const { job, resolve, reject } = queue.shift()
  job().then(resolve, reject).finally(() => { active--; runNext() })
}

function enqueue(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject })
    runNext()
  })
}

// Renders page 1 of a PDF (served from fileUrl) to a JPEG data URL for use as a cover.
// disableAutoFetch/disableStream keep pdf.js from pulling the whole file into
// memory — with range-capable serving (Express sendFile) it fetches only what
// page 1 needs. The document is always destroyed afterwards so neither the
// parsed PDF nor the worker-side cache leaks per thumbnail.
async function renderNow(fileUrl) {
  const pdf = await getDocument({ url: fileUrl, disableAutoFetch: true, disableStream: true }).promise
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width })

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    await pdf.destroy()
  }
}

export function renderPdfThumbnail(fileUrl) {
  return enqueue(() => renderNow(fileUrl))
}
