import { useState, useEffect, useRef } from 'react'
import { API } from '../App'
import { initials } from './BookCard'
import { renderPdfThumbnail } from '../lib/pdfThumbnail'

// Computed lazily (not at module scope) — `API` is reassigned once Electron
// reports the actual port, and reading it at import time can also race a
// circular-import cycle back to App.jsx before its export initializes.
function apiBase() { return API.replace(/\/api$/, '') }

export function pdfCoverSrc(doc) {
  return doc.cover ? `${apiBase()}${doc.cover}` : null
}

export default function PdfCard({ doc, selected, onClick }) {
  const [cover, setCover]         = useState(doc.cover || null)
  const [generating, setGenerating] = useState(false)
  const triedRef = useRef(false)

  useEffect(() => { setCover(doc.cover || null); triedRef.current = false }, [doc.id, doc.cover])

  // Lazily render + cache a thumbnail for PDFs that don't have one yet.
  useEffect(() => {
    if (cover || triedRef.current || doc.missing) return
    triedRef.current = true
    setGenerating(true)
    renderPdfThumbnail(`${API}/pdf-docs/${doc.id}/file`)
      .then(dataUrl => fetch(`${API}/pdf-docs/${doc.id}/cover`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dataUrl }),
      }).then(r => r.json()))
      .then(res => { if (res.cover) setCover(res.cover) })
      .catch(err => console.warn(`PDF thumbnail failed for "${doc.title}":`, err)) // encrypted/corrupt PDFs just keep the placeholder
      .finally(() => setGenerating(false))
  }, [cover, doc.id, doc.missing])

  const src  = cover ? `${apiBase()}${cover}` : null
  const init = initials(doc.title) || '📄'

  if (doc.missing) {
    return (
      <div className="book-card-wrap">
        <div className="book-card missing" title="This PDF's file was moved or removed">
          <div className="book-cover-placeholder" style={{ display: 'flex' }}>
            <div className="initials">{init}</div>
          </div>
          <div className="book-meta">
            <div className="book-title">{doc.title}</div>
            <div className="book-author">{doc.tab_name || 'PDF'}</div>
            <div className="book-badges">
              <span className="badge badge-missing">not found</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="book-card-wrap">
      <div
        className={`book-card ${selected ? 'selected' : ''}`}
        onClick={() => onClick(doc)}
        title={doc.title}
      >
        {src ? (
          <img
            className="book-cover"
            src={src}
            alt={doc.title}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div className="book-cover-placeholder" style={{ display: src ? 'none' : 'flex' }}>
          {generating
            ? <span className="spin" style={{ fontSize: 22 }}>↻</span>
            : <div className="initials">{init}</div>}
        </div>

        <div className="book-meta">
          <div className="book-title">{doc.title}</div>
          <div className="book-author">{doc.tab_name || 'PDF'}</div>
          {(doc.tags || []).length > 0 && (
            <div className="book-badges">
              {doc.tags.slice(0, 3).map(t => <span key={t} className="badge badge-series">{t}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
