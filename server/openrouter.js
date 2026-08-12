// Generic OpenRouter chat client — shared by all AI features (mood profiling,
// mood suggestions, and future metadata/series checks). Bare fetch, no deps.
// Config lives in prefs: openrouter_key (required), openrouter_model (optional),
// openrouter_web_search (optional toggle, real per-request cost).

const API_URL       = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'google/gemma-3-27b-it'

// messages: [{ role: 'system'|'user', content: '…' }]
// opts.json      — request a JSON object reply and parse it robustly
// opts.webSearch — enable OpenRouter's web plugin (billed per lookup)
async function chatComplete(prefs, messages, { json = false, webSearch = false } = {}) {
  const key = prefs?.openrouter_key
  if (!key) throw new Error('OpenRouter API key not configured')

  const body = {
    model: prefs.openrouter_model || DEFAULT_MODEL,
    messages,
  }
  if (json)      body.response_format = { type: 'json_object' }
  if (webSearch) body.plugins = [{ id: 'web' }]

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`)
  }

  const data    = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned an empty reply')

  return json ? parseJsonReply(content) : content
}

// Models wrap JSON in markdown fences or surrounding prose surprisingly often,
// even with response_format set — strip fences, take the first {...} block.
function parseJsonReply(content) {
  let text = String(content).trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error(`Model reply is not JSON: ${text.slice(0, 120)}`)
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(`Could not parse JSON from model reply: ${text.slice(0, 120)}`)
  }
}

module.exports = { chatComplete, DEFAULT_MODEL }
