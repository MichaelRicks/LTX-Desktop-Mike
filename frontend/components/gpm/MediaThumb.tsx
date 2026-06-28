/**
 * Widescreen (16:9) media thumbnail with hover side-preview and double-click
 * lightbox. Renders a real <video> first-frame for videos (muted) and an <img>
 * for images. Overlay buttons can be passed as children (rendered on top).
 */
import { useRef, type CSSProperties, type ReactNode, type DragEvent } from 'react'
import { Film } from 'lucide-react'
import { schedulePreview, cancelPreview, openLightbox } from './media-preview'

export function MediaThumb({
  src, isVideo, name, children, className, style, draggable, onDragStart, onClick, showVideoBadge = true,
}: {
  src: string
  isVideo: boolean
  name?: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onDragStart?: (e: DragEvent) => void
  onClick?: () => void
  showVideoBadge?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={ref}
      className={`relative overflow-hidden group ${className ?? ''}`}
      style={{ aspectRatio: '16 / 9', background: '#000', ...style }}
      title={name}
      draggable={draggable}
      onDragStart={onDragStart}
      onMouseEnter={() => ref.current && schedulePreview(ref.current, { src, isVideo, name })}
      onMouseLeave={cancelPreview}
      onDoubleClick={() => { cancelPreview(); openLightbox({ src, isVideo, name }) }}
      onClick={onClick}
    >
      {isVideo
        ? <video src={src} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        : <img src={src} alt={name ?? ''} loading="lazy" draggable={false} className="w-full h-full object-cover" />}
      {isVideo && showVideoBadge && (
        <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-semibold flex items-center gap-0.5" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
          <Film size={9} />VIDEO
        </span>
      )}
      {children}
    </div>
  )
}
