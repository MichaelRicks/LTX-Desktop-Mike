import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Grid3x3, Loader2, Smartphone, X, Crop, Play, Pause, Diamond, Trash2, Eraser } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import { interpolateReframe as interpolate, upsertReframeKey, REFRAME_KEY_EPSILON as KEY_EPSILON } from '../lib/reframe'

// "Protect for 9:16": lay a draggable 9:16 frame over a (usually 16:9) image or
// video, then crop to it. The frame always spans the full source height (or width,
// for sources narrower than 9:16), so it only ever slides along one axis.
//
// Videos can also keyframe the frame position over time (a hand-set "auto
// reframe"): once any keyframe exists, dragging/nudging the frame writes a key at
// the playhead, and the export animates the crop between keys with an ease-in-out.

const TARGET_RATIO = 9 / 16
const UPSCALE_SIZE = { width: 1080, height: 1920 }
const SNAP_PX = 8
// Frame-center snap lines, as fractions of the source's free axis.
const SNAP_LINES = [1 / 3, 1 / 2, 2 / 3]

export interface ReframeRect { x: number; y: number; width: number; height: number }
/** A keyframed crop origin, in source pixels, at time `t` (seconds). */
export interface ReframeKeyframe { t: number; x: number; y: number }
interface PosKey { t: number; pos: number }

interface ReframeEditorProps {
  path: string
  type: 'image' | 'video'
  onCancel: () => void
  onSave: (
    rect: ReframeRect,
    upscaleTo: { width: number; height: number } | null,
    keyframes: ReframeKeyframe[] | null,
  ) => Promise<void>
}

function formatT(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Rule-of-thirds grid + approximate TikTok / Reels / Shorts UI zones, drawn to
 * fill whatever 9:16 box it's placed in. Shared with the Video Editor's guide.
 */
export function VerticalFrameGuides({ showGrid, showSafe }: { showGrid: boolean; showSafe: boolean }) {
  return (
    <>
      {showGrid && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/45" />
          <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/45" />
          <div className="absolute left-0 right-0 top-1/3 h-px bg-white/45" />
          <div className="absolute left-0 right-0 top-2/3 h-px bg-white/45" />
        </div>
      )}
      {showSafe && (
        <div className="absolute inset-0 pointer-events-none text-[9px] font-medium uppercase tracking-wide text-white/80">
          <div className="absolute left-0 right-0 top-0 h-[7%] bg-red-500/25 border-b border-red-400/60 flex items-center justify-center">Top bar</div>
          <div className="absolute left-0 right-0 bottom-0 h-[22%] bg-red-500/25 border-t border-red-400/60 flex items-center justify-center">Caption</div>
          <div className="absolute right-0 top-[35%] bottom-[22%] w-[13%] bg-red-500/25 border-l border-red-400/60 flex items-center justify-center [writing-mode:vertical-rl]">Buttons</div>
        </div>
      )}
    </>
  )
}

export function ReframeEditor({ path, type, onCancel, onSave }: ReframeEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [boxW, setBoxW] = useState(0)
  // 0 = frame at the start (left/top) of the free axis, 1 = at the end.
  const [staticPos, setStaticPos] = useState(0.5)
  const [keys, setKeys] = useState<PosKey[]>([])
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [snapped, setSnapped] = useState<number | null>(0.5)
  const [showGrid, setShowGrid] = useState(true)
  const [showSafe, setShowSafe] = useState(false)
  const [upscale, setUpscale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<{ startClient: number; startPos: number } | null>(null)
  const isVideo = type === 'video'

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el)
    setBoxW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Track the playhead every frame while playing so the keyed frame glides.
  useEffect(() => {
    if (!isVideo || !playing) return
    let id = 0
    const tick = () => {
      const v = videoRef.current
      if (v) setTime(v.currentTime)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [isVideo, playing])

  // Fit the media into the available width and 70vh, keeping its aspect.
  const maxH = typeof window !== 'undefined' ? window.innerHeight * (isVideo ? 0.62 : 0.72) : 600
  const srcRatio = natural ? natural.w / natural.h : 16 / 9
  let dispW = boxW
  let dispH = boxW / srcRatio
  if (dispH > maxH) { dispH = maxH; dispW = maxH * srcRatio }

  // Free axis: horizontal when the source is wider than 9:16, else vertical.
  const horizontal = srcRatio >= TARGET_RATIO
  const frameW = horizontal ? dispH * TARGET_RATIO : dispW
  const frameH = horizontal ? dispH : dispW / TARGET_RATIO
  const slack = horizontal ? dispW - frameW : dispH - frameH
  const pos = keys.length ? interpolate(keys, time) : staticPos
  const frameX = horizontal ? pos * slack : 0
  const frameY = horizontal ? 0 : pos * slack
  const alreadyVertical = natural != null && Math.abs(srcRatio - TARGET_RATIO) < 0.01
  const keyAtPlayhead = keys.findIndex(k => Math.abs(k.t - time) < KEY_EPSILON)

  // Source-pixel crop size + origin for a given frame position.
  const cropFor = useCallback((p: number): ReframeRect | null => {
    if (!natural) return null
    if (horizontal) {
      const width = Math.round(natural.h * TARGET_RATIO)
      return { x: Math.round(p * (natural.w - width)), y: 0, width, height: natural.h }
    }
    const height = Math.round(natural.w / TARGET_RATIO)
    return { x: 0, y: Math.round(p * (natural.h - height)), width: natural.w, height }
  }, [natural, horizontal])
  const rect = cropFor(pos)

  const upsertKey = useCallback((t: number, p: number) => {
    setKeys(prev => upsertReframeKey(prev, t, p))
  }, [])

  // Write a position: keyed at the playhead once keys exist, else the static pos.
  const setPosition = useCallback((p: number) => {
    const clamped = Math.min(1, Math.max(0, p))
    if (keys.length) upsertKey(videoRef.current?.currentTime ?? time, clamped)
    else setStaticPos(clamped)
  }, [keys.length, upsertKey, time])

  const snap = useCallback((raw: number): { pos: number; line: number | null } => {
    const clamped = Math.min(1, Math.max(0, raw))
    if (slack <= 0) return { pos: 0.5, line: null }
    const axis = horizontal ? dispW : dispH
    const frame = horizontal ? frameW : frameH
    for (const line of SNAP_LINES) {
      const snapPos = Math.min(1, Math.max(0, (line * axis - frame / 2) / slack))
      if (Math.abs(snapPos - clamped) * slack <= SNAP_PX) return { pos: snapPos, line }
    }
    return { pos: clamped, line: null }
  }, [slack, horizontal, dispW, dispH, frameW, frameH])

  const pause = () => {
    const v = videoRef.current
    if (v && !v.paused) v.pause()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    pause()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startClient: horizontal ? e.clientX : e.clientY, startPos: pos }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || slack <= 0) return
    const delta = (horizontal ? e.clientX : e.clientY) - d.startClient
    const s = snap(d.startPos + delta / slack)
    setSnapped(s.line)
    setPosition(s.pos)
  }
  const onPointerUp = () => { dragRef.current = null }

  const seek = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    setTime(t)
  }
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const addKey = () => { pause(); upsertKey(videoRef.current?.currentTime ?? time, pos) }
  const deleteKey = () => {
    if (keyAtPlayhead < 0) return
    setKeys(prev => {
      const next = prev.filter((_, i) => i !== keyAtPlayhead)
      // Removing the last key hands the frame back to static mode where it sits.
      if (!next.length) setStaticPos(prev[keyAtPlayhead].pos)
      return next
    })
  }
  const clearKeys = () => {
    setStaticPos(pos)
    setKeys([])
  }

  const handleSave = useCallback(async () => {
    const r = cropFor(staticPos)
    if (!r || saving) return
    setSaving(true)
    setError(null)
    try {
      let keyframes: ReframeKeyframe[] | null = null
      let base = r
      if (keys.length === 1) {
        base = cropFor(keys[0].pos) ?? r
      } else if (keys.length > 1) {
        keyframes = keys.map(k => {
          const c = cropFor(k.pos)!
          return { t: k.t, x: c.x, y: c.y }
        })
        base = cropFor(keys[0].pos) ?? r
      }
      await onSave(base, upscale ? UPSCALE_SIZE : null, keyframes)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setSaving(false)
    }
  }, [cropFor, staticPos, keys, upscale, saving, onSave])

  // Arrow keys nudge (Shift = bigger steps) — raw, no snapping, for fine control.
  // Space plays/pauses, Escape leaves reframe mode, Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
      const fwd = horizontal ? 'ArrowRight' : 'ArrowDown'
      const step = e.shiftKey ? 0.05 : 0.005
      if (e.key === back || e.key === fwd) {
        e.preventDefault()
        e.stopPropagation()
        pause()
        setSnapped(null)
        setPosition(pos + (e.key === fwd ? step : -step))
      } else if (e.key === ' ' && isVideo) {
        e.preventDefault()
        e.stopPropagation()
        togglePlay()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const src = pathToFileUrl(path)
  const toggleBtn = (on: boolean) =>
    `px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
      on ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
    }`

  return (
    <div className="w-full">
      <div ref={wrapRef} className="w-full flex justify-center">
        <div
          className="relative overflow-hidden rounded-xl bg-black select-none"
          style={natural ? { width: dispW, height: dispH } : { width: '100%', aspectRatio: '16 / 9' }}
        >
          {isVideo ? (
            <video
              ref={videoRef}
              src={src}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth && v.videoHeight) setNatural({ w: v.videoWidth, h: v.videoHeight })
                if (Number.isFinite(v.duration)) setDuration(v.duration)
              }}
              onPlay={() => setPlaying(true)}
              onPause={(e) => { setPlaying(false); setTime(e.currentTarget.currentTime) }}
              onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            />
          ) : (
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full"
              onLoad={(e) => {
                const i = e.currentTarget
                if (i.naturalWidth && i.naturalHeight) setNatural({ w: i.naturalWidth, h: i.naturalHeight })
              }}
            />
          )}

          {natural && (
            <>
              {/* Snap guide: the source line the frame center locked onto. */}
              {snapped != null && dragRef.current && (
                <div
                  className="absolute pointer-events-none bg-[rgb(var(--accent))]/70"
                  style={horizontal
                    ? { left: snapped * dispW, top: 0, bottom: 0, width: 1 }
                    : { top: snapped * dispH, left: 0, right: 0, height: 1 }}
                />
              )}

              {/* The 9:16 frame. The huge box-shadow dims everything outside it. */}
              <div
                className={`absolute cursor-grab active:cursor-grabbing border-2 ${
                  keyAtPlayhead >= 0 ? 'border-amber-400' : snapped != null ? 'border-[rgb(var(--accent))]' : 'border-white/90'
                }`}
                style={{
                  left: frameX, top: frameY, width: frameW, height: frameH,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <VerticalFrameGuides showGrid={showGrid} showSafe={showSafe} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Video: transport + keyframe track */}
      {isVideo && natural && (
        <div className="mt-3 mx-auto flex items-center gap-2" style={{ width: Math.max(dispW, 320) }}>
          <button
            onClick={togglePlay}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <span className="text-xs text-zinc-400 font-mono tabular-nums w-10 text-right">{formatT(time)}</span>
          <div className="relative flex-1 h-8 flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(time, duration || 0)}
              onMouseDown={pause}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="w-full h-1 accent-[rgb(var(--accent))] cursor-pointer"
            />
            {duration > 0 && keys.map((k, i) => (
              <button
                key={`${k.t}-${i}`}
                onClick={() => { pause(); seek(k.t) }}
                title={`Keyframe at ${formatT(k.t)}`}
                className="absolute top-0 -translate-x-1/2 text-amber-400 hover:text-amber-300"
                style={{ left: `${(k.t / duration) * 100}%` }}
              >
                <Diamond className={`h-3 w-3 ${i === keyAtPlayhead ? 'fill-current' : ''}`} />
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500 font-mono tabular-nums w-10">{formatT(duration)}</span>
          <button
            onClick={addKey}
            className="px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Keyframe the frame position at the playhead. Once keyed, dragging the frame keys it automatically."
          >
            <Diamond className="h-3.5 w-3.5" />
            Key
          </button>
          <button
            onClick={deleteKey}
            disabled={keyAtPlayhead < 0}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-default text-white transition-colors"
            title="Delete the keyframe at the playhead"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={clearKeys}
            disabled={!keys.length}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-default text-white transition-colors"
            title="Clear all keyframes (keeps the current position as a static crop)"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reframe toolbar */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button onClick={() => setShowGrid(g => !g)} className={toggleBtn(showGrid)} title="Rule-of-thirds grid inside the frame">
          <Grid3x3 className="h-4 w-4" />
          Grid
        </button>
        <button
          onClick={() => setShowSafe(s => !s)}
          className={toggleBtn(showSafe)}
          title="Approximate TikTok / Reels / Shorts UI zones — keep faces and text out of the red"
        >
          <Smartphone className="h-4 w-4" />
          Safe zones
        </button>
        <label
          className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium flex items-center gap-2 cursor-pointer hover:bg-zinc-700"
          title="Scale the crop up to the standard vertical size (softer than the native crop)"
        >
          <input type="checkbox" checked={upscale} onChange={(e) => setUpscale(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          Upscale to {UPSCALE_SIZE.width}×{UPSCALE_SIZE.height}
        </label>
        <span className="text-xs text-zinc-500 font-mono tabular-nums px-1">
          {rect ? (upscale ? `${UPSCALE_SIZE.width}×${UPSCALE_SIZE.height}` : `${rect.width}×${rect.height}`) : '…'}
        </span>
        <button
          onClick={() => void handleSave()}
          disabled={!rect || saving || alreadyVertical}
          className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-default text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crop className="h-4 w-4" />}
          {saving ? (isVideo ? 'Cropping video…' : 'Saving…') : keys.length > 1 ? 'Save 9:16 (animated)' : 'Save 9:16'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <X className="h-4 w-4" />
          Done
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-zinc-500">
        {alreadyVertical
          ? 'This is already 9:16.'
          : isVideo
            ? 'Drag the frame · ◆ Key sets a keyframe at the playhead — after that, dragging keys automatically · Space plays · arrows nudge · Enter saves · Esc exits'
            : 'Drag the frame (snaps to center and thirds) · arrow keys nudge, Shift for bigger steps · Enter saves · Esc exits'}
      </p>
      {error && <p className="mt-1 text-center text-xs text-red-400">{error}</p>}
    </div>
  )
}
