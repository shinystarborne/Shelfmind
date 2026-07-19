// Converts books between formats, reusing the reader modules' HTML output as
// the intermediate representation:
//   fb2 / doc / docx → epub   (HTML chapters packaged into an EPUB3 zip)
//   epub / doc / docx → fb2   (HTML walked into FictionBook XML)
// The converted file is written next to the original; the original is untouched.
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
}
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
}

const escXml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// HTML named entities are not valid XML — decode to literal chars first,
// then re-escape the XML-significant ones.
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bdquo: '„',
  shy: '', copy: '©', reg: '®', trade: '™', deg: '°', sect: '§',
  middot: '·', bull: '•', dagger: '†', times: '×', minus: '−',
}
function decodeEntities(str) {
  const safe = code => { try { return String.fromCodePoint(code) } catch { return '' } }
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safe(parseInt(h, 16)))
    .replace(/&#(\d+);/g,         (_, d) => safe(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

const bodyOf = html => (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1]) ?? html
const cssOf  = html => (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1]) ?? ''

function outputPathFor(srcPath, ext) {
  const dir  = path.dirname(srcPath)
  const base = path.basename(srcPath).replace(/\.(fb2\.zip|zip|fb2|epub|docx|doc|mobi)$/i, '')
  let out = path.join(dir, `${base}.${ext}`)
  if (fs.existsSync(out)) out = path.join(dir, `${base} (converted).${ext}`)
  if (fs.existsSync(out)) out = path.join(dir, `${base}_${Date.now()}.${ext}`)
  return out
}

function readCoverFile(coverFile) {
  if (!coverFile || !fs.existsSync(coverFile)) return null
  const mime = EXT_MIME[path.extname(coverFile).toLowerCase()]
  if (!mime) return null
  try { return { data: fs.readFileSync(coverFile), mime } } catch { return null }
}

// ── Source → HTML chapters (for the EPUB target) ─────────────────────────────

async function sourceChaptersForEpub(book, srcFmt) {
  if (srcFmt === 'fb2') {
    const { openFb2 } = require('./fb2Reader')
    const rec = openFb2(book.path)

    const images   = []
    const idToFile = {}
    let n = 0
    for (const [id, bin] of Object.entries(rec.binaries)) {
      const fname = `bin-${n++}.${MIME_EXT[bin.mime] || 'jpg'}`
      idToFile[id] = fname
      images.push({ href: `images/${fname}`, data: bin.buf, mime: bin.mime })
    }

    const chapters = rec.chapters.map((ch, i) => {
      let body = bodyOf(ch.html)
      // bin/<id> image refs → packaged image files; drop imgs whose binary is missing
      body = body.replace(/<img([^>]*?)src="bin\/([^"]+)"([^>]*?)\/?>/g, (_, pre, enc, post) => {
        let id; try { id = decodeURIComponent(enc) } catch { id = enc }
        const fname = idToFile[id]
        return fname ? `<img${pre}src="../images/${fname}"${post}/>` : ''
      })
      // internal note links point at reader chapter names — follow the rename
      body = body.replace(/href="sec-(\d+)\.html/g, 'href="chap-$1.xhtml')
      return { file: `chap-${i}.xhtml`, label: ch.label, body }
    })

    return { chapters, images, css: cssOf(rec.chapters[0]?.html || '') }
  }

  // doc / docx — a single HTML document with images inlined as data URIs
  const docReader = require('./docReader')
  const r = await docReader.getResource(book.path, 'doc.html')
  const html = r.data.toString('utf8')
  const images = []
  let n = 0
  let body = bodyOf(html).replace(/src="data:([^;",]+);base64,([^"]*)"/g, (m, mime, b64) => {
    try {
      const fname = `img-${n++}.${MIME_EXT[mime] || 'jpg'}`
      images.push({ href: `images/${fname}`, data: Buffer.from(b64, 'base64'), mime })
      return `src="../images/${fname}"`
    } catch { return 'src=""' }
  })
  return {
    chapters: [{ file: 'chap-0.xhtml', label: book.title || 'Document', body }],
    images,
    css: cssOf(html),
  }
}

// ── EPUB packaging ───────────────────────────────────────────────────────────

function buildEpub({ meta, chapters, images, css, cover }, outPath) {
  const uid = `urn:uuid:${crypto.randomUUID()}`
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>${body}</body>
</html>`

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>
${chapters.map(c => `<li><a href="text/${c.file}">${escXml(c.label || 'Chapter')}</a></li>`).join('\n')}
</ol></nav></body>
</html>`

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/></head>
<docTitle><text>${escXml(meta.title)}</text></docTitle>
<navMap>
${chapters.map((c, i) =>
  `<navPoint id="np-${i}" playOrder="${i + 1}"><navLabel><text>${escXml(c.label || `Chapter ${i + 1}`)}</text></navLabel><content src="text/${c.file}"/></navPoint>`
).join('\n')}
</navMap>
</ncx>`

  const coverExt  = cover ? (MIME_EXT[cover.mime] || 'jpg') : null
  const coverHref = cover ? `images/cover.${coverExt}` : null

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...(cover ? [`<item id="cover-image" href="${coverHref}" media-type="${cover.mime}" properties="cover-image"/>`] : []),
    ...chapters.map((c, i) => `<item id="c${i}" href="text/${c.file}" media-type="application/xhtml+xml"/>`),
    ...images.map((img, i) => `<item id="img${i}" href="${img.href}" media-type="${img.mime}"/>`),
  ].join('\n')

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${escXml(meta.title)}</dc:title>
${meta.author ? `<dc:creator>${escXml(meta.author)}</dc:creator>` : ''}
<dc:language>${escXml(meta.language || 'und')}</dc:language>
${meta.description ? `<dc:description>${escXml(meta.description)}</dc:description>` : ''}
<meta property="dcterms:modified">${modified}</meta>
${cover ? `<meta name="cover" content="cover-image"/>` : ''}
${meta.series_name ? `<meta name="calibre:series" content="${escXml(meta.series_name)}"/>` : ''}
${meta.series_num != null && meta.series_num !== '' ? `<meta name="calibre:series_index" content="${meta.series_num}"/>` : ''}
</metadata>
<manifest>
${manifest}
</manifest>
<spine toc="ncx">
${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('\n')}
</spine>
</package>`

  const zip = new AdmZip()
  zip.addFile('mimetype', Buffer.from('application/epub+zip'))
  try { zip.getEntry('mimetype').header.method = 0 } catch { /* stored is nicer, deflated still works */ }
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`))
  zip.addFile('OEBPS/content.opf', Buffer.from(opf))
  zip.addFile('OEBPS/nav.xhtml',   Buffer.from(nav))
  zip.addFile('OEBPS/toc.ncx',     Buffer.from(ncx))
  zip.addFile('OEBPS/style.css',   Buffer.from(css || ''))
  if (cover) zip.addFile(`OEBPS/${coverHref}`, cover.data)
  for (const ch of chapters) zip.addFile(`OEBPS/text/${ch.file}`, Buffer.from(xhtml(ch.label || meta.title, ch.body)))
  for (const img of images)  zip.addFile(`OEBPS/${img.href}`, img.data)
  zip.writeZip(outPath)
}

// ── HTML → FB2 blocks ────────────────────────────────────────────────────────

const FB2_INLINE = {
  em: 'emphasis', i: 'emphasis', strong: 'strong', b: 'strong',
  s: 'strikethrough', strike: 'strikethrough', del: 'strikethrough',
  sub: 'sub', sup: 'sup', code: 'code', tt: 'code',
}
const FB2_BLOCK = new Set([
  'p', 'div', 'section', 'article', 'li', 'ul', 'ol', 'blockquote', 'table',
  'tr', 'td', 'th', 'figure', 'figcaption', 'pre', 'hr', 'center', 'dd', 'dt', 'aside',
])

// Walks tolerant HTML and returns blocks: {kind:'p'|'heading'|'image', ...}.
// addImage(src) → binary id (registering the binary) or null to drop the image.
function htmlToFb2Blocks(html, addImage) {
  let src = bodyOf(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  const blocks  = []
  const stack   = []
  let buf       = ''
  let heading   = 0

  const flush = () => {
    while (stack.length) buf += `</${stack.pop()}>`
    const text = buf.trim()
    buf = ''
    if (!text.replace(/<[^>]+>/g, '').trim()) return
    blocks.push(heading ? { kind: 'heading', level: heading, text } : { kind: 'p', text })
  }

  for (const tok of src.match(/<[^>]*>|[^<]+/g) || []) {
    if (tok[0] !== '<') { buf += escXml(decodeEntities(tok)); continue }
    const m = tok.match(/^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)/)
    if (!m) continue
    const closing = !!m[1]
    const tag = m[2].toLowerCase()

    if (tag === 'br') { flush(); continue }

    if ((tag === 'img' || tag === 'image') && !closing) {
      const srcAttr = tok.match(/(?:src|href|xlink:href)\s*=\s*"([^"]*)"/i)?.[1]
                   || tok.match(/(?:src|href|xlink:href)\s*=\s*'([^']*)'/i)?.[1]
      if (srcAttr) {
        const id = addImage(srcAttr)
        if (id) { flush(); blocks.push({ kind: 'image', id }) }
      }
      continue
    }

    const hm = tag.match(/^h([1-6])$/)
    if (hm) {
      flush()
      heading = closing ? 0 : +hm[1]
      continue
    }

    if (FB2_INLINE[tag]) {
      const fbTag = FB2_INLINE[tag]
      if (closing) {
        const idx = stack.lastIndexOf(fbTag)
        if (idx >= 0) while (stack.length > idx) buf += `</${stack.pop()}>`
      } else if (!/\/\s*>$/.test(tok)) {
        stack.push(fbTag)
        buf += `<${fbTag}>`
      }
      continue
    }

    if (FB2_BLOCK.has(tag)) flush()
    // any other tag (a, span, font, svg, …) is transparent — its text flows through
  }
  flush()
  return blocks
}

// Split blocks into fb2 <section>s at h1/h2 boundaries; deeper headings
// become subtitles. A chapter without headings gets its toc label as title.
function blocksToSections(blocks, fallbackTitle) {
  const sections = []
  let cur = { title: null, out: [] }
  const push = () => {
    if (cur.title || cur.out.length) sections.push(cur)
    cur = { title: null, out: [] }
  }
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level <= 2) { push(); cur.title = b.text }
    else if (b.kind === 'heading')            cur.out.push(`<subtitle>${b.text}</subtitle>`)
    else if (b.kind === 'image')              cur.out.push(`<image l:href="#${b.id}"/>`)
    else                                      cur.out.push(`<p>${b.text}</p>`)
  }
  push()
  if (sections.length && !sections[0].title && fallbackTitle) {
    sections[0].title = escXml(fallbackTitle)
  }
  return sections.map(s =>
    `<section>${s.title ? `<title><p>${s.title}</p></title>` : ''}${s.out.length ? s.out.join('\n') : '<empty-line/>'}</section>`
  )
}

function fb2Authors(authorStr) {
  const names = String(authorStr || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
  if (!names.length) return '<author><nickname>Unknown</nickname></author>'
  return names.map(n => {
    const parts = n.split(/\s+/)
    if (parts.length === 1) return `<author><nickname>${escXml(n)}</nickname></author>`
    const last = parts.pop()
    return `<author><first-name>${escXml(parts.join(' '))}</first-name><last-name>${escXml(last)}</last-name></author>`
  }).join('\n')
}

async function convertToFb2(book, srcFmt, coverFile, outPath) {
  // Collect chapter HTMLs + an image resolver per chapter
  const chapters = []   // { label, html, resolveImage(src) → {data, mime} | null }
  if (srcFmt === 'epub') {
    const epubReader = require('./epubReader')
    const structure  = epubReader.getStructure(book.path)
    const tocMap = {}
    const walkToc = items => { for (const t of items || []) { if (t.href && !tocMap[t.href]) tocMap[t.href] = t.label; walkToc(t.children) } }
    walkToc(structure.toc)
    for (const it of structure.spine) {
      const r = epubReader.getResource(book.path, it.href)
      if (!r) continue
      chapters.push({
        label: tocMap[it.href] || '',
        html:  r.data.toString('utf8'),
        resolveImage: src => {
          const dm = src.match(/^data:([^;,]+);base64,(.*)$/s)
          if (dm) { try { return { data: Buffer.from(dm[2], 'base64'), mime: dm[1] } } catch { return null } }
          const resolved = epubReader.resolveHref(it.href, src).path
          const res = epubReader.getResource(book.path, resolved)
          return res && res.mime.startsWith('image/') ? { data: res.data, mime: res.mime } : null
        },
      })
    }
  } else {
    const docReader = require('./docReader')
    const r = await docReader.getResource(book.path, 'doc.html')
    chapters.push({
      label: book.title || '',
      html:  r.data.toString('utf8'),
      resolveImage: src => {
        const dm = src.match(/^data:([^;,]+);base64,(.*)$/s)
        if (!dm) return null
        try { return { data: Buffer.from(dm[2], 'base64'), mime: dm[1] } } catch { return null }
      },
    })
  }

  // Walk every chapter, registering image binaries as we go (deduped per source)
  const binaries = {}   // id → { mime, b64 }
  let binCount = 0
  const sectionsXml = []
  for (const ch of chapters) {
    const seen = {}
    const addImage = src => {
      if (seen[src]) return seen[src]
      const img = ch.resolveImage(src)
      if (!img || !img.data?.length) return null
      const id = `img-${binCount++}.${MIME_EXT[img.mime] || 'jpg'}`
      binaries[id] = { mime: img.mime, b64: img.data.toString('base64') }
      seen[src] = id
      return id
    }
    sectionsXml.push(...blocksToSections(htmlToFb2Blocks(ch.html, addImage), ch.label))
  }
  if (!sectionsXml.length) throw new Error('No convertible text found in this book')

  const cover = readCoverFile(coverFile)
  let coverXml = ''
  if (cover) {
    const coverId = `cover.${MIME_EXT[cover.mime] || 'jpg'}`
    binaries[coverId] = { mime: cover.mime, b64: cover.data.toString('base64') }
    coverXml = `<coverpage><image l:href="#${coverId}"/></coverpage>`
  }

  const today = new Date().toISOString().slice(0, 10)
  const plainDesc = String(book.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
${fb2Authors(book.author_canonical || book.author)}
<book-title>${escXml(book.title || path.basename(book.path))}</book-title>
${plainDesc ? `<annotation><p>${escXml(plainDesc)}</p></annotation>` : ''}
<lang>${escXml((book.language || 'en').toLowerCase())}</lang>
${book.series_name ? `<sequence name="${escXml(book.series_name)}"${book.series_num != null ? ` number="${escXml(book.series_num)}"` : ''}/>` : ''}
${coverXml}
</title-info>
<document-info>
<author><nickname>ShelfMind</nickname></author>
<program-used>ShelfMind ${require('../package.json').version}</program-used>
<date value="${today}">${today}</date>
<id>${crypto.randomUUID()}</id>
<version>1.0</version>
</document-info>
</description>
<body>
${sectionsXml.join('\n')}
</body>
${Object.entries(binaries).map(([id, b]) => `<binary id="${id}" content-type="${b.mime}">${b.b64}</binary>`).join('\n')}
</FictionBook>`

  fs.writeFileSync(outPath, xml, 'utf8')
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * book: a store book record; target: 'epub' | 'fb2'
 * opts.coverFile: absolute path to the book's cached cover image (optional)
 * Returns { ok, outPath } or { ok: false, error }
 */
async function convertBook(book, target, opts = {}) {
  const { formatOf } = require('./readerFormats')
  const src = formatOf(book)
  if (!src) return { ok: false, error: `Converting ${(book.format || '?').toUpperCase()} files is not supported` }
  if (src === target) return { ok: false, error: `This book is already ${target.toUpperCase()}` }

  try {
    if (target === 'epub') {
      if (src !== 'fb2' && src !== 'doc') {
        return { ok: false, error: 'Only FB2 and Word documents can be converted to EPUB' }
      }
      const { chapters, images, css } = await sourceChaptersForEpub(book, src)
      const outPath = outputPathFor(book.path, 'epub')
      buildEpub({
        meta: {
          title:       book.title || path.basename(book.path),
          author:      book.author_canonical || book.author || '',
          language:    book.language || '',
          description: String(book.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          series_name: book.series_name || '',
          series_num:  book.series_num ?? null,
        },
        chapters, images, css,
        cover: readCoverFile(opts.coverFile),
      }, outPath)
      return { ok: true, outPath }
    }

    if (target === 'fb2') {
      if (src !== 'epub' && src !== 'doc') {
        return { ok: false, error: 'Only EPUB and Word documents can be converted to FB2' }
      }
      const outPath = outputPathFor(book.path, 'fb2')
      await convertToFb2(book, src, opts.coverFile, outPath)
      return { ok: true, outPath }
    }

    return { ok: false, error: `Unknown target format: ${target}` }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { convertBook }
