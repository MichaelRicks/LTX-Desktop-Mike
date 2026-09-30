import React from 'react'
import type { TextOverlayStyle, TimelineClip } from '../../types/project-model'
import { previewFontWeight } from '../../lib/bundled-fonts'
import { textClipOpacity } from './video-editor-utils'
import { useOpacityPreview } from './text-opacity-preview'

// One text overlay in the program monitor, drawn to match the export pixel-for-
// pixel as far as drawtext allows: sized off the FRAME (fontSize is authored
// against 1080 lines — export scales by frame height too), never auto-wrapped
// (drawtext doesn't wrap; explicit newlines still break), outline drawn outside
// the glyphs like drawtext's borderw.
//
// When selected it gets transform handles: corners resize uniformly (fontSize,
// stays crisp), edges stretch non-uniformly (scaleX / scaleY), Shift+corner
// stretches freely. Scaling is about the center, which is the anchor point.

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

interface TextOverlayBoxProps {
  clip: TimelineClip
  /** Pixel height of the program monitor's video frame. */
  frameHeight: number
  time: number
  selected: boolean
  registerEl: (clipId: string, el: HTMLDivElement | null) => void
  /** Existing select-and-move drag (bound to the anchor, whose parent is the frame). */
  onBodyMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (e: React.MouseEvent) => void
  onTransformCommit: (patch: Partial<TextOverlayStyle>) => void
}

export function TextOverlayBox({
  clip, frameHeight, time, selected, registerEl, onBodyMouseDown, onDoubleClick, onTransformCommit,
}: TextOverlayBoxProps) {
  const ts = clip.textStyle!
  const opacityPreview = useOpacityPreview()
  const previewOpacity = opacityPreview?.clipId === clip.id ? opacityPreview.value : null
  const contentRef = React.useRef<HTMLDivElement>(null)
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const [live, setLive] = React.useState<{ fontSize: number; sx: number; sy: number } | null>(null)

  const fontSize = live?.fontSize ?? ts.fontSize
  const sx = live?.sx ?? ts.scaleX ?? 1
  const sy = live?.sy ?? ts.scaleY ?? 1
  const k = frameHeight / 1080

  // Unscaled box size (transforms don't affect offsetWidth), for the handle frame.
  React.useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => setSize(prev => (prev.w === el.offsetWidth && prev.h === el.offsetHeight ? prev : { w: el.offsetWidth, h: el.offsetHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startHandleDrag = (e: React.MouseEvent, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    const anchor = anchorRef.current
    if (!anchor) return
    const c = anchor.getBoundingClientRect() // zero-size box sitting on the center point
    const dx0 = e.clientX - c.left
    const dy0 = e.clientY - c.top
    const d0 = Math.max(4, Math.hypot(dx0, dy0))
    const start = { fontSize: ts.fontSize, sx: ts.scaleX ?? 1, sy: ts.scaleY ?? 1 }
    let latest = start
    const corner = handle.length === 2
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - c.left
      const dy = ev.clientY - c.top
      const next = { ...start }
      if (corner && !ev.shiftKey) {
        next.fontSize = Math.round(clamp(start.fontSize * (Math.hypot(dx, dy) / d0), 8, 600))
      } else {
        if (handle.includes('e') || handle.includes('w')) next.sx = clamp(start.sx * Math.abs(dx) / Math.max(4, Math.abs(dx0)), 0.1, 10)
        if (handle.includes('n') || handle.includes('s')) next.sy = clamp(start.sy * Math.abs(dy) / Math.max(4, Math.abs(dy0)), 0.1, 10)
      }
      latest = next
      setLive(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLive(null)
      // One history step per drag.
      if (latest !== start) {
        onTransformCommit({
          fontSize: latest.fontSize,
          scaleX: Math.round(latest.sx * 1000) / 1000,
          scaleY: Math.round(latest.sy * 1000) / 1000,
        })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const stroke = ts.strokeWidth > 0 && ts.strokeColor !== 'transparent'
  const hasShadow = ts.shadowBlur > 0 || ts.shadowOffsetX !== 0 || ts.shadowOffsetY !== 0

  return (
    <div
      ref={(el) => { anchorRef.current = el; registerEl(clip.id, el) }}
      className="absolute z-[24]"
      style={{
        left: `${ts.positionX}%`,
        top: `${ts.positionY}%`,
        width: 0,
        height: 0,
        opacity: textClipOpacity(clip, time, previewOpacity),
      }}
      onMouseDown={onBodyMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={contentRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(-50%, -50%) scale(${sx}, ${sy})`,
          transformOrigin: 'center center',
          cursor: 'move',
          pointerEvents: 'auto',
          fontFamily: ts.fontFamily,
          fontSize: `${fontSize * k}px`,
          fontWeight: previewFontWeight(ts.fontFamily, ts.fontWeight),
          fontStyle: ts.fontStyle,
          color: ts.color,
          backgroundColor: ts.backgroundColor,
          textAlign: ts.textAlign,
          padding: ts.padding > 0 ? `${ts.padding * k}px` : undefined,
          borderRadius: ts.borderRadius > 0 ? `${ts.borderRadius * k}px` : undefined,
          letterSpacing: ts.letterSpacing !== 0 ? `${ts.letterSpacing * k}px` : undefined,
          lineHeight: ts.lineHeight,
          textShadow: hasShadow
            ? `${ts.shadowOffsetX * k}px ${ts.shadowOffsetY * k}px ${ts.shadowBlur * k}px ${ts.shadowColor}`
            : undefined,
          // drawtext's borderw sits OUTSIDE the glyph; a CSS stroke is centered on
          // the edge, so draw it twice as wide behind the fill.
          WebkitTextStroke: stroke ? `${2 * ts.strokeWidth * k}px ${ts.strokeColor}` : undefined,
          paintOrder: stroke ? 'stroke fill' : undefined,
          whiteSpace: 'pre',
          userSelect: 'none',
        }}
      >
        {ts.text}
      </div>

      {selected && size.w > 0 && (
        <div
          className="absolute border border-cyan-400/80 pointer-events-none"
          style={{ left: 0, top: 0, width: size.w * sx, height: size.h * sy, transform: 'translate(-50%, -50%)' }}
        >
          {HANDLES.map(h => (
            <div
              key={h.id}
              onMouseDown={(e) => startHandleDrag(e, h.id)}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-cyan-500 bg-white pointer-events-auto"
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
              title={h.id.length === 2 ? 'Drag to resize (Shift: stretch freely)' : 'Drag to stretch'}
            />
          ))}
        </div>
      )}
    </div>
  )
}
