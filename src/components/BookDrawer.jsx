import { useState, useEffect, useCallback, useRef } from 'react'
import { API, useApp } from '../App'
import { coverSrc, initials, displayAuthor, formatFileSize } from './BookCard'
import KindleModal from './KindleModal'

function stripHtml(str) {
  if (!str) return ''
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim()
}

const STATUS_OPTIONS = [
  { value: 'unread',  label: 'Unread',  icon: '📖' },
  { value: 'reading', label: 'Reading', icon: '🔖' },
  { value: 'read',    label: 'Read',    icon: '✅' },
  { value: 'dnf',     label: 'DNF',     icon: '🚫' },
]

const PRESET_TAGS = ['Favorites', 'Re-read', 'Gift Ideas', 'Classics', 'Abandoned']

// ── Edit panel ────────────────────────────────────────────────────────────────
function EditPanel({ book, onSave, onClose }) {
  const { toast } = useApp()
  const [fields, setFields] = useState({
    title:       book.title        || '',
    author:      book.author_canonical || book.author || '',
    series_name: book.series_name  || '',
    series_num:  book.series_num   ?? '',
    language:    book.language     || '',
    description: stripHtml(book.description || ''),
  })
  const [fetching,   setFetching]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [preview,    setPreview]    = useState(null)   // OL preview data
  const [writeFile,  setWriteFile]  = useState(book.format === 'epub')

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }))

  const fetchFromOL = async () => {
    setFetching(true)
    setPreview(null)
    try {
      const res = await fetch(`${API}/books/${book.id}/ol-preview`).then(r => r.json())
      if (!res.found) { toast('No match found on Open Library'); return }
      setPreview(res)
      // Pre-fill only empty fields so the user can see what will change
      setFields(f => ({
        title:       f.title       || res.title              || f.title,
        author:      f.author      || res.author_canonical   || f.author,
        series_name: f.series_name || res.series_name        || f.series_name,
        series_num:  f.series_num  !== '' ? f.series_num : '',
        language:    f.language,
        description: f.description || '',
      }))
      toast('Open Library data loaded — review and save')
    } catch {
      toast('Could not reach Open Library')
    } finally {
      setFetching(false)
    }
  }

  const applyAllFromOL = () => {
    if (!preview) return
    setFields(f => ({
      ...f,
      title:       preview.title              || f.title,
      author:      preview.author_canonical   || f.author,
      series_name: preview.series_name        || f.series_name,
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        title:            fields.title,
        author:           fields.author,
        author_canonical: fields.author,
        series_name:      fields.series_name,
        series_num:       fields.series_num !== '' ? parseFloat(fields.series_num) : null,
        language:         fields.language,
        description:      fields.description,
        subjects:         preview?.subjects || book.subjects,
      }

      await fetch(`${API}/books/${book.id}/meta`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      // Optionally write back to the epub file itself
      if (writeFile && book.format === 'epub') {
        const fileRes = await fetch(`${API}/books/${book.id}/write-file`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        }).then(r => r.json())
        if (!fileRes.ok) {
          toast(`Saved in app, but file write failed: ${fileRes.error}`)
        } else {
          toast('Metadata saved + written to epub file ✓', 'success')
        }
      } else {
        toast('Metadata saved', 'success')
      }

      onSave()
    } catch {
      toast('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* OL preview strip */}
      {preview && (
        <div style={{
          background: 'var(--cream-dark)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}>
          {preview.cover_url && (
            <img src={preview.cover_url} alt="" style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-soft)' }}>
            <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 2 }}>
              Open Library found:
            </strong>
            {preview.author_canonical && <div>Author: {preview.author_canonical}</div>}
            {preview.series_name      && <div>Series: {preview.series_name}</div>}
            {preview.subjects?.length > 0 && (
              <div>Genres: {preview.subjects.slice(0, 4).join(', ')}</div>
            )}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={applyAllFromOL}>
            Apply all
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="drawer-section-label" style={{ margin: 0 }}>Edit Metadata</div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={fetchFromOL}
          disabled={fetching}
        >
          {fetching ? <span className="spin">↻</span> : '🔍'} Fill from Open Library
        </button>
      </div>

      {[
        { key: 'title',       label: 'Title',       type: 'text' },
        { key: 'author',      label: 'Author',      type: 'text' },
        { key: 'series_name', label: 'Series',      type: 'text' },
        { key: 'series_num',  label: 'Series #',    type: 'number', small: true },
        { key: 'language',    label: 'Language',    type: 'text',   small: true },
      ].map(({ key, label, type, small }) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {label}
          </label>
          <input
            type={type}
            className="pref-input"
            style={{ width: small ? '50%' : '100%' }}
            value={fields[key]}
            onChange={e => set(key, e.target.value)}
          />
        </div>
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Description
        </label>
        <textarea
          className="note-textarea"
          style={{ minHeight: 60 }}
          value={fields.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Add a description…"
        />
      </div>

      {/* Write-to-file toggle (epub only) */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-soft)', cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={writeFile && book.format === 'epub'}
          disabled={book.format !== 'epub'}
          onChange={e => setWriteFile(e.target.checked)}
          style={{ accentColor: 'var(--rose)', width: 14, height: 14 }}
        />
        Write changes to .epub file itself
        {book.format !== 'epub' && (
          <span style={{ color: 'var(--text-muted)' }}>(EPUB only)</span>
        )}
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
          {saving ? '…' : 'Save Changes'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

// ── Rename file confirmation ──────────────────────────────────────────────────
function RenameConfirm({ book, onConfirm, onCancel }) {
  const [busy,    setBusy]    = useState(false)
  const [preview, setPreview] = useState(null)
  const { toast } = useApp()

  useEffect(() => {
    fetch(`${API}/books/${book.id}/rename-preview`)
      .then(r => r.json())
      .then(setPreview)
      .catch(() => toast('Could not compute new filename'))
  }, [book.id])

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/books/${book.id}/rename-file`, { method: 'POST' }).then(r => r.json())
      if (res.ok) {
        if (res.unchanged) toast('Filename already matches metadata')
        else toast(`Renamed to: ${res.newName}`, 'success')
        onConfirm()
      } else {
        toast(`Error: ${res.error}`, 'error')
        setBusy(false)
      }
    } catch {
      toast('Could not rename file')
      setBusy(false)
    }
  }

  return (
    <div style={{
      background: 'var(--cream-dark)',
      border: '1.5px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Rename file to match metadata?</div>
      {!preview ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Computing new name…</div>
      ) : preview.unchanged ? (
        <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>
          The filename already matches the metadata — no rename needed.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.6 }}>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Current: </span>
            <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{preview.currentName}</code>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>New: </span>
            <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{preview.newName}</code>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={confirm}
          disabled={busy || !preview || preview.unchanged}
        >
          {busy ? <span className="spin">↻</span> : '✏️'} Rename
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Remove confirmation ───────────────────────────────────────────────────────
function RemoveConfirm({ book, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/books/${book.id}/remove`, { method: 'POST' }).then(r => r.json())
      if (res.ok) {
        toast(`Moved to _Removed folder`, 'success')
        onConfirm()
      } else {
        toast(`Error: ${res.error}`, 'error')
        setBusy(false)
      }
    } catch {
      toast('Could not move file')
      setBusy(false)
    }
  }

  return (
    <div style={{
      background: '#fff5f5',
      border: '1.5px solid #f0c0c0',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 13, color: '#8b3030', fontWeight: 700 }}>Move to _Removed?</div>
      <div style={{ fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5 }}>
        The file will be moved to <code style={{ fontSize: 11 }}>_Removed\</code> inside your library folder.
        It won't appear in ShelfMind but nothing is permanently deleted.
      </div>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
        {book.path}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn"
          style={{ background: '#c04040', color: '#fff', flex: 1 }}
          onClick={confirm}
          disabled={busy}
        >
          {busy ? <span className="spin">↻</span> : '🗑️'} Move to _Removed
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Star Rating component ────────────────────────────────────────────────────
function StarRating({ rating, onChange }) {
  const [hover, setHover] = useState(null)
  const display = hover ?? rating ?? 0
  return (
    <div className="star-rating">
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          className={`star-btn ${display >= n ? 'filled' : ''}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange(rating === n ? null : n)}
          title={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
      {rating && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
          {rating}/5
        </span>
      )}
    </div>
  )
}

// ── Tags component ────────────────────────────────────────────────────────────
function TagsEditor({ bookId, tags, onChange }) {
  const [custom, setCustom] = useState('')

  const toggle = (tag) => {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
    save(next)
  }
  const remove = (tag) => save(tags.filter(t => t !== tag))
  const addCustom = () => {
    const t = custom.trim()
    if (!t || tags.includes(t)) { setCustom(''); return }
    save([...tags, t])
    setCustom('')
  }
  const save = async (next) => {
    await fetch(`${API}/books/${bookId}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: next }),
    })
    onChange(next)
  }

  return (
    <div>
      <div className="tags-wrap">
        {PRESET_TAGS.map(tag => (
          <span
            key={tag}
            className={`tag-chip ${tags.includes(tag) ? 'active' : ''}`}
            onClick={() => toggle(tag)}
          >
            {tag}
          </span>
        ))}
      </div>
      {tags.filter(t => !PRESET_TAGS.includes(t)).length > 0 && (
        <div className="tags-wrap" style={{ marginTop: 6 }}>
          {tags.filter(t => !PRESET_TAGS.includes(t)).map(tag => (
            <span key={tag} className="tag-chip active">
              {tag}
              <span
                className="tag-remove"
                onClick={e => { e.stopPropagation(); remove(tag) }}
              >×</span>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input-wrap">
        <input
          className="tag-input"
          placeholder="Add custom tag…"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
        />
        <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 11 }} onClick={addCustom}>
          Add
        </button>
      </div>
    </div>
  )
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export default function BookDrawer({ bookId, onClose, onStatusChange, onRemoved }) {
  const { toast, prefs, refreshLibrary, openReader, readerBook } = useApp()
  const [book,        setBook]        = useState(null)
  const [note,        setNote]        = useState('')
  const [noteDirty,   setNoteDirty]   = useState(false)
  const [showKindle,  setShowKindle]  = useState(false)
  const [showEdit,    setShowEdit]    = useState(false)
  const [showRemove,  setShowRemove]  = useState(false)
  const [showRename,  setShowRename]  = useState(false)
  const [enriching,   setEnriching]   = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [epubImages,   setEpubImages]   = useState(null)   // null=hidden, []=loading, [{...}]=loaded
  const [imagesLoading, setImagesLoading] = useState(false)

  const load = useCallback(() => {
    fetch(`${API}/books/${bookId}`)
      .then(r => r.json())
      .then(b => {
        setBook(b)
        setNote(b.note || '')
      })
  }, [bookId])

  useEffect(() => { load(); setShowEdit(false); setShowRemove(false); setShowRename(false) }, [load])

  // When the in-app reader closes, re-fetch so Continue % and status are fresh
  const prevReaderBook = useRef(readerBook)
  useEffect(() => {
    if (prevReaderBook.current && !readerBook) load()
    prevReaderBook.current = readerBook
  }, [readerBook, load])

  useEffect(() => {
    if (!noteDirty) return
    const t = setTimeout(() => {
      fetch(`${API}/books/${bookId}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      setNoteDirty(false)
    }, 800)
    return () => clearTimeout(t)
  }, [note, noteDirty, bookId])

  const setStatus = async (status) => {
    await fetch(`${API}/books/${bookId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setBook(b => ({ ...b, read_status: status }))
    onStatusChange?.(bookId, status)
    toast(`Marked as ${status}`)
    load() // refresh to pick up auto-set dates
  }

  const setRating = async (rating) => {
    await fetch(`${API}/books/${bookId}/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    })
    setBook(b => ({ ...b, rating }))
  }

  const uploadCover = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = e => resolve(e.target.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await fetch(`${API}/books/${bookId}/cover`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dataUrl }),
      }).then(r => r.json())
      if (res.ok) { load(); refreshLibrary(); toast('Cover updated ✓', 'success') }
      else toast('Cover upload failed')
    } catch {
      toast('Cover upload failed')
    } finally {
      setUploading(false)
    }
  }

  const openImagePicker = async () => {
    setImagesLoading(true)
    setEpubImages([])
    try {
      const imgs = await fetch(`${API}/books/${bookId}/epub-images`).then(r => r.json())
      setEpubImages(imgs)
      if (imgs.length === 0) { toast('No images found in this epub'); setEpubImages(null) }
    } catch {
      toast('Could not read epub images')
      setEpubImages(null)
    } finally {
      setImagesLoading(false)
    }
  }

  const pickCover = async (dataUrl) => {
    try {
      const res = await fetch(`${API}/books/${bookId}/cover`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dataUrl }),
      }).then(r => r.json())
      if (res.ok) { load(); setEpubImages(null); refreshLibrary(); toast('Cover set ✓', 'success') }
      else toast('Failed to set cover')
    } catch {
      toast('Failed to set cover')
    }
  }

  const enrich = async () => {
    setEnriching(true)
    try {
      const res = await fetch(`${API}/enrich/${bookId}`, { method: 'POST' }).then(r => r.json())
      if (res.ok) { setBook(res.book); toast('Metadata updated from Open Library', 'success') }
      else toast('No match found on Open Library')
    } finally { setEnriching(false) }
  }

  if (!book) return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="book-drawer">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    </>
  )

  const src        = coverSrc(book)
  const init       = initials(book.title)
  const status     = book.read_status || 'unread'
  const subjects   = Array.isArray(book.subjects) ? book.subjects : []
  const addedDate  = book.added_at ? new Date(book.added_at * 1000).toLocaleDateString() : '—'
  const tags       = book.tags || []

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="book-drawer">

        {/* Cover area */}
        <div className="drawer-cover-area">
          <button className="drawer-close" onClick={onClose}>✕</button>
          {src
            ? <img className="drawer-cover" src={src} alt={book.title} />
            : <div className="drawer-cover-ph"><div className="initials">{init}</div></div>
          }
          {/* Cover upload overlay */}
          <label
            className="drawer-cover-upload"
            title="Upload custom cover"
            style={{
              position: 'absolute', bottom: 8, right: 8,
              background: 'rgba(0,0,0,0.55)', borderRadius: '50%',
              width: 32, height: 32, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', color: '#fff',
              fontSize: 15, lineHeight: 1,
              opacity: uploading ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {uploading ? <span className="spin" style={{ display: 'inline-block' }}>↻</span> : '📷'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => uploadCover(e.target.files[0])}
            />
          </label>
        </div>

        <div className="drawer-body">

          {/* Title / author */}
          <div>
            <div className="drawer-title">{book.title}</div>
            <div className="drawer-author">{displayAuthor(book)}</div>
            {book.series_name && (
              <div className="drawer-series">
                {book.series_name}{book.series_num ? ` · Book ${book.series_num}` : ''}
              </div>
            )}
            {book.manually_edited && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>✏️ Manually edited</div>
            )}
          </div>

          {/* Edit panel or status/note/rating/tags */}
          {showEdit ? (
            <EditPanel
              book={book}
              onSave={() => { load(); setShowEdit(false); refreshLibrary() }}
              onClose={() => setShowEdit(false)}
            />
          ) : (
            <>
              {/* Read status */}
              <div className="drawer-section">
                <div className="drawer-section-label">Reading Status</div>
                <div className="status-toggle status-toggle-4">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`status-btn ${status === opt.value ? `active-${opt.value}` : ''}`}
                      onClick={() => setStatus(opt.value)}
                    >
                      <span className="status-icon">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Star rating */}
              <div className="drawer-section">
                <div className="drawer-section-label">Rating</div>
                <StarRating rating={book.rating} onChange={setRating} />
              </div>

              {/* Note */}
              <div className="drawer-section">
                <div className="drawer-section-label">Personal Note</div>
                <textarea
                  className="note-textarea"
                  placeholder="Any thoughts, quotes, or reminders…"
                  value={note}
                  onChange={e => { setNote(e.target.value); setNoteDirty(true) }}
                />
              </div>

              {/* Tags */}
              <div className="drawer-section">
                <div className="drawer-section-label">Tags</div>
                <TagsEditor
                  bookId={bookId}
                  tags={tags}
                  onChange={next => setBook(b => ({ ...b, tags: next }))}
                />
              </div>
            </>
          )}

          {/* Description */}
          {!showEdit && book.description && (() => {
            const desc = stripHtml(book.description)
            return desc ? (
              <div className="drawer-section">
                <div className="drawer-section-label">Description</div>
                <p style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.6 }}>
                  {desc.slice(0, 400)}{desc.length > 400 ? '…' : ''}
                </p>
              </div>
            ) : null
          })()}

          {/* Subjects */}
          {!showEdit && subjects.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-label">Subjects</div>
              <div className="subjects-wrap">
                {subjects.slice(0, 10).map(s => <span key={s} className="subject-tag">{s}</span>)}
              </div>
            </div>
          )}

          {/* File info + reading dates */}
          {!showEdit && (
            <div className="drawer-section">
              <div className="drawer-section-label">File Info</div>
              <div className="file-info">
                {[
                  ['Format',   book.format?.toUpperCase()],
                  ['Size',     formatFileSize(book.file_size)],
                  ['Language', book.language || '—'],
                  ['Added',    addedDate],
                  book.enriched === true ? ['Metadata', '✓ Enriched from Open Library'] : null,
                ].filter(Boolean).map(([label, value]) => (
                  <div key={label} className="file-info-row">
                    <span className="label">{label}</span>
                    <span className="value" style={label === 'Metadata' ? { color: 'var(--sage-dark)' } : {}}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {!showEdit && (
            <div className="drawer-section">
              <div className="drawer-section-label">Actions</div>
              <div className="drawer-actions">
                {['epub', 'fb2', 'zip', 'doc', 'docx'].includes(book.format) && (
                  <button
                    className="btn btn-primary"
                    onClick={() => openReader(book)}
                    title="Read in ShelfMind"
                  >
                    📖 {(() => {
                      const pos = book.reading_position
                      if (!pos || (pos.spine === 0 && !pos.frac)) return 'Read'
                      return pos.percent >= 1
                        ? `Continue Reading · ${Math.round(pos.percent)}%`
                        : 'Continue Reading'
                    })()}
                  </button>
                )}
                {window.electronAPI && (
                  <button
                    className="btn btn-primary"
                    style={{ background: 'var(--brown)', borderColor: 'var(--brown)' }}
                    onClick={() => window.electronAPI.openFile(book.path)}
                    title="Open in your default reader app"
                  >
                    📂 Open
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => setShowKindle(true)}>
                  📱 Send to Kindle
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowEdit(true); setShowRemove(false) }}>
                  ✏️ Edit Metadata
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={enrich}
                  disabled={enriching}
                >
                  {enriching ? <span className="spin">↻</span> : '🔍'} Fetch from Open Library
                </button>
                {book.format === 'epub' && (
                  <button
                    className="btn btn-secondary"
                    onClick={openImagePicker}
                    disabled={imagesLoading}
                  >
                    {imagesLoading ? <span className="spin">↻</span> : '🖼️'} Pick Cover from File
                  </button>
                )}
                {window.electronAPI && (
                  <button className="btn btn-ghost" onClick={() => window.electronAPI.showItemInFolder(book.path)}>
                    📁 Show in Explorer
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => { navigator.clipboard.writeText(book.path); toast('Path copied') }}>
                  📋 Copy File Path
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setShowRename(r => !r); setShowRemove(false) }}
                >
                  🔤 Rename File…
                </button>
                {showRename && (
                  <RenameConfirm
                    book={book}
                    onConfirm={() => { load(); setShowRename(false) }}
                    onCancel={() => setShowRename(false)}
                  />
                )}

                <div className="divider" />

                {showRemove ? (
                  <RemoveConfirm
                    book={book}
                    onConfirm={() => { onRemoved?.(bookId); onClose() }}
                    onCancel={() => setShowRemove(false)}
                  />
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ color: '#c04040', borderColor: 'transparent' }}
                    onClick={() => setShowRemove(true)}
                  >
                    🗑️ Move to _Removed…
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Epub image picker */}
      {epubImages && epubImages.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }} onClick={() => setEpubImages(null)}>
          <div style={{
            background: 'var(--cream)',
            borderRadius: 'var(--radius-lg)',
            padding: 20,
            maxWidth: 640, width: '100%',
            maxHeight: '80vh', overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Pick a cover image</div>
              <button className="btn btn-ghost" style={{ padding: '3px 10px' }} onClick={() => setEpubImages(null)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
              {epubImages.map((img, i) => (
                <div
                  key={i}
                  style={{ cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '2px solid transparent', transition: 'border-color 0.15s' }}
                  onClick={() => pickCover(img.dataUrl)}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--rose)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                  title={img.name}
                >
                  <img src={img.dataUrl} alt={img.name} style={{ width: '100%', display: 'block', objectFit: 'cover', aspectRatio: '2/3' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '3px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {img.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showKindle && (
        <KindleModal book={book} prefs={prefs} onClose={() => setShowKindle(false)} />
      )}
    </>
  )
}
