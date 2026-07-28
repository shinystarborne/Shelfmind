const fs = require('fs')

const DEBOUNCE_MS = 3000

let fsWatcher = null
let debounceTimer = null

// Watches the library folder recursively and calls onChange (debounced) whenever
// something changes underneath it — lets the library pick up file drops/edits/
// removals without a manual "Scan Library" click.
function startWatching(libraryPath, onChange) {
  stopWatching()
  if (!libraryPath || !fs.existsSync(libraryPath)) return

  try {
    fsWatcher = fs.watch(libraryPath, { recursive: true }, () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(onChange, DEBOUNCE_MS)
    })
    fsWatcher.on('error', () => stopWatching())
  } catch {
    // Recursive watching isn't supported on this platform/filesystem — fail silently,
    // manual "Scan Library" still works.
  }
}

function stopWatching() {
  clearTimeout(debounceTimer)
  debounceTimer = null
  if (fsWatcher) {
    try { fsWatcher.close() } catch {}
    fsWatcher = null
  }
}

module.exports = { startWatching, stopWatching }
