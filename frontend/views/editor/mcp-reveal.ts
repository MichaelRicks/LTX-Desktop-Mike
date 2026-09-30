/**
 * "Watch Claude edit": an apply_edits batch commits atomically (one undo step),
 * then the timeline plays it back — new clips stay hidden and drop in one at a
 * time while the playhead follows, and edited clips flash. Purely visual: the
 * document is already final, so undo/autosave never see the intermediate states.
 */
import { useSyncExternalStore } from 'react'

export type RevealStep = {
  kind: 'add' | 'touch'
  clipIds: string[]
  /** Park the playhead here so the program monitor shows the new shot. */
  time?: number
}

type RevealState = {
  hidden: ReadonlySet<string>
  /** Clips animating right now (drop-in for adds, flash for edits). */
  focus: ReadonlySet<string>
  focusKind: RevealStep['kind'] | null
  step: number
  total: number
}

const IDLE: RevealState = { hidden: new Set(), focus: new Set(), focusKind: null, step: 0, total: 0 }

let state: RevealState = IDLE
let skip: (() => void) | null = null
const listeners = new Set<() => void>()

function set(next: RevealState) {
  state = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useMcpReveal(): RevealState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Show everything that's left immediately. */
export function skipMcpReveal() {
  skip?.()
}

const ENABLED_KEY = 'editor.watchClaudeEdits'

export function isMcpRevealEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== 'false' } catch { return true }
}

export function setMcpRevealEnabled(on: boolean) {
  try { localStorage.setItem(ENABLED_KEY, String(on)) } catch { /* storage unavailable */ }
}

/**
 * Plays the steps back; resolves when done (or skipped). Pacing shrinks for big
 * batches so a 40-clip cut still reveals in ~12s.
 */
export async function playMcpReveal(steps: RevealStep[], seek: (t: number) => void): Promise<void> {
  skip?.() // a new batch finishes the previous playback first
  if (steps.length === 0 || !isMcpRevealEnabled()) return
  const perStep = Math.max(150, Math.min(550, 12000 / steps.length))
  let skipped = false
  let wake: (() => void) | null = null
  const mySkip = () => { skipped = true; wake?.() }
  skip = mySkip
  const hidden = new Set(steps.flatMap(s => (s.kind === 'add' ? s.clipIds : [])))
  set({ hidden: new Set(hidden), focus: new Set(), focusKind: null, step: 0, total: steps.length })
  try {
    for (const [i, s] of steps.entries()) {
      if (skipped) break
      if (s.kind === 'add') for (const id of s.clipIds) hidden.delete(id)
      if (s.time !== undefined) seek(s.time)
      set({ hidden: new Set(hidden), focus: new Set(s.clipIds), focusKind: s.kind, step: i + 1, total: steps.length })
      await new Promise<void>(resolve => {
        wake = resolve
        setTimeout(resolve, perStep)
      })
    }
  } finally {
    // A newer batch may already own the reveal; don't wipe its hidden clips.
    if (skip === mySkip) {
      skip = null
      set(IDLE)
    }
  }
}
