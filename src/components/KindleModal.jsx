import { useState } from 'react'
import { useApp } from '../App'

export default function KindleModal({ book, prefs, onClose }) {
  const { toast } = useApp()
  const [mode, setMode] = useState(prefs?.kindle_mode || 'web')
  const hasEmail = !!prefs?.kindle_email

  const handleWeb = () => {
    // Copy path to clipboard, then open Send to Kindle
    navigator.clipboard.writeText(book.path).catch(() => {})
    const url = 'https://www.amazon.com/sendtokindle'
    if (window.electronAPI) window.electronAPI.openExternal(url)
    else window.open(url, '_blank')
    toast('File path copied — drag it into Send to Kindle')
    onClose()
  }

  const handleEmail = () => {
    const email = prefs.kindle_email
    const subject = encodeURIComponent(book.title)
    const body = encodeURIComponent('Sent from ShelfMind 📚')
    const mailto = `mailto:${email}?subject=${subject}&body=${body}`
    if (window.electronAPI) window.electronAPI.openExternal(mailto)
    else window.location.href = mailto
    toast('Your email client should open with the book title pre-filled. Attach the file manually.', '')
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>📱 Send to Kindle</h2>
        <p style={{ marginBottom: 16 }}>
          <strong>{book.title}</strong><br />
          <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{book.path}</span>
        </p>

        <div className="modal-mode-tabs">
          <button
            className={`modal-mode-tab ${mode === 'web' ? 'active' : ''}`}
            onClick={() => setMode('web')}
          >
            🌐 Web
          </button>
          <button
            className={`modal-mode-tab ${mode === 'email' ? 'active' : ''}`}
            onClick={() => setMode('email')}
          >
            ✉️ Email
          </button>
        </div>

        {mode === 'web' && (
          <>
            <div className="modal-info-box">
              <strong>How it works</strong>
              Opens Amazon's Send to Kindle page in your browser. Your file path is copied to clipboard automatically — drag and drop the file into the page.
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleWeb}>
                Open Send to Kindle
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'email' && (
          <>
            {!hasEmail ? (
              <div className="modal-info-box">
                <strong>Kindle email not set</strong>
                Go to <em>Preferences → Kindle Email</em> and add your <code>@kindle.com</code> address first.
              </div>
            ) : (
              <div className="modal-info-box">
                <strong>Sending to {prefs.kindle_email}</strong>
                Opens your email client with the subject pre-filled. You'll need to attach the file manually from{' '}
                <code style={{ wordBreak: 'break-all', fontSize: 11 }}>{book.path}</code>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleEmail}
                disabled={!hasEmail}
              >
                Open Email Client
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
