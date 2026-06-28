/**
 * Tiny shared open/closed flag for the Downloads Browser, so the app shell
 * (App.tsx) can shift the main content over while the panel is open instead
 * of letting the fixed-position panel overlay the editor's Assets panel.
 */
import { useSyncExternalStore } from 'react'

let isOpen = false
const listeners = new Set<() => void>()

export function getDownloadsBrowserOpen(): boolean {
  return isOpen
}

export function setDownloadsBrowserOpen(value: boolean): void {
  if (isOpen === value) return
  isOpen = value
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDownloadsBrowserOpen(): boolean {
  return useSyncExternalStore(subscribe, getDownloadsBrowserOpen)
}
