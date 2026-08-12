const fs = require('fs')

const DEBOUNCE_MS = 3000

let fsWatchers = []
let debounceTimer = null

// Watches the library folder (and any extra folders, e.g. PDF tab folders)
// recursively and calls onChange (debounced) whenever something changes
// underneath them — lets the library pick up file drops/edits/removals
// without a manual "Scan Library" click.
function startWatching(paths, onChange) {
  stopWatching()
  const list = (Array.isArray(paths) ? paths : [paths])
    .filter(p => p && fs.existsSync(p))

  const onEvent = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, DEBOUNCE_MS)
  }

  for (const dir of list) {
    try {
      const w = fs.watch(dir, { recursive: true }, onEvent)
      w.on('error', () => {})
      fsWatchers.push(w)
    } catch {
      // Recursive watching isn't supported on this platform/filesystem — fail
      // silently, manual "Scan Library" still works.
    }
  }
}

function stopWatching() {
  clearTimeout(debounceTimer)
  debounceTimer = null
  for (const w of fsWatchers) {
    try { w.close() } catch {}
  }
  fsWatchers = []
}

module.exports = { startWatching, stopWatching }
