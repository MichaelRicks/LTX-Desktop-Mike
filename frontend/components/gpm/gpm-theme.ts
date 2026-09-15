/**
 * Shared, palette-aware color tokens for the Prompt Manager Pro / GPM panels.
 *
 * Historically each GPM panel hardcoded its own identical `C` object of hex
 * colors, deliberately excluded from the app's color-palette themes. This module
 * replaces those with one set of tokens that track the active palette, so the
 * GPM panels re-theme along with the rest of the app.
 *
 * The role → shade mapping mirrors the main app: panel/card/elev/border sit on
 * the dark end of the palette's `zinc` scale, text/muted/faint on the light end,
 * and `blue` (GPM's active/selected accent, ~50 uses) follows `--accent` — so it
 * turns violet on Plum, amber on Sandstone, etc. `green`/`amber` stay semantic
 * (success / warning) and are palette-independent.
 *
 * Two flavors, same shape (GpmColors):
 *   • `C` — CSS-var strings (`rgb(var(--zinc-900))` …). For consumers that only
 *     feed colors into inline `style={{}}`, where the browser resolves var() and
 *     re-themes live with zero React wiring.
 *   • `useGpmColors()` — concrete resolved `rgb(r g b)` strings for the current
 *     palette, re-rendering on palette change. Needed by consumers that draw to
 *     <canvas> or set SVG presentation attributes, neither of which resolves var().
 */
import { useEffect, useMemo, useState } from 'react'
import { getPalette, getStoredPaletteId, subscribeTheme } from '../../lib/theme'

export interface GpmColors {
  panel: string; card: string; elev: string
  border: string; borderLt: string
  text: string; muted: string; faint: string
  /** Active/selected accent — follows the palette. */
  blue: string
  /** Same accent at ~0.35 alpha (selected fills). */
  blueSoft: string
  /** Semantic, palette-independent. */
  green: string; amber: string
}

const GREEN = '#28c76f'
const AMBER = '#f5a623'

/** CSS-var tokens — resolve live in inline styles, follow the palette for free. */
export const C: GpmColors = {
  panel: 'rgb(var(--zinc-950))',
  card: 'rgb(var(--zinc-900))',
  elev: 'color-mix(in srgb, rgb(var(--zinc-900)), rgb(var(--zinc-800)))',
  border: 'rgb(var(--zinc-800))',
  borderLt: 'rgb(var(--zinc-700))',
  text: 'rgb(var(--zinc-100))',
  muted: 'rgb(var(--zinc-400))',
  faint: 'rgb(var(--zinc-500))',
  blue: 'rgb(var(--accent))',
  blueSoft: 'rgb(var(--accent) / 0.35)',
  green: GREEN,
  amber: AMBER,
}

// ── concrete resolution (for <canvas> / SVG attributes, which ignore var()) ──
const rgb = (channels: string) => `rgb(${channels})`

/** Blend two "r g b" channel triples at t (0..1). */
function mix(a: string, b: string, t = 0.5): string {
  const pa = a.split(/\s+/).map(Number)
  const pb = b.split(/\s+/).map(Number)
  const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t)
  return `rgb(${m(0)} ${m(1)} ${m(2)})`
}

/** Concrete GPM colors for a given palette id. */
export function resolveGpmColors(paletteId: string): GpmColors {
  const p = getPalette(paletteId)
  return {
    panel: rgb(p.zinc['950']),
    card: rgb(p.zinc['900']),
    elev: mix(p.zinc['900'], p.zinc['800']),
    border: rgb(p.zinc['800']),
    borderLt: rgb(p.zinc['700']),
    text: rgb(p.zinc['100']),
    muted: rgb(p.zinc['400']),
    faint: rgb(p.zinc['500']),
    blue: rgb(p.accent),
    blueSoft: `rgb(${p.accent} / 0.35)`,
    green: GREEN,
    amber: AMBER,
  }
}

/** Concrete GPM colors for the active palette; re-renders on palette change. */
export function useGpmColors(): GpmColors {
  const [id, setId] = useState(getStoredPaletteId)
  useEffect(() => subscribeTheme(setId), [])
  return useMemo(() => resolveGpmColors(id), [id])
}
