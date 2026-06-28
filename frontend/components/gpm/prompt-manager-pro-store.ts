/**
 * Tiny shared open/closed flag for the Prompt Manager Pro right dock, mirroring
 * downloads-browser-store.ts — lets the app shell drive it (e.g. a "collapse
 * all panels" hotkey) without prop-drilling.
 */
import { useSyncExternalStore } from 'react'

let isOpen = true
const listeners = new Set<() => void>()

export function getPromptManagerProOpen(): boolean {
  return isOpen
}

export function setPromptManagerProOpen(value: boolean): void {
  if (isOpen === value) return
  isOpen = value
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePromptManagerProOpen(): boolean {
  return useSyncExternalStore(subscribe, getPromptManagerProOpen)
}
