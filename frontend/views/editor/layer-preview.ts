import { useSyncExternalStore } from 'react'
import type { ClipLayerFrame } from '../../types/project-model'

// Live preview of a layer transform the user is dragging in the program monitor
// but hasn't let go of yet, so the media itself follows the handles instead of
// snapping to them on mouse-up. The drag commits once, on release, which keeps a
// drag to a single undo step (the same bargain TextOverlayBox makes). Transient
// UI state — never saved, never exported — so it lives outside the editor store
// and its history, like text-opacity-preview.

export interface LayerPreview { clipId: string; frame: ClipLayerFrame }

let current: LayerPreview | null = null
const listeners = new Set<() => void>()

export function setLayerPreview(next: LayerPreview | null): void {
  current = next
  for (const l of listeners) l()
}

export function getLayerPreview(): LayerPreview | null {
  return current
}

export function useLayerPreview(): LayerPreview | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    getLayerPreview,
    getLayerPreview,
  )
}
