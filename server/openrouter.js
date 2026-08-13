// Generic OpenAI-compatible chat client — shared by all AI features (mood
// profiling, mood suggestions, and future metadata/series checks). Bare fetch,
// no deps. Defaults to OpenRouter; set prefs.llm_base_url to point at a local
// server instead (LM Studio http://localhost:1234/v1, Ollama
// http://localhost:11434/v1, …) — the API key is optional in that case.
// Config: openrouter_key, openrouter_model, openrouter_web_search (OpenRouter
// only), llm_base_url.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL  = 'google/gemma-3-27b-it'

// Accept the URL in whatever shape the user typed it: full endpoint,
// .../v1 base, or bare host:port (try /v1 first, then the bare path).
function candidateUrls(baseUrl) {
  if (!baseUrl) return [OPENROUTER_URL]
  if (baseUrl.endsWith('/chat/completions')) return [baseUrl]
  if (baseUrl.endsWith('/v1')) return [`${baseUrl}/chat/completions`]
  return [`${baseUrl}/v1/chat/completions`, `${baseUrl}/chat/completions`]
}

// messages: [{ role: 'system'|'user', content: '…' }]
// opts.json      — request a JSON object reply and parse it robustly
// opts.webSearch — enable OpenRouter's web plugin (billed per lookup; ignored
//                  for custom base URLs, which have no such plugin)
async function chatComplete(prefs, messages, { json = false, webSearch = false } = {}) {
  const key     = prefs?.openrouter_key
  const baseUrl = (prefs?.llm_base_url || '').trim().replace(/\/+$/, '')
  if (!key && !baseUrl) throw new Error('No LLM configured — set an OpenRouter key or a local LLM URL in Preferences')

  const body = {
    model: prefs.openrouter_model || DEFAULT_MODEL,
    messages,
  }
  if (json)                  body.response_format = { type: 'json_object' }
  if (webSearch && !baseUrl) body.plugins = [{ id: 'web' }]

  const headers = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  // Cloudflare Access service-token auth — needed when the LLM server sits
  // behind Cloudflare Zero Trust (otherwise every request is redirected to
  // an HTML login page). Create a token under Zero Trust → Access → Service
  // Auth → Service Tokens.
  if (prefs?.llm_cf_client_id)     headers['CF-Access-Client-Id']     = prefs.llm_cf_client_id
  if (prefs?.llm_cf_client_secret) headers['CF-Access-Client-Secret'] = prefs.llm_cf_client_secret

  let lastError = null
  for (const url of candidateUrls(baseUrl)) {
    // Some (mostly free/local) models reject response_format — retry once
    // without it; parseJsonReply still extracts the JSON from plain text.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res  = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      const text = await res.text().catch(() => '')

      if (!res.ok) {
        if (res.status === 400 && body.response_format && attempt === 0) {
          delete body.response_format
          continue
        }
        lastError = new Error(`LLM ${res.status} at ${url}: ${text.slice(0, 200)}`)
        break   // 404 etc. — try the next URL shape
      }

      let data
      try {
        data = JSON.parse(text)
      } catch {
        // HTML error page / web UI instead of the API — wrong URL shape
        lastError = new Error(`LLM returned HTML, not JSON, at ${url} — check the Local LLM URL (it usually ends with /v1)`)
        break
      }

      const content = data?.choices?.[0]?.message?.content
      if (!content) throw new Error('LLM returned an empty reply')

      return json ? parseJsonReply(content) : content
    }
  }
  throw lastError || new Error('LLM request failed')
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
