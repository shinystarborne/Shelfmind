// AI auto-tagging for craft-pattern PDFs. The renderer sends either the first
// pages' text (cheap path) or small page images (vision path for scans); this
// module owns the prompt, the LLM call, and normalizing the reply into our
// vocabulary + prefixed tags (craft:knitting, item:sweater, weight:dk, yarn:…).
const { chatComplete, DEFAULT_MODEL } = require('./openrouter')

const PROMPT = `You are tagging a craft pattern PDF for a personal library.
From the text or page images provided, reply with strict JSON only, no other text:
{ "craft": "knitting|crochet|macrame|sewing|embroidery|other",
  "item_type": "sweater|scarf|socks|shawl|hat|bag|blanket|toy|other",
  "yarn_weight": "lace|fingering|sport|dk|worsted|aran|bulky|super bulky|unknown",
  "yarn": "exact yarn name as stated, or null" }
Use "unknown" or null when the information is not stated. Do not guess from a photo's look alone.`

const CRAFTS  = ['knitting', 'crochet', 'macrame', 'sewing', 'embroidery']
const ITEMS   = ['sweater', 'scarf', 'socks', 'sock', 'shawl', 'hat', 'bag', 'blanket', 'toy']
const WEIGHTS = ['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky', 'super bulky']

// Common ways patterns (and models) actually phrase yarn weights.
const WEIGHT_ALIASES = {
  '4-ply': 'fingering', '4ply': 'fingering', '4 ply': 'fingering', sock: 'fingering',
  '8-ply': 'dk', '8ply': 'dk', '8 ply': 'dk',
  '10-ply': 'worsted', '10 ply': 'worsted', '10ply': 'worsted',
  '12-ply': 'bulky', '12ply': 'bulky', '12 ply': 'bulky',
  'light fingering': 'lace', 'heavy dk': 'dk', 'superbulky': 'super bulky',
  'chunky': 'bulky', 'jumbo': 'super bulky', 'light worsted': 'dk',
  'heavy worsted': 'aran', 'medium': 'worsted', 'fine': 'sport', 'light': 'dk',
  light: 'dk',
}

function normalizeWord(value, vocab, aliases = {}) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  if (vocab.includes(v)) return v
  if (aliases[v]) return aliases[v]
  const hit = vocab.find(w => v.includes(w))
  return hit || null
}

// Result → doc.auto record + the tags to merge onto the doc.
function buildResult(raw, source, model) {
  const craft  = normalizeWord(raw.craft, CRAFTS) || 'other'
  const item   = normalizeWord(raw.item_type, ITEMS) || 'other'
  const weight = normalizeWord(raw.yarn_weight, WEIGHTS, WEIGHT_ALIASES)
  const yarn   = raw.yarn ? String(raw.yarn).trim() : null

  const tags = [`craft:${craft}`, `item:${item === 'sock' ? 'socks' : item}`]
  if (weight && weight !== 'unknown') tags.push(`weight:${weight.replace(' ', '-')}`)
  if (yarn) tags.push(`yarn:${yarn.toLowerCase()}`)

  return {
    auto: {
      craft, item_type: item === 'sock' ? 'socks' : item,
      yarn_weight: weight || 'unknown', yarn,
      source, model,
      tagged_at: Date.now(), failed: false,
    },
    tags,
  }
}

// input: { title, text? , images? } — exactly one of text/images is expected.
async function tagPattern(prefs, { title, text, images }) {
  const hasImages = Array.isArray(images) && images.length > 0
  const userContent = hasImages
    ? [
        { type: 'text', text: `Pattern file: ${title}\nHere are the first page(s) of the pattern:` },
        ...images.map(url => ({ type: 'image_url', image_url: { url } })),
      ]
    : `Pattern file: ${title}\n\nFirst pages of the pattern:\n${String(text || '').slice(0, 6000)}`

  const result = await chatComplete(prefs, [
    { role: 'system', content: PROMPT },
    { role: 'user',   content: userContent },
  ], { json: true, timeoutMs: hasImages ? 180000 : 60000 })

  return buildResult(result, hasImages ? 'vision' : 'text', prefs.openrouter_model || DEFAULT_MODEL)
}

module.exports = { tagPattern }
