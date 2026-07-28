// Minimal, safe line-based renderer for our own build/release-notes.md content —
// no markdown library needed since we fully control the input format
// (## headers, - bullets, **bold**).
function renderInline(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${key}-${i}`}>{part}</span>
  )
}

function renderNotes(notes) {
  const md = typeof notes === 'string'
    ? notes
    : Array.isArray(notes) ? notes.map(n => n.note).filter(Boolean).join('\n\n') : ''
  if (!md.trim()) return null

  const lines = md.split('\n')
  const blocks = []
  let list = null

  const flushList = () => {
    if (list) { blocks.push(<ul key={blocks.length} style={{ margin: '4px 0 8px 20px' }}>{list}</ul>); list = null }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) { flushList(); return }
    if (trimmed.startsWith('## ')) {
      flushList()
      blocks.push(<h4 key={blocks.length} style={{ marginTop: blocks.length ? 16 : 0, marginBottom: 6 }}>{renderInline(trimmed.slice(3), i)}</h4>)
    } else if (trimmed.startsWith('- ')) {
      list = list || []
      list.push(<li key={i}>{renderInline(trimmed.slice(2), i)}</li>)
    } else {
      flushList()
      blocks.push(<p key={blocks.length} style={{ marginBottom: 8 }}>{renderInline(trimmed, i)}</p>)
    }
  })
  flushList()
  return blocks
}

export default function UpdateNotesModal({ info, onInstall, onLater }) {
  const notes = renderNotes(info?.releaseNotes)
  return (
    <div className="modal-overlay" onClick={onLater}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>🎉 What's new in v{info?.version}</h2>
        <div style={{ maxHeight: '40vh', overflowY: 'auto', fontSize: 13, lineHeight: 1.5, margin: '12px 0' }}>
          {notes || <p>Update downloaded and ready to install.</p>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onLater}>Later</button>
          <button className="btn btn-primary" onClick={onInstall}>Restart &amp; Install</button>
        </div>
      </div>
    </div>
  )
}
