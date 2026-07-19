// Reads epub internals for the in-app reader: spine (reading order), table of
// contents, and raw resource files served straight out of the zip.
const fs     = require('fs')
const AdmZip = require('adm-zip')
const { XMLParser } = require('fast-xml-parser')

const xmlParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  removeNSPrefix:      true,
  isArray: name => ['item', 'itemref', 'navPoint', 'li', 'nav', 'meta'].includes(name),
  trimValues: true,
})

const MIME = {
  '.xhtml': 'application/xhtml+xml', '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.ncx': 'application/x-dtbncx+xml', '.opf': 'application/oebps-package+xml',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
}

function extOf(p) {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i).toLowerCase() : ''
}

// Resolve href relative to the directory of baseFile (both zip-internal paths).
// Handles ./  ../  url-encoding, and strips any #fragment (returned separately).
function resolveHref(baseFile, href) {
  if (!href) return { path: '', fragment: '' }
  const hashIdx  = href.indexOf('#')
  const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : ''
  let rel = hashIdx >= 0 ? href.slice(0, hashIdx) : href
  try { rel = decodeURIComponent(rel) } catch { /* keep raw */ }
  if (!rel) return { path: baseFile, fragment }

  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : ''
  const parts   = (baseDir ? baseDir.split('/') : [])
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return { path: parts.join('/'), fragment }
}

function findEntry(zip, innerPath) {
  let e = zip.getEntry(innerPath)
  if (e) return e
  // Case-insensitive fallback — some epubs disagree with their own manifests
  const lower = innerPath.toLowerCase()
  return zip.getEntries().find(en => en.entryName.toLowerCase() === lower) || null
}

// ── NCX (epub2) toc ──────────────────────────────────────────────────────────
function parseNcxToc(zip, ncxPath) {
  const entry = findEntry(zip, ncxPath)
  if (!entry) return []
  const ncx = xmlParser.parse(entry.getData().toString('utf8'))
  const navMap = ncx?.ncx?.navMap
  if (!navMap) return []

  const text = v => {
    if (!v) return ''
    if (typeof v === 'string' || typeof v === 'number') return String(v)
    return v['#text'] || ''
  }
  const walk = (points) => (points || []).map(p => ({
    label:    text(p?.navLabel?.text) || 'Untitled',
    href:     resolveHref(ncxPath, p?.content?.['@_src'] || '').path,
    fragment: resolveHref(ncxPath, p?.content?.['@_src'] || '').fragment,
    children: walk(p?.navPoint),
  })).filter(t => t.href)
  return walk(navMap.navPoint)
}

// ── nav.xhtml (epub3) toc ────────────────────────────────────────────────────
function parseNavToc(zip, navPath) {
  const entry = findEntry(zip, navPath)
  if (!entry) return []
  const doc = xmlParser.parse(entry.getData().toString('utf8'))

  // Find the <nav epub:type="toc"> anywhere in the document
  let tocNav = null
  const hunt = (node) => {
    if (!node || typeof node !== 'object' || tocNav) return
    if (node.nav) {
      for (const n of (Array.isArray(node.nav) ? node.nav : [node.nav])) {
        if ((n?.['@_type'] || '').includes('toc')) { tocNav = n; return }
      }
      if (!tocNav) tocNav = (Array.isArray(node.nav) ? node.nav[0] : node.nav)
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith('@_')) continue
      hunt(node[k])
    }
  }
  hunt(doc)
  if (!tocNav) return []

  const text = v => {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim()
    if (Array.isArray(v)) return v.map(text).join(' ').trim()
    let out = v['#text'] != null ? String(v['#text']) : ''
    for (const k of Object.keys(v)) {
      if (k.startsWith('@_') || k === '#text') continue
      out += ' ' + text(v[k])
    }
    return out.trim()
  }

  const walkOl = (ol) => {
    if (!ol) return []
    const items = []
    for (const li of (Array.isArray(ol.li) ? ol.li : ol.li ? [ol.li] : [])) {
      const a = Array.isArray(li?.a) ? li.a[0] : li?.a
      const span = li?.span
      const href = a?.['@_href'] || ''
      const { path, fragment } = resolveHref(navPath, href)
      const node = {
        label:    text(a) || text(span) || 'Untitled',
        href:     path,
        fragment,
        children: walkOl(Array.isArray(li?.ol) ? li.ol[0] : li?.ol),
      }
      if (node.href || node.children.length) items.push(node)
    }
    return items
  }
  return walkOl(Array.isArray(tocNav.ol) ? tocNav.ol[0] : tocNav.ol)
}

// ── Structure (cached per path+mtime) ────────────────────────────────────────
const cache = new Map()  // filePath → { mtime, zip, structure }
const CACHE_MAX = 4

function openBook(filePath) {
  const mtime  = fs.statSync(filePath).mtimeMs
  const cached = cache.get(filePath)
  if (cached && cached.mtime === mtime) return cached

  const zip = new AdmZip(filePath)

  const container    = xmlParser.parse(zip.getEntry('META-INF/container.xml').getData().toString('utf8'))
  const rootfilePath = container?.container?.rootfiles?.rootfile?.['@_full-path']
  const opf          = xmlParser.parse(zip.getEntry(rootfilePath).getData().toString('utf8'))
  const pkg          = opf?.package

  const items = Array.isArray(pkg?.manifest?.item) ? pkg.manifest.item : []
  const byId  = {}
  for (const it of items) { if (it?.['@_id']) byId[it['@_id']] = it }

  const spineRefs = Array.isArray(pkg?.spine?.itemref) ? pkg.spine.itemref : []
  const spine = []
  for (const ref of spineRefs) {
    if (ref?.['@_linear'] === 'no') continue
    const item = byId[ref?.['@_idref']]
    if (!item?.['@_href']) continue
    const { path: entryPath } = resolveHref(rootfilePath, item['@_href'])
    const entry = findEntry(zip, entryPath)
    if (!entry) continue
    spine.push({
      href: entry.entryName,
      size: entry.header.size || 1,
    })
  }

  // TOC: epub3 nav first, fall back to NCX
  let toc = []
  const navItem = items.find(i => (i?.['@_properties'] || '').split(/\s+/).includes('nav'))
  if (navItem) {
    toc = parseNavToc(zip, resolveHref(rootfilePath, navItem['@_href']).path)
  }
  if (toc.length === 0) {
    const ncxId   = pkg?.spine?.['@_toc']
    const ncxItem = ncxId ? byId[ncxId] : items.find(i => i?.['@_media-type'] === 'application/x-dtbncx+xml')
    if (ncxItem) toc = parseNcxToc(zip, resolveHref(rootfilePath, ncxItem['@_href']).path)
  }

  const totalSize = spine.reduce((s, it) => s + it.size, 0) || 1

  const record = { mtime, zip, structure: { spine, toc, totalSize } }
  cache.set(filePath, record)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)  // drop oldest
  return record
}

function getStructure(filePath) {
  return openBook(filePath).structure
}

function getResource(filePath, innerPath) {
  const { zip } = openBook(filePath)
  let clean = innerPath.replace(/^\/+/, '')
  try { clean = decodeURIComponent(clean) } catch { /* keep raw */ }
  const entry = findEntry(zip, clean)
  if (!entry) return null
  return { data: entry.getData(), mime: MIME[extOf(clean)] || 'application/octet-stream' }
}

module.exports = { getStructure, getResource, resolveHref }
