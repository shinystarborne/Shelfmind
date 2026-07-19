// Dispatches in-app reader requests to the right format module.
// A .zip is treated as fb2 if it contains one (the common .fb2.zip case),
// otherwise as an epub if it has an OPF container.
const AdmZip = require('adm-zip')

function formatOf(book) {
  const fmt = (book.format || '').toLowerCase()
  if (fmt === 'epub') return 'epub'
  if (fmt === 'fb2')  return 'fb2'
  if (fmt === 'doc' || fmt === 'docx') return 'doc'
  if (fmt === 'zip') {
    try {
      const zip = new AdmZip(book.path)
      if (zip.getEntries().some(e => /\.fb2$/i.test(e.entryName))) return 'fb2'
      if (zip.getEntry('META-INF/container.xml')) return 'epub'
    } catch { /* fall through */ }
  }
  return null
}

const MODULES = {
  epub: () => require('./epubReader'),
  fb2:  () => require('./fb2Reader'),
  doc:  () => require('./docReader'),
}

// Both may return promises (doc conversion is async) — callers await.
async function getReaderStructure(book) {
  const fmt = formatOf(book)
  if (!fmt) throw Object.assign(new Error(`Reading ${book.format} files is not supported`), { unsupported: true })
  return MODULES[fmt]().getStructure(book.path)
}

async function getReaderResource(book, innerPath) {
  const fmt = formatOf(book)
  if (!fmt) return null
  return MODULES[fmt]().getResource(book.path, innerPath)
}

module.exports = { getReaderStructure, getReaderResource, formatOf }
