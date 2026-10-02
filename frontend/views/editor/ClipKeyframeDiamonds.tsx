import { Diamond } from 'lucide-react'

// A row of keyframe diamonds along the bottom (or top) of a clip on the timeline.
// Drag one to slide the key in time, with the playhead following so the preview
// shows it; click one to park the playhead there and open the clip's properties;
// double-click (or Alt+click) to delete it.
//
// Shared by the opacity and transform rows, which differ only in color, where they
// sit, and what the key means. The 9:16 reframe row keeps its own copy — its keys
// are in source time, not clip-local, so it needs a mapping these callers don't.

export interface ClipKeyframeDiamondsProps {
  /** Key times in clip-local seconds, in the clip's own key order. */
  keys: number[]
  duration: number
  /** Tailwind classes for the diamond, e.g. 'text-amber-300 hover:text-amber-100'. */
  colorClass: string
  /** Row placement within the clip, e.g. 'bottom-0' or 'bottom-3'. */
  rowClass?: string
  title: (index: number) => string
  onDelete: (index: number) => void
  /** Called repeatedly while dragging, with the key's new clip-local time. */
  onMoveKey: (index: number, t: number) => void
  /** Drag finished — a good moment to re-sort the keys. */
  onDragEnd: () => void
  /** Clicked without dragging: park the playhead here and reveal the clip. */
  onPark: (t: number) => void
}

export function ClipKeyframeDiamonds({
  keys, duration, colorClass, rowClass = 'bottom-0', title,
  onDelete, onMoveKey, onDragEnd, onPark,
}: ClipKeyframeDiamondsProps) {
  if (keys.length === 0) return null

  return (
    <div className={`absolute inset-x-0 ${rowClass} h-3 z-20 pointer-events-none`}>
      {keys.map((keyTime, i) => (
        <button
          key={`kf-${i}`}
          className={`absolute bottom-0.5 -translate-x-1/2 hover:scale-125 transition-transform pointer-events-auto cursor-ew-resize ${colorClass}`}
          style={{ left: `${Math.max(0, Math.min(1, keyTime / Math.max(1e-6, duration))) * 100}%` }}
          title={title(i)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(i) }}
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (e.altKey) { onDelete(i); return }
            const rect = (e.currentTarget.closest('[data-clip-id]') as HTMLElement | null)?.getBoundingClientRect()
            if (!rect) return
            const startX = e.clientX
            let dragged = false
            const onMove = (ev: MouseEvent) => {
              // A few pixels of slop, so a click with a shaky hand still counts as a click.
              if (!dragged && Math.abs(ev.clientX - startX) < 3) return
              dragged = true
              onMoveKey(i, Math.max(0, Math.min(duration, ((ev.clientX - rect.left) / rect.width) * duration)))
            }
            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
              document.body.style.cursor = ''
              if (dragged) onDragEnd()
              else onPark(keyTime)
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
            document.body.style.cursor = 'ew-resize'
          }}
        >
          <Diamond className="h-2.5 w-2.5 fill-current" />
        </button>
      ))}
    </div>
  )
}
