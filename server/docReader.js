// Word document support for the in-app reader (read-only).
// .docx → HTML via mammoth (images inlined as data URIs).
// .doc  → plain text via word-extractor, wrapped into paragraphs.
const fs = require('fs')

const cache = new Map()
const CACHE_MAX = 4

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const DOC_CSS = `
  h1, h2, h3 { text-align: center; }
  img { display: block; margin: 0.5em auto; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid currentColor; padding: 4px 8px; }
`

async function convert(filePath) {
  if (/\.docx$/i.test(filePath)) {
    const mammoth = require('mammoth')
    const result  = await mammoth.convertToHtml({ path: filePath })
    return result.value
  }
  const WordExtractor = require('word-extractor')
  const extracted = await new WordExtractor().extract(filePath)
  const text = extracted.getBody() || ''
  return text
    .split(/\r?\n/)
    .map(line => line.trim() ? `<p>${esc(line)}</p>` : '')
    .join('\n')
}

async function openDoc(filePath) {
  const mtime  = fs.statSync(filePath).mtimeMs
  const cached = cache.get(filePath)
  if (cached && cached.mtime === mtime) return cached

  const bodyHtml = await convert(filePath)
  if (!bodyHtml.trim()) throw new Error('No readable text found in this document')
  const html = `<html><head><style>${DOC_CSS}</style></head><body>${bodyHtml}</body></html>`

  const record = {
    mtime,
    html,
    structure: {
      spine:     [{ href: 'doc.html', size: html.length }],
      toc:       [],
      totalSize: html.length || 1,
    },
  }
  cache.set(filePath, record)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return record
}

async function getStructure(filePath) {
  return (await openDoc(filePath)).structure
}

async function getResource(filePath, innerPath) {
  const book = await openDoc(filePath)
  const clean = innerPath.replace(/^\/+/, '')
  if (clean !== 'doc.html') return null
  return { data: Buffer.from(book.html, 'utf8'), mime: 'text/html' }
}

// Minimal metadata for the scanner: docx core properties (title/creator)
function parseDocxMeta(filePath) {
  try {
    const AdmZip = require('adm-zip')
    const { XMLParser } = require('fast-xml-parser')
    const zip   = new AdmZip(filePath)
    const entry = zip.getEntry('docProps/core.xml')
    if (!entry) return null
    const core = new XMLParser({ removeNSPrefix: true }).parse(entry.getData().toString('utf8'))
    const props = core?.coreProperties
    if (!props) return null
    const t = props.title
    const c = props.creator
    return {
      title:  typeof t === 'string' || typeof t === 'number' ? String(t) : '',
      author: typeof c === 'string' || typeof c === 'number' ? String(c) : '',
    }
  } catch {
    return null
  }
}

module.exports = { getStructure, getResource, parseDocxMeta }
