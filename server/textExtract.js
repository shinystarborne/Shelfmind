// Plain-text extraction for the search index. Separate from scanner.js's
// stripHtml (which is fine for short single-field metadata) because this one
// needs to keep paragraph/block boundaries as whitespace so words from
// adjacent tags don't get concatenated ("Hello</p><p>World" -> "HelloWorld").

const BLOCK_TAGS = 'p|div|li|tr|section|article|h1|h2|h3|h4|h5|h6|blockquote|br'
const BLOCK_CLOSE_RE = new RegExp(`</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?/?>`, 'gi')

function htmlToPlainText(html) {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(BLOCK_CLOSE_RE, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// "...50 chars before<MATCH>50 chars after..." for search-result previews
function snippetAround(text, idx, matchLen, radius = 60) {
  const start = Math.max(0, idx - radius)
  const end   = Math.min(text.length, idx + matchLen + radius)
  const before = start > 0 ? '…' : ''
  const after  = end < text.length ? '…' : ''
  return (before + text.slice(start, end).replace(/\s+/g, ' ').trim() + after)
}

module.exports = { htmlToPlainText, snippetAround }
