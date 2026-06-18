const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')
const { XMLParser } = require('fast-xml-parser')

const SUPPORTED_EXTS = new Set(['.epub', '.mobi', '.fb2', '.zip'])
const SKIP_DIRS = new Set([
  'shelfmind', '.git', 'node_modules',
  '$RECYCLE.BIN', 'System Volume Information', 'release', 'dist',
  '_Removed',   // books moved out of library via ShelfMind
])

function bookId(filePath) {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)
}

const xmlParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  removeNSPrefix:      true,   // strip opf:, dc: etc. so namespaced OPFs parse identically
  isArray: name => ['creator', 'subject', 'item', 'itemref', 'meta'].includes(name),
  trimValues: true,
})

function extractText(val) {
  if (!val) return ''
  if (typeof val === 'string' || typeof val === 'number') return String(val)
  if (typeof val === 'object') return val['#text'] || val['_'] || val['__text'] || ''
  return ''
}

function stripHtml(str) {
  if (!str) return ''
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim()
}

function findZipEntry(zip, href, opfDir) {
  // Try every path combination — epub dirs are inconsistent
  const candidates = [
    opfDir ? `${opfDir}/${href}` : href,
    href,
    href.replace(/^\.\//, ''),
    opfDir ? `${opfDir}/${href.replace(/^\.\//, '')}` : null,
  ].filter(Boolean)
  for (const p of candidates) {
    const e = zip.getEntry(p)
    if (e) return e
  }
  // Last resort: match by filename
  const basename = href.split('/').pop()
  return zip.getEntries().find(e => e.entryName.endsWith('/' + basename) || e.entryName === basename) || null
}

function parseCoverEntry(zip, items, opfDir, metas) {
  const imageItems = items.filter(i => i?.['@_media-type']?.startsWith('image/'))

  // Strategy 1: epub3 cover-image property
  let coverItem = items.find(i => i?.['@_properties'] === 'cover-image')

  // Strategy 2: <meta name="cover" content="item-id"/> (Calibre, many Russian epubs)
  if (!coverItem && metas) {
    const metaArr = Array.isArray(metas) ? metas : [metas]
    const coverMeta = metaArr.find(m => m?.['@_name'] === 'cover')
    if (coverMeta) {
      const coverId = coverMeta['@_content']
      coverItem = items.find(i => i?.['@_id'] === coverId)
    }
  }

  // Strategy 3: id or href contains "cover"
  if (!coverItem) {
    coverItem = imageItems.find(i =>
      i?.['@_id']?.toLowerCase().includes('cover') ||
      i?.['@_href']?.toLowerCase().includes('cover')
    )
  }

  // Strategy 4: first image in manifest
  if (!coverItem) coverItem = imageItems[0]

  if (!coverItem?.['@_href']) return null

  const entry = findZipEntry(zip, coverItem['@_href'], opfDir)
  if (!entry) return null

  const data = entry.getData()
  if (data.length > 15_000_000) return null  // skip if >15 MB
  if (data.length < 100)       return null  // skip placeholder stubs
  const mime = coverItem['@_media-type'] || 'image/jpeg'
  return `data:${mime};base64,${data.toString('base64')}`
}

function parseEpub(filePath) {
  try {
    const zip = new AdmZip(filePath)

    const containerEntry = zip.getEntry('META-INF/container.xml')
    if (!containerEntry) return null

    const container    = xmlParser.parse(containerEntry.getData().toString('utf8'))
    const rootfilePath = container?.container?.rootfiles?.rootfile?.['@_full-path']
    if (!rootfilePath) return null

    const opfEntry = zip.getEntry(rootfilePath)
    if (!opfEntry) return null

    const opf      = xmlParser.parse(opfEntry.getData().toString('utf8'))
    const pkg      = opf?.package
    const metadata = pkg?.metadata
    if (!metadata) return null

    // With removeNSPrefix:true, dc:title → title, dc:creator → creator, etc.
    const title = extractText(metadata['title'] || metadata['dc:title']) || ''

    const creatorRaw = Array.isArray(metadata['creator'] || metadata['dc:creator'])
      ? (metadata['creator'] || metadata['dc:creator'])
      : (metadata['creator'] || metadata['dc:creator'])
        ? [metadata['creator'] || metadata['dc:creator']] : []
    const author = creatorRaw.map(c => extractText(c)).filter(Boolean).join(', ')

    const language = extractText(metadata['language'] || metadata['dc:language']) || ''

    const subjectRaw = Array.isArray(metadata['subject'] || metadata['dc:subject'])
      ? (metadata['subject'] || metadata['dc:subject'])
      : (metadata['subject'] || metadata['dc:subject'])
        ? [metadata['subject'] || metadata['dc:subject']] : []
    const subjects = subjectRaw.map(s => extractText(s)).filter(Boolean)

    const description = stripHtml(extractText(metadata['description'] || metadata['dc:description'])) || ''

    // Series (Calibre meta tags)
    let seriesName = ''
    let seriesNum  = null
    const metas = Array.isArray(metadata['meta']) ? metadata['meta'] : metadata['meta'] ? [metadata['meta']] : []
    for (const m of metas) {
      const name    = m['@_name']    || ''
      const content = m['@_content'] || extractText(m) || ''
      if (name === 'calibre:series')       seriesName = content
      if (name === 'calibre:series_index') seriesNum  = parseFloat(content)
    }

    const opfDir     = rootfilePath.includes('/') ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/')) : ''
    const items      = Array.isArray(pkg?.manifest?.item) ? pkg.manifest.item : pkg?.manifest?.item ? [pkg.manifest.item] : []
    const coverData  = parseCoverEntry(zip, items, opfDir, metas)

    return { title, author, language, subjects, description, seriesName, seriesNum, coverData }
  } catch {
    return null
  }
}

function parseFilename(filePath) {
  const name = path.basename(filePath, path.extname(filePath))
  const byMatch = name.match(/^(.+?)\s+by\s+(.+?)(?:\s*[\[\(].*)?$/i)
  if (byMatch) return { title: byMatch[1].trim(), author: byMatch[2].trim() }
  const dashMatch = name.match(/^([^-]{3,50})\s*[-–]\s*(.{3,})$/)
  if (dashMatch) return { title: dashMatch[2].trim(), author: dashMatch[1].trim() }
  return { title: name, author: '' }
}

function walkDir(dirPath) {
  const results = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) results.push(...walkDir(path.join(dirPath, e.name)))
      } else if (e.isFile() && SUPPORTED_EXTS.has(path.extname(e.name).toLowerCase())) {
        results.push(path.join(dirPath, e.name))
      }
    }
  } catch { /* skip inaccessible */ }
  return results
}

async function scan(store, libraryPath, onProgress) {
  const allFiles  = walkDir(libraryPath)
  const total     = allFiles.length
  const prevMtimes = store.getExistingPathMtimes()
  const foundPaths = new Set()

  const batch = []   // collect entries before bulk-save
  let added   = 0
  let processed = 0

  for (const filePath of allFiles) {
    foundPaths.add(filePath)

    let stats
    try { stats = fs.statSync(filePath) } catch { continue }
    const mtime = Math.floor(stats.mtimeMs)

    // Skip if unchanged
    if (prevMtimes.has(filePath) && prevMtimes.get(filePath) === mtime) {
      onProgress?.({ current: ++processed, total, added })
      continue
    }

    const ext  = path.extname(filePath).toLowerCase().slice(1)
    let meta   = ext === 'epub' ? parseEpub(filePath) : null
    const coverDataUrl = meta?.coverData || null
    if (meta) delete meta.coverData  // keep book obj lean

    if (!meta?.title) {
      const fb = parseFilename(filePath)
      meta = {
        title:       fb.title,
        author:      meta?.author || fb.author,
        language:    meta?.language    || '',
        subjects:    meta?.subjects    || [],
        description: meta?.description || '',
        seriesName:  meta?.seriesName  || '',
        seriesNum:   meta?.seriesNum   ?? null,
      }
    }

    batch.push({
      book: {
        id:          bookId(filePath),
        path:        filePath,
        title:       meta.title,
        author:      meta.author      || '',
        language:    meta.language    || '',
        format:      ext,
        file_size:   stats.size,
        file_mtime:  mtime,
        subjects:    meta.subjects    || [],
        description: meta.description || '',
        series_name: meta.seriesName  || '',
        series_num:  meta.seriesNum   ?? null,
        added_at:    Math.floor(Date.now() / 1000),
        removed:     false,
        enriched:    false,
      },
      coverDataUrl,
    })

    added++
    onProgress?.({ current: ++processed, total, added })
  }

  // Bulk save all new/changed books
  if (batch.length > 0) store.batchUpsert(batch)

  // Soft-delete files that disappeared
  let removed = 0
  for (const [filePath] of prevMtimes) {
    if (!foundPaths.has(filePath)) {
      store.markRemoved(filePath)
      removed++
    }
  }
  if (removed > 0) store.flushBooks()

  // Cover-extraction pass for existing EPUBs that have no cover yet
  // (catches books scanned before cover extraction was improved, or with the old namespaced-OPF bug)
  const noCover = store.getBooksNeedingCovers().filter(b => !batch.some(e => e.book.id === b.id))
  for (const book of noCover) {
    try {
      const parsed = parseEpub(book.path)
      if (parsed?.coverData) {
        store.setCover(book.id, parsed.coverData)
      }
    } catch { /* skip */ }
  }

  return { total: allFiles.length, added, removed }
}

function getEpubImages(filePath) {
  try {
    const zip = new AdmZip(filePath)
    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' }
    const results = []
    for (const entry of zip.getEntries()) {
      const name = entry.entryName
      const ext  = path.extname(name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const data = entry.getData()
      if (data.length < 100 || data.length > 15_000_000) continue
      const mime = MIME[ext] || 'image/jpeg'
      results.push({
        name:    path.basename(name),
        path:    name,
        size:    data.length,
        dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      })
    }
    // Sort: anything with "cover" in the name first, then by size descending
    results.sort((a, b) => {
      const ac = a.name.toLowerCase().includes('cover') ? 0 : 1
      const bc = b.name.toLowerCase().includes('cover') ? 0 : 1
      if (ac !== bc) return ac - bc
      return b.size - a.size
    })
    return results
  } catch {
    return []
  }
}

module.exports = { scan, parseEpub, getEpubImages }
