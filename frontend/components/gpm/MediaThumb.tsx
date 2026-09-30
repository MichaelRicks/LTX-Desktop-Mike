/**
 * Media thumbnail (16:9 by default; `naturalAspect` takes the media's own shape) with hover side-preview and double-click
 * lightbox. Renders a real <video> first-frame for videos (muted) and an <img>
 * for images. Overlay buttons can be passed as children (rendered on top).
 */
import { useRef, useState, type CSSProperties, type ReactNode, type DragEvent } from 'react'
import { Film, Music } from 'lucide-react'
import { schedulePreview, cancelPreview, openLightbox } from './media-preview'

// Measured media shapes, so a thumbnail that has loaded once lays out at its
// real aspect immediately next time (no 16:9 → 9:16 jump on re-render).
const measuredRatios = new Map<string, number>()
const clampRatio = (r: number) => Math.max(0.5, Math.min(2.4, r))

export function MediaThumb({
  src, isVideo, isAudio, name, children, className, style, draggable, onDragStart, onClick, showVideoBadge = true,
  naturalAspect = false,
}: {
  src: string
  isVideo: boolean
  isAudio?: boolean
  name?: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onDragStart?: (e: DragEvent) => void
  onClick?: () => void
  showVideoBadge?: boolean
  /** Size the thumbnail to the media's own aspect (measured on load) instead of 16:9. */
  naturalAspect?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState<number | undefined>(() => measuredRatios.get(src))
  const measure = (w: number, h: number) => {
    if (!naturalAspect || !w || !h) return
    const r = clampRatio(w / h)
    measuredRatios.set(src, r)
    setRatio(r)
  }
  const aspect = naturalAspect && !isAudio && ratio ? ratio : 16 / 9
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden group ${className ?? ''}`}
      style={{ aspectRatio: aspect, background: '#000', ...style }}
      title={name}
      draggable={draggable}
      onDragStart={onDragStart}
      onMouseEnter={() => { if (!isAudio && ref.current) schedulePreview(ref.current, { src, isVideo, name }) }}
      onMouseLeave={cancelPreview}
      onDoubleClick={() => { cancelPreview(); openLightbox({ src, isVideo, isAudio, name }) }}
      onClick={onClick}
    >
      {isAudio
        ? (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgb(var(--zinc-900))' }}>
            <Music size={28} style={{ color: 'rgb(var(--zinc-500))' }} />
          </div>
        )
        : isVideo
          ? <video src={src} muted playsInline preload="metadata" className="w-full h-full object-cover"
              onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
          : <img src={src} alt={name ?? ''} loading="lazy" draggable={false} className="w-full h-full object-cover"
              onLoad={(e) => measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />}
      {isVideo && showVideoBadge && (
        <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-semibold flex items-center gap-0.5" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          <Film size={9} />VIDEO
        </span>
      )}
      {isAudio && showVideoBadge && (
        <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-semibold flex items-center gap-0.5" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          <Music size={9} />AUDIO
        </span>
      )}
      {children}
    </div>
  )
}
