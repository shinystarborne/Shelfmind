import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Same pin as pdfThumbnail.js: pdfjs-dist 4.x for this Electron's Chromium.
GlobalWorkerOptions.workerSrc = workerUrl

const TEXT_MIN_WORDS = 50    // below this the "text layer" is junk/empty → vision path
const TEXT_PAGES     = 3
const IMAGE_PAGES    = 2
const IMAGE_WIDTH    = 768   // small enough for fast local vision inference

// Builds the payload for POST /api/pdf-docs/:id/auto-tag: the first pages'
// text when the PDF has a real text layer (cheap), otherwise renders of the
// first pages for a vision model (scans). disableAutoFetch/disableStream keep
// pdf.js from pulling the whole file; the document is always destroyed.
export async function buildTagPayload(fileUrl) {
  const pdf = await getDocument({ url: fileUrl, disableAutoFetch: true, disableStream: true }).promise
  try {
    const parts = []
    for (let p = 1; p <= Math.min(TEXT_PAGES, pdf.numPages); p++) {
      try {
        const page = await pdf.getPage(p)
        const tc   = await page.getTextContent()
        parts.push(tc.items.map(it => it.str).join(' '))
      } catch { /* unreadable page — treated as no text */ }
    }
    const text = parts.join('\n').trim()
    if (text.split(/\s+/).filter(Boolean).length >= TEXT_MIN_WORDS) return { text }

    const images = []
    for (let p = 1; p <= Math.min(IMAGE_PAGES, pdf.numPages); p++) {
      const page = await pdf.getPage(p)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: IMAGE_WIDTH / base.width })
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      images.push(canvas.toDataURL('image/jpeg', 0.8))
    }
    return { images }
  } finally {
    await pdf.destroy()
  }
}

// True when the doc still needs tagging (never tagged, or last attempt failed).
export function needsTagging(doc) {
  return !doc.auto?.tagged_at || doc.auto.failed
}
