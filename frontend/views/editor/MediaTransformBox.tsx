import React from 'react'
import type { ClipLayerFrame, TimelineClip } from '../../types/project-model'
import { clipLayerAt } from './video-editor-utils'

// The transform box for a selected video/image clip in the program monitor: drag
// the body to move the graphic, corners to resize it, edges to stretch one axis.
// The sibling of TextOverlayBox, and deliberately the same gestures — corners
// uniform, edges non-uniform, Shift+corner to stretch freely, one undo step per
// drag — so a logo and a title behave the same way under the hand.
//
// The box only draws the outline and handles. The media underneath is a plain
// frame-filling element that ProgramMonitor styles per frame, so during a drag
// this reports to the layer-preview store and the monitor restyles the element;
// on release it commits once.

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Array<{ id: Handle; x: number; y: number; cursor: string }> = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** Position is allowed well past the edges so a graphic can sit part-way off frame. */
const clampPos = (v: number) => clamp(v, -0.5, 1.5)
const clampScale = (v: number) => clamp(v, 0.02, 10)
const round = (v: number) => Math.round(v * 10000) / 10000

/**
 * The rectangle the media actually paints at scale 1 — object-contain fits the
 * source inside the frame and centers it, so this is the letterboxed fit, not the
 * whole frame. Unknown source size (no probe yet) falls back to the frame itself,
 * which is what an unscaled clip looks like anyway.
 */
function fittedMediaRect(clip: TimelineClip, frame: { width: number; height: number }): { w: number; h: number } {
  const sw = clip.asset?.width
  const sh = clip.asset?.height
  if (!sw || !sh || frame.width <= 0 || frame.height <= 0) return { w: frame.width, h: frame.height }
  const sourceAspect = sw / sh
  const frameAspect = frame.width / frame.height
  return sourceAspect > frameAspect
    ? { w: frame.width, h: frame.width / sourceAspect }
    : { w: frame.height * sourceAspect, h: frame.height }
}

export interface MediaTransformBoxProps {
  clip: TimelineClip
  /** Program-monitor video frame size, in px. */
  frameSize: { width: number; height: number }
  /** Seconds from the clip's start — which layer key(s) a drag lands on. */
  timeInClip: number
  /** Live, uncommitted transform during a drag; null when the drag ends. */
  onPreview: (frame: ClipLayerFrame | null) => void
  /** True while a drag is in flight, false a frame after it ends — late enough
   *  that the click the mouseup generates has already been and gone. */
  onDragActiveChange: (active: boolean) => void
  onCommit: (patch: Partial<ClipLayerFrame>) => void
}

export function MediaTransformBox({
  clip, frameSize, timeInClip, onPreview, onDragActiveChange, onCommit,
}: MediaTransformBoxProps) {
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [live, setLive] = React.useState<ClipLayerFrame | null>(null)
  const committed = clipLayerAt(clip, timeInClip)
  const frame = live ?? committed
  const fitted = fittedMediaRect(clip, frameSize)

  const w = fitted.w * frame.scaleX
  const h = fitted.h * frame.scaleY
  const cx = frame.x * frameSize.width
  const cy = frame.y * frameSize.height

  // A drag reads from the values at mousedown, never from `live`, so the gesture
  // stays absolute — jitter can't accumulate across moves.
  const runDrag = (
    e: React.MouseEvent,
    compute: (ev: MouseEvent, start: ClipLayerFrame) => ClipLayerFrame,
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const start = clipLayerAt(clip, timeInClip)
    let latest = start
    let moved = false
    onDragActiveChange(true)

    const onMove = (ev: MouseEvent) => {
      latest = compute(ev, start)
      moved = true
      setLive(latest)
      onPreview(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLive(null)
      // Nothing at all for a click that didn't move — but the guard still has to
      // outlive the click, or clicking the box would deselect the clip.
      if (!moved) {
        onPreview(null)
        requestAnimationFrame(() => onDragActiveChange(false))
        return
      }
      // One history step per drag.
      onCommit({
        x: round(latest.x),
        y: round(latest.y),
        scaleX: round(latest.scaleX),
        scaleY: round(latest.scaleY),
      })
      // Hold the preview for one frame: the commit re-renders the monitor, and
      // dropping the preview before that repaints the pre-drag position.
      requestAnimationFrame(() => {
        onPreview(null)
        onDragActiveChange(false)
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startMove = (e: React.MouseEvent) => {
    const originX = e.clientX
    const originY = e.clientY
    runDrag(e, (ev, start) => ({
      ...start,
      x: clampPos(start.x + (ev.clientX - originX) / Math.max(1, frameSize.width)),
      y: clampPos(start.y + (ev.clientY - originY) / Math.max(1, frameSize.height)),
    }))
  }

  const startResize = (e: React.MouseEvent, handle: Handle) => {
    // Scale off the pointer's distance from the center, which is the anchor the
    // transform scales about — so the handle tracks the cursor. The center in
    // screen space comes from the box's own rect, whose offset within the frame we
    // already know, so this doesn't depend on the DOM nesting above it.
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect) return
    const originX = rect.left + w / 2
    const originY = rect.top + h / 2
    const dx0 = Math.max(4, Math.abs(e.clientX - originX))
    const dy0 = Math.max(4, Math.abs(e.clientY - originY))
    const d0 = Math.max(4, Math.hypot(e.clientX - originX, e.clientY - originY))
    const corner = handle.length === 2

    runDrag(e, (ev, start) => {
      const next = { ...start }
      if (corner && !ev.shiftKey) {
        const factor = Math.hypot(ev.clientX - originX, ev.clientY - originY) / d0
        next.scaleX = clampScale(start.scaleX * factor)
        next.scaleY = clampScale(start.scaleY * factor)
      } else {
        if (handle.includes('e') || handle.includes('w')) {
          next.scaleX = clampScale(start.scaleX * Math.abs(ev.clientX - originX) / dx0)
        }
        if (handle.includes('n') || handle.includes('s')) {
          next.scaleY = clampScale(start.scaleY * Math.abs(ev.clientY - originY) / dy0)
        }
      }
      return next
    })
  }

  if (frameSize.width <= 0) return null

  return (
    <div
      ref={boxRef}
      className="absolute z-[23] border border-cyan-400/80"
      style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, cursor: 'move' }}
      onMouseDown={startMove}
      onClick={(e) => e.stopPropagation()}
      title="Drag to move. Corners resize, edges stretch."
    >
      {HANDLES.map(handle => (
        <div
          key={handle.id}
          onMouseDown={(e) => startResize(e, handle.id)}
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-500 bg-white"
          style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%`, cursor: handle.cursor }}
          title={handle.id.length === 2 ? 'Drag to resize (Shift: stretch freely)' : 'Drag to stretch'}
        />
      ))}
    </div>
  )
}
