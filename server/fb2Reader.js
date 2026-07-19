// FB2 support for the in-app reader: converts FictionBook XML into HTML
// chapters (one per top-level section) plus embedded binary images.
// Handles the windows-1251 encoding common in Russian fb2 files, and
// .fb2.zip / .zip archives containing a single .fb2.
const fs     = require('fs')
const AdmZip = require('adm-zip')
const iconv  = require('iconv-lite')
const { XMLParser } = require('fast-xml-parser')

// preserveOrder keeps mixed content (text + inline tags) in document order;
// trimValues:false keeps the spaces around <emphasis> etc. intact.
const orderedParser = new XMLParser({
  preserveOrder:       true,
  ignoreAttributes:    false,
  attributeNamePrefix: '',
  removeNSPrefix:      true,
  trimValues:          false,
})

// ── Loading & encoding ───────────────────────────────────────────────────────
function loadFb2Xml(filePath) {
  let buf
  if (/\.zip$/i.test(filePath)) {
    const zip = new AdmZip(filePath)
    const entry = zip.getEntries().find(e => /\.fb2$/i.test(e.entryName))
    if (!entry) throw new Error('No .fb2 file inside this zip')
    buf = entry.getData()
  } else {
    buf = fs.readFileSync(filePath)
  }
  // Sniff the XML declaration for the encoding
  const head = buf.slice(0, 200).toString('latin1')
  const m = head.match(/encoding\s*=\s*["']([\w-]+)["']/i)
  const enc = (m?.[1] || 'utf-8').toLowerCase()
  if (enc === 'utf-8' || enc === 'utf8') return buf.toString('utf8')
  if (iconv.encodingExists(enc)) return iconv.decode(buf, enc)
  return buf.toString('utf8')
}

// ── preserveOrder helpers ────────────────────────────────────────────────────
const tagOf    = (node) => Object.keys(node).find(k => k !== ':@' && k !== '#text')
const attrsOf  = (node) => node[':@'] || {}
const childrenOf = (node) => { const t = tagOf(node); return t ? node[t] : [] }
const hrefOf   = (attrs) => attrs['href'] || attrs['l:href'] || attrs['xlink:href'] || ''

function textOf(nodes) {
  let out = ''
  for (const n of nodes || []) {
    if ('#text' in n) out += String(n['#text'])
    else out += textOf(childrenOf(n))
  }
  return out.replace(/\s+/g, ' ').trim()
}

function findAll(nodes, tag, out = []) {
  for (const n of nodes || []) {
    if (tagOf(n) === tag) out.push(n)
    else if (tagOf(n)) findAll(childrenOf(n), tag, out)
  }
  return out
}

function findFirst(nodes, tag) {
  for (const n of nodes || []) {
    if (tagOf(n) === tag) return n
  }
  return null
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── FB2 → HTML ───────────────────────────────────────────────────────────────
// Block/inline tag mapping. Unknown tags render their children transparently.
const TAG_HTML = {
  'p':           ['p', ''],
  'v':           ['p', 'fb2-v'],
  'subtitle':    ['h3', 'fb2-subtitle'],
  'text-author': ['p', 'fb2-text-author'],
  'date':        ['p', 'fb2-date'],
  'epigraph':    ['blockquote', 'fb2-epigraph'],
  'cite':        ['blockquote', 'fb2-cite'],
  'poem':        ['div', 'fb2-poem'],
  'stanza':      ['div', 'fb2-stanza'],
  'annotation':  ['div', 'fb2-annotation'],
  'emphasis':    ['em', ''],
  'strong':      ['strong', ''],
  'strikethrough': ['s', ''],
  'sub':         ['sub', ''],
  'sup':         ['sup', ''],
  'code':        ['code', ''],
  'style':       ['span', ''],
  'table':       ['table', ''],
  'tr':          ['tr', ''],
  'th':          ['th', ''],
  'td':          ['td', ''],
}

function renderNodes(nodes, ctx, depth = 0) {
  let html = ''
  for (const n of nodes || []) {
    if ('#text' in n) { html += esc(n['#text']); continue }
    const tag   = tagOf(n)
    const attrs = attrsOf(n)
    const kids  = childrenOf(n)
    const id    = attrs.id ? ` id="${esc(attrs.id)}"` : ''

    if (tag === 'empty-line') { html += '<div class="fb2-empty-line"></div>'; continue }
    if (tag === 'image') {
      const ref = hrefOf(attrs).replace(/^#/, '')
      if (ref && ctx.binaries[ref]) html += `<img${id} src="bin/${encodeURIComponent(ref)}" alt=""/>`
      continue
    }
    if (tag === 'a') {
      const ref = hrefOf(attrs)
      if (ref.startsWith('#')) {
        const anchor  = ref.slice(1)
        const secHref = ctx.idToChapter[anchor] || ''
        html += `<a${id} href="${esc(secHref)}#${esc(anchor)}">${renderNodes(kids, ctx, depth)}</a>`
      } else if (ref) {
        html += `<a${id} href="${esc(ref)}">${renderNodes(kids, ctx, depth)}</a>`
      } else {
        html += renderNodes(kids, ctx, depth)
      }
      continue
    }
    if (tag === 'title') {
      const h = depth === 0 ? 'h1' : depth === 1 ? 'h2' : 'h3'
      html += `<${h}${id} class="fb2-title">${renderNodes(kids, ctx, depth)}</${h}>`
      continue
    }
    if (tag === 'section') {
      html += `<section${id}>${renderNodes(kids, ctx, depth + 1)}</section>`
      continue
    }
    const map = TAG_HTML[tag]
    if (map) {
      const [el, cls] = map
      html += `<${el}${id}${cls ? ` class="${cls}"` : ''}>${renderNodes(kids, ctx, depth)}</${el}>`
    } else {
      // Unknown tag — render contents transparently
      html += renderNodes(kids, ctx, depth)
    }
  }
  return html
}

const FB2_CSS = `
  .fb2-title { text-align: center; }
  .fb2-subtitle { text-align: center; font-style: italic; }
  .fb2-epigraph { margin: 1em 0 1em 20%; font-style: italic; border: none; }
  .fb2-cite { margin: 1em 5%; font-style: italic; }
  .fb2-poem { margin: 1em 0 1em 10%; }
  .fb2-v { margin: 0; text-align: left; }
  .fb2-text-author { text-align: right; font-style: italic; }
  .fb2-date { text-align: center; font-style: italic; }
  .fb2-empty-line { height: 1em; }
  img { display: block; margin: 0.5em auto; }
`

// Collect every id attribute below the given nodes
function collectIds(nodes, out) {
  for (const n of nodes || []) {
    if ('#text' in n) continue
    const id = attrsOf(n).id
    if (id) out.push(id)
    collectIds(childrenOf(n), out)
  }
}

// ── Book model (cached per path + mtime) ─────────────────────────────────────
const cache = new Map()
const CACHE_MAX = 4

function openFb2(filePath) {
  const mtime  = fs.statSync(filePath).mtimeMs
  const cached = cache.get(filePath)
  if (cached && cached.mtime === mtime) return cached

  const xml    = loadFb2Xml(filePath)
  const parsed = orderedParser.parse(xml)
  const fbNode = parsed.find(n => tagOf(n) === 'FictionBook')
  if (!fbNode) throw new Error('Not a FictionBook file')
  const fb = childrenOf(fbNode)

  // Binaries: id → { mime, buf }
  const binaries = {}
  for (const b of fb.filter(n => tagOf(n) === 'binary')) {
    const a = attrsOf(b)
    if (!a.id) continue
    const b64 = textOf(childrenOf(b)).replace(/\s+/g, '')
    try {
      binaries[a.id] = { mime: a['content-type'] || 'image/jpeg', buf: Buffer.from(b64, 'base64') }
    } catch { /* skip broken binary */ }
  }

  // Chapters: per top-level section of each body. Body-level title/epigraphs
  // (and section-less bodies) become their own chapter.
  const bodies = fb.filter(n => tagOf(n) === 'body')
  const rawChapters = []   // { label, nodes, depth0 }
  for (const body of bodies) {
    const kids       = childrenOf(body)
    const bodyName   = attrsOf(body).name || ''
    const sections   = kids.filter(n => tagOf(n) === 'section')
    const preamble   = kids.filter(n => ['title', 'epigraph', 'image'].includes(tagOf(n)))
    const bodyTitle  = textOf(childrenOf(findFirst(kids, 'title') || { x: [] }))

    if (sections.length === 0) {
      rawChapters.push({ label: bodyTitle || bodyName || 'Text', nodes: kids })
      continue
    }
    if (preamble.length > 0) {
      rawChapters.push({ label: bodyTitle || bodyName || 'Title', nodes: preamble })
    }
    for (const sec of sections) {
      const secTitle = textOf(childrenOf(findFirst(childrenOf(sec), 'title') || { x: [] }))
      // Keep the <section> node itself so its id attribute (footnote anchors
      // point at it) survives into the rendered HTML.
      rawChapters.push({
        label: secTitle || bodyName || `Section ${rawChapters.length + 1}`,
        nodes: [sec],
      })
    }
  }
  if (rawChapters.length === 0) throw new Error('No readable content found')

  // Map every anchor id to the chapter file that contains it (for note links)
  const idToChapter = {}
  rawChapters.forEach((ch, i) => {
    const ids = []
    collectIds(ch.nodes, ids)
    for (const id of ids) idToChapter[id] = `sec-${i}.html`
  })

  const ctx = { binaries, idToChapter }
  const chapters = rawChapters.map((ch, i) => {
    const body = renderNodes(ch.nodes, ctx, 0)
    return {
      href:  `sec-${i}.html`,
      label: ch.label,
      html:  `<html><head><style>${FB2_CSS}</style></head><body>${body}</body></html>`,
    }
  })

  const structure = {
    spine: chapters.map(c => ({ href: c.href, size: c.html.length })),
    toc:   chapters.map(c => ({ label: c.label, href: c.href, fragment: '', children: [] })),
    totalSize: chapters.reduce((s, c) => s + c.html.length, 0) || 1,
  }

  const record = { mtime, structure, chapters, binaries }
  cache.set(filePath, record)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return record
}

function getStructure(filePath) {
  return openFb2(filePath).structure
}

function getResource(filePath, innerPath) {
  const book = openFb2(filePath)
  let clean = innerPath.replace(/^\/+/, '')
  try { clean = decodeURIComponent(clean) } catch { /* keep raw */ }
  if (clean.startsWith('bin/')) {
    const bin = book.binaries[clean.slice(4)]
    if (!bin) return null
    return { data: bin.buf, mime: bin.mime }
  }
  const ch = book.chapters.find(c => c.href === clean)
  if (!ch) return null
  return { data: Buffer.from(ch.html, 'utf8'), mime: 'text/html' }
}

// ── Metadata for the library scanner ─────────────────────────────────────────
function parseFb2Meta(filePath) {
  try {
    const xml    = loadFb2Xml(filePath)
    const parsed = orderedParser.parse(xml)
    const fbNode = parsed.find(n => tagOf(n) === 'FictionBook')
    if (!fbNode) return null
    const fb    = childrenOf(fbNode)
    const desc  = findFirst(fb, 'description')
    const tInfo = desc ? findFirst(childrenOf(desc), 'title-info') : null
    if (!tInfo) return null
    const ti = childrenOf(tInfo)

    const title = textOf(childrenOf(findFirst(ti, 'book-title') || { x: [] }))
    const authors = ti.filter(n => tagOf(n) === 'author').map(a => {
      const ak = childrenOf(a)
      const first = textOf(childrenOf(findFirst(ak, 'first-name') || { x: [] }))
      const last  = textOf(childrenOf(findFirst(ak, 'last-name')  || { x: [] }))
      const nick  = textOf(childrenOf(findFirst(ak, 'nickname')   || { x: [] }))
      return [first, last].filter(Boolean).join(' ') || nick
    }).filter(Boolean)
    const language = textOf(childrenOf(findFirst(ti, 'lang') || { x: [] }))
    const genres   = ti.filter(n => tagOf(n) === 'genre').map(g => textOf(childrenOf(g))).filter(Boolean)
    const annotation = textOf(childrenOf(findFirst(ti, 'annotation') || { x: [] }))
    const seq      = findFirst(ti, 'sequence')
    const seriesName = seq ? (attrsOf(seq).name || '') : ''
    const seriesNum  = seq && attrsOf(seq).number ? parseFloat(attrsOf(seq).number) : null

    // Cover: <coverpage><image l:href="#cover"/></coverpage> → binary
    let coverData = null
    const coverpage = findFirst(ti, 'coverpage')
    if (coverpage) {
      const img = findFirst(childrenOf(coverpage), 'image')
      const ref = img ? hrefOf(attrsOf(img)).replace(/^#/, '') : ''
      if (ref) {
        for (const b of fb.filter(n => tagOf(n) === 'binary')) {
          const a = attrsOf(b)
          if (a.id === ref) {
            const b64 = textOf(childrenOf(b)).replace(/\s+/g, '')
            if (b64.length > 100) coverData = `data:${a['content-type'] || 'image/jpeg'};base64,${b64}`
            break
          }
        }
      }
    }

    return {
      title, author: authors.join(', '), language,
      subjects: genres, description: annotation,
      seriesName, seriesNum, coverData,
    }
  } catch {
    return null
  }
}

module.exports = { getStructure, getResource, parseFb2Meta, openFb2 }
