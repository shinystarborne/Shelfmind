import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { API, useApp } from '../App'
import { initials } from './BookCard'

// Inline SVG icons (Lucide-style, stroke=currentColor) — platform emoji
// rendered in a blue that clashed with the app palette.
const ICONS = {
  play:     <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />,
  pause:    <><rect x="5" y="4" width="4.5" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14.5" y="4" width="4.5" height="16" rx="1" fill="currentColor" stroke="none" /></>,
  prev:     <><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" /></>,
  next:     <><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></>,
  chapters: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  clock:    <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  volume:   <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>,
  mute:     <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>,
  check:    <polyline points="20 6 9 17 4 12" />,
  x:        <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
}

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

// Compact duration for chapter rows: "19m 5s" / "1h 12m"
function fmtShort(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h) return m ? `${h}h ${m}m` : `${h}h`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

const SLEEP_PRESETS = [5, 15, 20, 30, 45, 60, 90, 120]
const sleepLabel = min => (min >= 120 ? `${min / 60} hours` : `${min} minutes`)

// Persistent bottom-bar player for Audiobookshelf items. Streams tracks
// straight from ABS (its file endpoint accepts the API token as a query
// param), so no audio proxy is needed — only covers go through our server.
// Positions are tracked at book level (seconds across all tracks), which is
// what ABS chapters, progress, and marks all use.
export default function AudiobookPlayer() {
  const { prefs, player, closePlayer, setPlayerIndex, toast } = useApp()
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime]       = useState(0)
  const [dragT, setDragT]     = useState(null)
  const [speed, setSpeed]     = useState(1)
  const [volume, setVolume]   = useState(() => {
    const v = parseFloat(localStorage.getItem('sm_abs_volume'))
    return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  })
  const [muted, setMuted]     = useState(false)
  const [popover, setPopover] = useState(null)   // null | 'chapters' | 'speed' | 'volume' | 'sleep'
  const [sleep, setSleep]     = useState(null)   // null | { endsAt: ms } | { eoc: true }
  const [customMin, setCustomMin] = useState('')
  const [timeMode, setTimeMode] = useState('book')   // 'book' | 'chapter'
  const [, forceTick]         = useState(0)

  // Ensures a resume offset is applied only once per book open, not on
  // every track change within the same book. pendingSeek carries explicit
  // jump targets (chapter clicks, book-level seek) across track switches.
  const seekAppliedFor = useRef(null)
  const pendingSeek    = useRef(null)
  const latestRef      = useRef({ abs_id: null, bookTime: 0, bookDuration: 0 })

  const tracks   = player.tracks || []
  const track    = tracks[player.index]
  const chapters = player.item.chapters || []
  const base     = String(prefs.abs_url || '').replace(/\/+$/, '')
  const src      = track
    ? `${base}/api/items/${player.item.abs_id}/file/${track.ino}?token=${encodeURIComponent(prefs.abs_token || '')}`
    : null
  const cover    = player.item.cover_url ? `${API.replace(/\/api$/, '')}${player.item.cover_url}` : null

  const trackStarts = useMemo(() => {
    const starts = []
    let acc = 0
    for (const t of tracks) { starts.push(acc); acc += t.duration || 0 }
    return starts
  }, [tracks])
  const bookDuration = trackStarts.length ? trackStarts[trackStarts.length - 1] + (tracks[tracks.length - 1]?.duration || 0) : 0
  const bookTime     = (trackStarts[player.index] || 0) + time
  const percent      = bookDuration ? Math.min(100, (bookTime / bookDuration) * 100) : 0
  const currentChapter = chapters.length
    ? chapters.reduce((acc, c) => (c.start <= bookTime ? c : acc), null)
    : null

  latestRef.current = { abs_id: player.item.abs_id, bookTime, bookDuration }

  // Light progress sync back to ABS so Continue Listening / phone apps agree.
  const syncNow = useCallback(() => {
    const { abs_id, bookTime, bookDuration } = latestRef.current
    if (!abs_id || !bookDuration) return
    fetch(`${API}/audiobooks/${abs_id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentTime: bookTime,
        duration: bookDuration,
        progress: Math.min(1, bookTime / bookDuration),
      }),
    }).catch(() => {})
  }, [])

  // Auto-play on track change; the keyed <audio> remounts with the new src.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !src) return
    a.playbackRate = speed
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed }, [speed])
  useEffect(() => { if (audioRef.current) audioRef.current.volume = muted ? 0 : volume }, [volume, muted, src])
  useEffect(() => { localStorage.setItem('sm_abs_volume', String(volume)) }, [volume])

  // Sync every 20s while playing, and once more when the player closes.
  useEffect(() => {
    if (!playing) return
    const iv = setInterval(syncNow, 20000)
    return () => clearInterval(iv)
  }, [playing, syncNow])
  useEffect(() => () => syncNow(), [syncNow])

  // Sleep timer countdown (time-based; end-of-chapter is checked on timeupdate)
  useEffect(() => {
    if (!sleep) return
    const iv = setInterval(() => {
      forceTick(t => t + 1)
      if (sleep.endsAt && Date.now() >= sleep.endsAt) {
        audioRef.current?.pause()
        setSleep(null)
        toast('Sleep timer ended — paused')
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [sleep, toast])

  // Keyboard shortcuts — active whenever the player is open. Skips text inputs
  // and stays out of the way of the book/PDF readers, where Space and the
  // arrow keys turn pages.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return
      if (document.querySelector('.reader')) return
      if (e.code === 'Space') { toggle() }
      else if (e.key === 'ArrowLeft') jumpToBookTime(bookTime - 15)
      else if (e.key === 'ArrowRight') jumpToBookTime(bookTime + 15)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Scroll the chapters popover to the current chapter when it opens
  useEffect(() => {
    if (popover !== 'chapters') return
    requestAnimationFrame(() => {
      document.querySelector('.abs-chapter-row.active')?.scrollIntoView({ block: 'center' })
    })
  }, [popover])

  const seek = (v) => { const a = audioRef.current; if (a) { a.currentTime = v; setTime(v) } }

  // Jump to a book-level second, switching tracks when needed
  const jumpToBookTime = (t) => {
    t = Math.max(0, Math.min(t, bookDuration))
    let idx = 0, off = t
    for (const tr of tracks) {
      if (off <= (tr.duration || 0)) break
      off -= tr.duration || 0
      idx++
    }
    if (idx >= tracks.length) { idx = tracks.length - 1; off = tracks[idx]?.duration || 0 }
    if (idx === player.index) seek(off)
    else { pendingSeek.current = off; setPlayerIndex(idx) }
  }

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) { a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) }
  }
  // Prev/next step through chapters (book-level); without chapters they fall
  // back to track navigation.
  const prev = () => {
    if (chapters.length) {
      const i = chapters.findLastIndex(c => c.start <= bookTime)
      if (i === -1) { jumpToBookTime(0); return }
      // >3s into the chapter → restart it, otherwise step back one
      const target = (bookTime - chapters[i].start > 3 || i === 0) ? chapters[i] : chapters[i - 1]
      jumpToBookTime(target.start + 0.01)
      return
    }
    if (audioRef.current && audioRef.current.currentTime > 5) seek(0)
    else if (player.index > 0) setPlayerIndex(player.index - 1)
  }
  const next = useCallback(() => {
    if (chapters.length) {
      const i = chapters.findLastIndex(c => c.start <= bookTime)
      if (i < chapters.length - 1) jumpToBookTime(chapters[i + 1].start + 0.01)
      return
    }
    if (player.index < tracks.length - 1) setPlayerIndex(player.index + 1)
    else setPlaying(false)
  }, [chapters, bookTime, tracks.length, player.index, setPlayerIndex])

  const addMark = async () => {
    try {
      await fetch(`${API}/audio-marks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abs_id:       player.item.abs_id,
          title:        player.item.title,
          author:       player.item.author,
          cover_url:    player.item.cover_url,
          external_url: player.item.external_url,
          time:         Math.floor(bookTime),
        }),
      })
      toast(`Mark saved at ${fmt(bookTime)} — see Quotes`, 'success')
    } catch {
      toast('Could not save mark')
    }
  }

  const markFinished = async () => {
    try {
      await fetch(`${API}/audiobooks/${player.item.abs_id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentTime: bookDuration, duration: bookDuration, progress: 1, isFinished: true }),
      })
      toast('Marked as finished', 'success')
    } catch {
      toast('Could not update Audiobookshelf')
    }
    closePlayer()
  }

  const startSleep = (min) => {
    setSleep({ endsAt: Date.now() + min * 60000 })
    setPopover(null)
    setCustomMin('')
    toast(`Sleep timer: ${sleepLabel(min)}`, 'success')
  }

  const sleepRemaining = sleep?.endsAt ? Math.max(0, Math.ceil((sleep.endsAt - Date.now()) / 1000)) : null

  if (!player.tracks) {
    return (
      <div className="abs-player">
        <span className="spin">↻</span>
        <span style={{ fontSize: 14, color: 'var(--text-soft)' }}>Loading {player.item.title}…</span>
        <button className="abs-player-btn" onClick={closePlayer} title="Close player"><Icon name="x" /></button>
      </div>
    )
  }

  return (
    <div className="abs-player">
      <audio
        key={src}
        ref={audioRef}
        src={src}
        preload="auto"
        onLoadedMetadata={e => {
          if (seekAppliedFor.current !== player.item.abs_id) {
            seekAppliedFor.current = player.item.abs_id
            if (player.startOffset) {
              e.target.currentTime = player.startOffset
              setTime(player.startOffset)
            }
          } else if (pendingSeek.current != null) {
            e.target.currentTime = pendingSeek.current
            setTime(pendingSeek.current)
            pendingSeek.current = null
          }
        }}
        onTimeUpdate={e => {
          const t = e.target.currentTime
          setTime(t)
          if (sleep?.eoc) {
            const bt = (trackStarts[player.index] || 0) + t
            const ch = chapters.reduce((acc, c) => (c.start <= bt ? c : acc), null)
            if (ch && bt >= ch.end - 0.3) {
              e.target.pause()
              setSleep(null)
              toast('Sleep timer: end of chapter — paused')
            }
          }
        }}
        onEnded={() => {
          syncNow()
          // Track file ended — advance the actual track, not a chapter
          if (player.index < tracks.length - 1) setPlayerIndex(player.index + 1)
          else setPlaying(false)
        }}
        onPause={() => { setPlaying(false); syncNow() }}
        onPlay={() => setPlaying(true)}
      />

      {cover ? (
        <img className="abs-player-cover" src={cover} alt="" />
      ) : (
        <div className="abs-player-cover abs-player-cover-ph">{initials(player.item.title)}</div>
      )}

      <div className="abs-player-main">
        <div className="abs-player-top">
          <div className="abs-player-info">
            <div className="abs-player-title">{player.item.title}</div>
            <div className="abs-player-sub">
              {player.item.author || 'Unknown'}
              {currentChapter ? ` · ${currentChapter.title}` : ''}
              {tracks.length > 1 ? ` · Track ${player.index + 1}/${tracks.length}` : ''}
            </div>
          </div>

          <div className="abs-player-controls">
            <button className="abs-player-btn" onClick={prev} disabled={!chapters.length && player.index === 0} title="Previous chapter"><Icon name="prev" /></button>
            <button className="abs-player-btn abs-player-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            </button>
            <button className="abs-player-btn" onClick={next} disabled={!chapters.length && player.index >= tracks.length - 1} title="Next chapter"><Icon name="next" /></button>
          </div>

          <div className="abs-player-actions">
            {chapters.length > 0 && (
              <div className="abs-action">
                <button
                  className={`abs-player-btn ${popover === 'chapters' ? 'active' : ''}`}
                  onClick={() => setPopover(p => p === 'chapters' ? null : 'chapters')}
                  title="Chapters"
                ><Icon name="chapters" /></button>
                {popover === 'chapters' && (
                  <div className="abs-popover abs-chapters">
                    {chapters.map((c, i) => (
                      <button
                        key={i}
                        className={`abs-chapter-row ${currentChapter === c ? 'active' : ''}`}
                        onClick={() => { jumpToBookTime(c.start + 0.01); setPopover(null) }}
                      >
                        <span className="abs-chapter-title">
                          {c.title || `Chapter ${i + 1}`}
                          <span className="abs-chapter-dur">{fmtShort(c.end - c.start)}</span>
                        </span>
                        <span className="abs-chapter-time">{fmt(c.start)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button className="abs-player-btn" onClick={addMark} title="Save a mark (shows in Quotes)"><Icon name="bookmark" /></button>

            <div className="abs-action">
              <button
                className={`abs-player-btn ${sleep ? 'active' : ''}`}
                onClick={() => setPopover(p => p === 'sleep' ? null : 'sleep')}
                title="Sleep timer"
              >
                <Icon name="clock" />
                {sleepRemaining != null && <span className="abs-sleep-count">{fmt(sleepRemaining)}</span>}
                {sleep?.eoc && <span className="abs-sleep-count">EOC</span>}
              </button>
              {popover === 'sleep' && (
                <div className="abs-popover abs-sleep">
                  {SLEEP_PRESETS.map(min => (
                    <button key={min} className="abs-sleep-row" onClick={() => startSleep(min)}>{sleepLabel(min)}</button>
                  ))}
                  {chapters.length > 0 && (
                    <button className="abs-sleep-row" onClick={() => { setSleep({ eoc: true }); setPopover(null); toast('Sleep timer: end of chapter', 'success') }}>
                      End of Chapter
                    </button>
                  )}
                  {sleep && (
                    <button className="abs-sleep-row" style={{ color: '#c04040' }} onClick={() => { setSleep(null); setPopover(null) }}>
                      Off
                    </button>
                  )}
                  <div className="abs-sleep-custom">
                    <input
                      className="pref-input"
                      type="number"
                      min="1"
                      placeholder="Time in minutes"
                      value={customMin}
                      onChange={e => setCustomMin(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && +customMin > 0) startSleep(+customMin) }}
                    />
                    <button className="btn btn-secondary" disabled={!(+customMin > 0)} onClick={() => startSleep(+customMin)}>Set</button>
                  </div>
                </div>
              )}
            </div>

            <div className="abs-action">
              <button
                className={`abs-player-btn ${popover === 'volume' ? 'active' : ''}`}
                onClick={() => setPopover(p => p === 'volume' ? null : 'volume')}
                title="Volume"
              ><Icon name={muted || volume === 0 ? 'mute' : 'volume'} /></button>
              {popover === 'volume' && (
                <div className="abs-popover abs-slider-pop">
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={muted ? 0 : volume}
                    onChange={e => { setMuted(false); setVolume(+e.target.value) }}
                  />
                  <span className="abs-slider-val">{Math.round((muted ? 0 : volume) * 100)}%</span>
                  <button className="abs-player-btn" onClick={() => setMuted(m => !m)} title={muted ? 'Unmute' : 'Mute'}>
                    <Icon name={muted ? 'mute' : 'volume'} size={16} />
                  </button>
                </div>
              )}
            </div>

            <div className="abs-action">
              <button
                className={`abs-player-btn abs-speed-label ${popover === 'speed' ? 'active' : ''}`}
                onClick={() => setPopover(p => p === 'speed' ? null : 'speed')}
                title="Playback speed"
              >{parseFloat(speed.toFixed(2))}×</button>
              {popover === 'speed' && (
                <div className="abs-popover abs-slider-pop">
                  <input
                    type="range" min="0.5" max="3" step="0.05"
                    value={speed}
                    onChange={e => setSpeed(+e.target.value)}
                  />
                  <span className="abs-slider-val">{speed.toFixed(2)}×</span>
                </div>
              )}
            </div>

            <button className="abs-player-btn" onClick={markFinished} title="Mark as finished"><Icon name="check" /></button>
            <button className="abs-player-btn" onClick={closePlayer} title="Close player"><Icon name="x" /></button>
          </div>
        </div>

        <div className="abs-player-bottom">
          <span
            className={`abs-player-time ${chapters.length ? 'abs-time-toggle' : ''}`}
            onClick={() => chapters.length && setTimeMode(m => m === 'book' ? 'chapter' : 'book')}
            title={chapters.length ? 'Click to switch between book and chapter time' : undefined}
          >
            {dragT != null
              ? fmt(dragT)
              : timeMode === 'chapter' && currentChapter
                ? fmt(Math.max(0, bookTime - currentChapter.start))
                : fmt(bookTime)}
          </span>
          <input
            className="abs-player-seek"
            type="range"
            min={0}
            max={bookDuration || 0}
            step={1}
            value={Math.min(dragT ?? bookTime, bookDuration || 0)}
            onChange={e => setDragT(+e.target.value)}
            onPointerUp={() => { if (dragT != null) { jumpToBookTime(dragT); setDragT(null) } }}
            onKeyUp={() => { if (dragT != null) { jumpToBookTime(dragT); setDragT(null) } }}
          />
          <span
            className={`abs-player-time ${chapters.length ? 'abs-time-toggle' : ''}`}
            onClick={() => chapters.length && setTimeMode(m => m === 'book' ? 'chapter' : 'book')}
            title={chapters.length ? 'Click to switch between book and chapter time' : undefined}
          >
            {timeMode === 'chapter' && currentChapter
              ? `−${fmt(Math.max(0, currentChapter.end - bookTime))}`
              : fmt(bookDuration)}
          </span>
          {sleep && (
            <button className="abs-sleep-chip" title="Sleep timer — click to change or cancel" onClick={() => setPopover('sleep')}>
              <Icon name="clock" size={13} />
              {sleepRemaining != null
                ? fmt(sleepRemaining)
                : currentChapter
                  ? fmt(Math.max(0, currentChapter.end - bookTime))
                  : 'EOC'}
            </button>
          )}
          <span className="abs-player-pct" title="Book progress">{Math.floor(percent)}%</span>
        </div>
      </div>

      {popover && <div className="abs-popover-backdrop" onClick={() => setPopover(null)} />}
    </div>
  )
}
