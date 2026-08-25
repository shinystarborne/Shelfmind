// Drag payload for dragging books/PDFs onto sidebar reading lists.
export const DND_MIME = 'application/x-shelfmind-item'

export function startItemDrag(e, kind, id) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind, id }))
  e.dataTransfer.effectAllowed = 'copy'
}

export function hasItemPayload(e) {
  return e.dataTransfer.types.includes(DND_MIME)
}

export function readItemPayload(e) {
  try { return JSON.parse(e.dataTransfer.getData(DND_MIME)) } catch { return null }
}
