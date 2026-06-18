/**
 * Write metadata back to an .epub file's OPF.
 * Uses simple string replacement to avoid round-trip XML corruption.
 */
const AdmZip = require('adm-zip')
const { XMLParser } = require('fast-xml-parser')

const simpleParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function getOpfPath(zip) {
  const entry = zip.getEntry('META-INF/container.xml')
  if (!entry) return null
  try {
    const c = simpleParser.parse(entry.getData().toString('utf8'))
    return c?.container?.rootfiles?.rootfile?.['@_full-path'] || null
  } catch { return null }
}

function escXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * fields: { title, author, language, series_name, series_num, description }
 * Returns { ok, error? }
 */
function writeEpubMeta(filePath, fields) {
  try {
    const zip     = new AdmZip(filePath)
    const opfPath = getOpfPath(zip)
    if (!opfPath) return { ok: false, error: 'Cannot find OPF in epub' }

    const opfEntry = zip.getEntry(opfPath)
    if (!opfEntry) return { ok: false, error: 'OPF entry missing' }

    let xml = opfEntry.getData().toString('utf8')

    // dc:title
    if (fields.title != null) {
      if (/<dc:title[\s>]/.test(xml)) {
        xml = xml.replace(/<dc:title[^>]*>[\s\S]*?<\/dc:title>/, `<dc:title>${escXml(fields.title)}</dc:title>`)
      } else {
        xml = xml.replace('</metadata>', `  <dc:title>${escXml(fields.title)}</dc:title>\n</metadata>`)
      }
    }

    // dc:creator (first one)
    if (fields.author != null) {
      if (/<dc:creator[\s>]/.test(xml)) {
        xml = xml.replace(/<dc:creator[^>]*>[\s\S]*?<\/dc:creator>/, `<dc:creator>${escXml(fields.author)}</dc:creator>`)
      } else {
        xml = xml.replace('</metadata>', `  <dc:creator>${escXml(fields.author)}</dc:creator>\n</metadata>`)
      }
    }

    // dc:language
    if (fields.language != null && fields.language !== '') {
      if (/<dc:language[\s>]/.test(xml)) {
        xml = xml.replace(/<dc:language[^>]*>[\s\S]*?<\/dc:language>/, `<dc:language>${escXml(fields.language)}</dc:language>`)
      } else {
        xml = xml.replace('</metadata>', `  <dc:language>${escXml(fields.language)}</dc:language>\n</metadata>`)
      }
    }

    // dc:description
    if (fields.description != null) {
      if (/<dc:description[\s>]/.test(xml)) {
        xml = xml.replace(/<dc:description[^>]*>[\s\S]*?<\/dc:description>/, `<dc:description>${escXml(fields.description)}</dc:description>`)
      } else {
        xml = xml.replace('</metadata>', `  <dc:description>${escXml(fields.description)}</dc:description>\n</metadata>`)
      }
    }

    // calibre:series
    if (fields.series_name != null) {
      if (/name="calibre:series"/.test(xml)) {
        xml = xml.replace(
          /(<meta[^>]+name="calibre:series"\s[^>]*content=")[^"]*(")/,
          `$1${escXml(fields.series_name)}$2`
        )
        // Also try content-first attribute order
        xml = xml.replace(
          /(<meta[^>]+content=")[^"]*("[^>]+name="calibre:series")/,
          `$1${escXml(fields.series_name)}$2`
        )
      } else if (fields.series_name) {
        xml = xml.replace('</metadata>',
          `  <meta name="calibre:series" content="${escXml(fields.series_name)}"/>\n</metadata>`)
      }
    }

    // calibre:series_index
    if (fields.series_num != null && fields.series_num !== '') {
      if (/name="calibre:series_index"/.test(xml)) {
        xml = xml.replace(
          /(<meta[^>]+name="calibre:series_index"\s[^>]*content=")[^"]*(")/,
          `$1${fields.series_num}$2`
        )
        xml = xml.replace(
          /(<meta[^>]+content=")[^"]*("[^>]+name="calibre:series_index")/,
          `$1${fields.series_num}$2`
        )
      } else {
        xml = xml.replace('</metadata>',
          `  <meta name="calibre:series_index" content="${fields.series_num}"/>\n</metadata>`)
      }
    }

    zip.updateFile(opfPath, Buffer.from(xml, 'utf8'))
    zip.writeZip(filePath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { writeEpubMeta }
