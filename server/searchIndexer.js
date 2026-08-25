// Background "build search index" job — mirrors enricher.js's enrichAll shape,
// but this is 100% local CPU/disk work (no rate limit needed; a setImmediate
// yield after each item keeps the server responsive to status polling instead).
const { getReaderStructure, getReaderResource, formatOf } = require('./readerFormats')
const { htmlToPlainText } = require('./textExtract')
const { loadPdfjs } = require('./pdfNode')
const fs = require('fs')

async function extractBookText(book) {
  if (!formatOf(book)) return null
  const st = await getReaderStructure(book)
  const chapters = []
  for (let i = 0; i < st.spine.length; i++) {
    try {
      const r = await getReaderResource(book, st.spine[i].href)
      chapters.push({ spine: i, text: htmlToPlainText(r.data.toString('utf8')) })
    } catch {
      chapters.push({ spine: i, text: '' })
    }
  }
  return { chapters }
}

async function extractPdfText(filePath) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(fs.readFileSync(filePath))
  const doc  = await pdfjs.getDocument({ data }).promise
  const pages = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p)
        const tc   = await page.getTextContent()
        pages.push({ page: p, text: tc.items.map(it => it.str).join(' ') })
        page.cleanup()
      } catch {
        pages.push({ page: p, text: '' })
      }
    }
  } finally {
    await doc.destroy()
  }
  return { pages }
}

async function indexOne(store, kind, item) {
  try {
    const data = kind === 'book'
      ? await extractBookText(item)
      : await extractPdfText(item.path)
    if (!data) { store.markTextIndexed(kind, item.id, false); return false }
    if (kind === 'book') store.saveSearchText(item.id, { mtime: Date.now(), ...data })
    else                 store.savePdfSearchText(item.id, { mtime: Date.now(), ...data })
    store.markTextIndexed(kind, item.id, true)
    return true
  } catch {
    store.markTextIndexed(kind, item.id, false)
    return false
  }
}

async function indexAll(store, onProgress, force = false) {
  // PDF text extraction is heavy (whole file read + parse per doc) and useless
  // for image-only PDFs like scanned patterns — gated behind a preference.
  const indexPdfs = store.getPref('index_pdf_text') !== false
  const items = [
    ...store.getUnindexedBooks(force).map(b => ({ kind: 'book', item: b })),
    ...(indexPdfs ? store.getUnindexedPdfDocs(force).map(d => ({ kind: 'pdf', item: d })) : []),
  ]
  const total = items.length
  let done = 0, success = 0

  for (const { kind, item } of items) {
    const ok = await indexOne(store, kind, item)
    if (ok) success++
    done++
    onProgress?.({ current: done, total, success })
    await new Promise(r => setImmediate(r))
  }

  return { total, success }
}

module.exports = { extractBookText, extractPdfText, indexAll }
