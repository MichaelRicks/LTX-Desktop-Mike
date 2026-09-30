import { useSyncExternalStore } from 'react'

// Live preview of an opacity value the user has dialed in on the properties
// panel but not yet committed as a keyframe (◆). Transient UI state — never
// saved, never exported — so it lives outside the editor store and its history.

export interface OpacityPreview { clipId: string; value: number }

let current: OpacityPreview | null = null
const listeners = new Set<() => void>()

export function setOpacityPreview(next: OpacityPreview | null): void {
  if (current?.clipId === next?.clipId && current?.value === next?.value) return
  current = next
  for (const l of listeners) l()
}

export function getOpacityPreview(): OpacityPreview | null {
  return current
}

export function useOpacityPreview(): OpacityPreview | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    getOpacityPreview,
    getOpacityPreview,
  )
}
