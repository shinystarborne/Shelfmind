const API_BASE = `http://${window.location.hostname || 'localhost'}:3001`

export function coverSrc(book) {
  // 1. Locally saved cover (extracted from epub or downloaded from OL)
  if (book.cover_local) {
    const bust = book.cover_updated_at ? `?t=${book.cover_updated_at}` : ''
    return `${API_BASE}${book.cover_local}${bust}`
  }
  // 2. Remote Open Library URL (fallback, requires internet)
  if (book.cover_url) return book.cover_url
  return null
}

export function initials(title = '') {
  return title.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
}

export function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function displayAuthor(book) {
  return book.author_canonical || book.author || 'Unknown'
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status || 'unread'}`}>{status || 'unread'}</span>
}

function MiniStars({ rating }) {
  return (
    <span className="star-mini">
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= rating ? 'var(--gold, #f5a623)' : 'var(--text-muted)', opacity: i <= rating ? 1 : 0.3 }}>★</span>
      ))}
    </span>
  )
}

export default function BookCard({ book, selected, onClick, selectable, checked, onCheck }) {
  const src = coverSrc(book)
  const init = initials(book.title)
  const status = book.read_status || 'unread'

  return (
    <div className="book-card-wrap">
      {selectable && (
        <input
          type="checkbox"
          className="book-card-checkbox"
          checked={!!checked}
          onChange={e => { e.stopPropagation(); onCheck?.(book.id, e.target.checked) }}
          onClick={e => e.stopPropagation()}
        />
      )}
      <div
        className={`book-card ${selected ? 'selected' : ''}`}
        onClick={() => onClick(book)}
        title={book.title}
      >
        {src ? (
          <img
            className="book-cover"
            src={src}
            alt={book.title}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div
          className="book-cover-placeholder"
          style={{ display: src ? 'none' : 'flex' }}
        >
          <div className="initials">{init}</div>
          <div className="format-badge-cover">{book.format}</div>
        </div>

        <div className="book-meta">
          <div className="book-title">{book.title}</div>
          <div className="book-author">{displayAuthor(book)}</div>
          <MiniStars rating={book.rating || 0} />
          <div className="book-badges">
            <StatusBadge status={status} />
            {book.series_name && (
              <span className="badge badge-series" title={book.series_name}>
                {book.series_num ? `#${book.series_num}` : '📖'}
              </span>
            )}
            <span className="badge badge-format">{book.format}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BookListItem({ book, selected, onClick, selectable, checked, onCheck }) {
  const src = coverSrc(book)
  const init = initials(book.title)
  const status = book.read_status || 'unread'

  return (
    <div
      className={`book-list-item ${selected ? 'selected' : ''}`}
      onClick={() => onClick(book)}
    >
      {selectable && (
        <input
          type="checkbox"
          className="book-checkbox"
          checked={!!checked}
          onChange={e => { e.stopPropagation(); onCheck?.(book.id, e.target.checked) }}
          onClick={e => e.stopPropagation()}
        />
      )}
      {src ? (
        <img className="book-list-cover" src={src} alt={book.title} loading="lazy" />
      ) : (
        <div className="book-list-cover-ph">{init}</div>
      )}
      <div className="book-list-info">
        <div className="book-list-title">{book.title}</div>
        <div className="book-list-author">{displayAuthor(book)}</div>
        {book.series_name && (
          <div className="book-list-series">
            {book.series_name}{book.series_num ? ` #${book.series_num}` : ''}
          </div>
        )}
      </div>
      <div className="book-list-meta">
        {book.rating && <span className="star-mini">{'★'.repeat(book.rating)}</span>}
        <span className={`badge badge-${status}`}>{status}</span>
        <span className="badge badge-format">{book.format}</span>
      </div>
    </div>
  )
}
