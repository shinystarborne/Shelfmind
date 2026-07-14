import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Pinned to pdfjs-dist 4.x: v5/v6 call browser APIs (Promise.try, URL.parse)
// that this app's bundled Electron/Chromium version predates.
GlobalWorkerOptions.workerSrc = workerUrl

const TARGET_WIDTH = 400

// Renders page 1 of a PDF (served from fileUrl) to a JPEG data URL for use as a cover.
export async function renderPdfThumbnail(fileUrl) {
  const pdf  = await getDocument({ url: fileUrl }).promise
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width })

  const canvas = document.createElement('canvas')
  canvas.width  = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.82)
}
