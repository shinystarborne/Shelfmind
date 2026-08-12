// Theme helpers — color-palette attribute + native titlebar sync.
// Palettes themselves are defined in src/index.css under "Color Palettes";
// 'rose' is the default and needs no attribute.

export function applyPalette(id) {
  const root = document.documentElement
  if (id && id !== 'rose') root.setAttribute('data-palette', id)
  else root.removeAttribute('data-palette')
}

// Push the active palette's computed colors to the native titlebar overlay so
// the window controls match the current theme + palette. No-op in the browser.
export function syncTitlebar(theme) {
  if (!window.electronAPI?.setTheme) return
  const cs = getComputedStyle(document.documentElement)
  window.electronAPI.setTheme(theme, {
    color:       cs.getPropertyValue('--cream').trim()       || undefined,
    symbolColor: cs.getPropertyValue('--brown').trim()       || undefined,
  })
}
