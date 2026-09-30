import React from 'react'
import { Diamond, Trash2, Eraser, Crosshair } from 'lucide-react'
import type { TimelineClip } from '../../types/project-model'
import { VerticalFrameGuides } from '../../components/ReframeEditor'
import {
  REFRAME_KEY_EPSILON,
  reframeKeyTime,
  reframePosAt,
  upsertReframeKey,
} from '../../lib/reframe'

// Program-monitor 9:16 guide + per-clip reframe authoring. Drag the frame to set
// the active clip's vertical window; ◆ Key keyframes it at the playhead (after
// the first key, drags write keys automatically). A 9:16 export crops each clip
// to exactly this window (see electron/export/video-filter.ts buildReframeCrop).

const TARGET_RATIO = 9 / 16
const SNAP_PX = 8
const SNAP_LINES = [1 / 3, 1 / 2, 2 / 3]

type ClipReframe = NonNullable<TimelineClip['reframe']>

interface VerticalReframeOverlayProps {
  /** Pixel size of the program monitor's video frame (the 16:9 canvas). */
  frameSize: { width: number; height: number }
  /** Topmost visual clip under the playhead, or null (gap). */
  clip: TimelineClip | null
  /** The clip's source pixel size (falls back to 16:9 when unknown). */
  sourceSize?: { width: number; height: number } | null
  currentTime: number
  isPlaying: boolean
  playbackTimeRef: React.MutableRefObject<number>
  showGrid: boolean
  showSafe: boolean
  onPause: () => void
  onChange: (clipId: string, reframe: ClipReframe | undefined) => void
}

export function VerticalReframeOverlay({
  frameSize, clip, sourceSize, currentTime, isPlaying, playbackTimeRef, showGrid, showSafe, onPause, onChange,
}: VerticalReframeOverlayProps) {
  const editable = clip != null && (clip.type === 'video' || clip.type === 'image')
  const keys = editable ? clip.reframe?.keys ?? [] : []

  // Ride the playhead every frame while playing so keyed moves glide (the store's
  // currentTime isn't updated at frame rate during playback).
  const [liveTime, setLiveTime] = React.useState(currentTime)
  React.useEffect(() => { if (!isPlaying) setLiveTime(currentTime) }, [currentTime, isPlaying])
  React.useEffect(() => {
    if (!isPlaying || keys.length < 2) return
    let id = 0
    const tick = () => { setLiveTime(playbackTimeRef.current); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [isPlaying, keys.length, playbackTimeRef])
  const time = isPlaying ? liveTime : currentTime

  // Where the clip's media actually sits in the 16:9 canvas (object-contain).
  const srcW = sourceSize?.width || clip?.asset?.width || 16
  const srcH = sourceSize?.height || clip?.asset?.height || 9
  const srcRatio = srcW / srcH
  const cw = frameSize.width
  const ch = frameSize.height
  let mw = cw
  let mh = cw / srcRatio
  if (mh > ch) { mh = ch; mw = ch * srcRatio }
  const offX = (cw - mw) / 2
  const offY = (ch - mh) / 2

  const horizontal = srcRatio >= TARGET_RATIO
  const winW = horizontal ? mh * TARGET_RATIO : mw
  const winH = horizontal ? mh : mw / TARGET_RATIO
  const slack = Math.max(0, horizontal ? mw - winW : mh - winH)

  const [dragPos, setDragPos] = React.useState<number | null>(null)
  const [snapLine, setSnapLine] = React.useState<number | null>(null)
  const dragRef = React.useRef<{ startClient: number; startPos: number } | null>(null)

  const pos = dragPos ?? (editable ? reframePosAt(clip, time) : 0.5)
  const winX = offX + (horizontal ? pos * slack : 0)
  const winY = offY + (horizontal ? 0 : pos * slack)
  const keyTime = editable ? reframeKeyTime(clip, time) : 0
  const keyIndex = keys.findIndex(k => Math.abs(k.t - keyTime) < REFRAME_KEY_EPSILON)

  const commit = (p: number) => {
    if (!editable) return
    const clamped = Math.max(0, Math.min(1, p))
    if (keys.length > 0) onChange(clip.id, { pos: clip.reframe?.pos ?? 0.5, keys: upsertReframeKey(keys, keyTime, clamped) })
    else onChange(clip.id, { pos: clamped })
  }

  const snap = (raw: number) => {
    const clamped = Math.max(0, Math.min(1, raw))
    if (slack <= 0) return { p: 0.5, line: null as number | null }
    const axis = horizontal ? mw : mh
    const win = horizontal ? winW : winH
    for (const line of SNAP_LINES) {
      const sp = Math.max(0, Math.min(1, (line * axis - win / 2) / slack))
      if (Math.abs(sp - clamped) * slack <= SNAP_PX) return { p: sp, line }
    }
    return { p: clamped, line: null }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || slack <= 0) return
    e.preventDefault()
    e.stopPropagation()
    if (isPlaying) onPause()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startClient: horizontal ? e.clientX : e.clientY, startPos: pos }
    setDragPos(pos)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || slack <= 0) return
    const s = snap(d.startPos + ((horizontal ? e.clientX : e.clientY) - d.startClient) / slack)
    setDragPos(s.p)
    setSnapLine(s.line)
  }
  const onPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    if (dragPos != null) commit(dragPos) // one undo step per drag
    setDragPos(null)
    setSnapLine(null)
  }

  const addKey = () => {
    if (!editable) return
    if (isPlaying) onPause()
    onChange(clip.id, { pos: clip.reframe?.pos ?? 0.5, keys: upsertReframeKey(keys, keyTime, pos) })
  }
  const deleteKey = () => {
    if (!editable || keyIndex < 0) return
    const next = keys.filter((_, i) => i !== keyIndex)
    onChange(clip.id, next.length ? { pos: clip.reframe?.pos ?? 0.5, keys: next } : { pos: keys[keyIndex].pos })
  }
  const clearKeys = () => {
    if (!editable) return
    onChange(clip.id, { pos })
  }
  const recenter = () => {
    if (!editable) return
    onChange(clip.id, undefined)
  }

  const btn = 'p-1 rounded text-white/90 hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent transition-colors'

  return (
    <>
      {snapLine != null && (
        <div
          className="absolute z-[19] pointer-events-none bg-[rgb(var(--accent))]/70"
          style={horizontal
            ? { left: offX + snapLine * mw, top: offY, height: mh, width: 1 }
            : { top: offY + snapLine * mh, left: offX, width: mw, height: 1 }}
        />
      )}
      <div
        className={`absolute z-[19] border ${editable && slack > 0 ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'} ${
          keyIndex >= 0 ? 'border-amber-400' : snapLine != null ? 'border-[rgb(var(--accent))]' : 'border-white/70'
        }`}
        style={{ left: winX, top: winY, width: winW, height: winH, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseDown={stop}
        onClick={stop}
      >
        <VerticalFrameGuides showGrid={showGrid} showSafe={showSafe} />
      </div>

      {/* Per-clip reframe controls */}
      {editable && (
        <div
          className="absolute top-2 left-2 z-[21] flex items-center gap-0.5 rounded-md bg-black/65 backdrop-blur-sm px-1.5 py-1 text-[10px] text-white/80"
          onMouseDown={stop}
          onPointerDown={stop}
          onClick={stop}
        >
          <span className="font-semibold text-white/90 pr-1">9:16</span>
          <button onClick={addKey} className={`${btn} text-amber-300 flex items-center gap-1 px-1.5`} title="Keyframe the 9:16 frame at the playhead — after the first key, dragging keys automatically">
            <Diamond className={`h-3 w-3 ${keyIndex >= 0 ? 'fill-current' : ''}`} />
            Key
          </button>
          <button onClick={deleteKey} disabled={keyIndex < 0} className={btn} title="Delete the keyframe at the playhead">
            <Trash2 className="h-3 w-3" />
          </button>
          <button onClick={clearKeys} disabled={!keys.length} className={btn} title="Clear keyframes (keeps the current position)">
            <Eraser className="h-3 w-3" />
          </button>
          <button onClick={recenter} disabled={!clip.reframe} className={btn} title="Reset this clip to centered">
            <Crosshair className="h-3 w-3" />
          </button>
          {keys.length > 0 && <span className="pl-1 tabular-nums text-amber-300/90">{keys.length} key{keys.length === 1 ? '' : 's'}</span>}
        </div>
      )}
    </>
  )
}
