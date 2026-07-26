// pdfjs-dist is ESM-only. The legacy Node build works without a worker (no
// GlobalWorkerOptions.workerSrc needed here — that's only for the browser
// bundle in src/, which has an actual worker asset to point at).
let promise = null
function loadPdfjs() {
  if (!promise) promise = import('pdfjs-dist/legacy/build/pdf.mjs')
  return promise
}

module.exports = { loadPdfjs }
