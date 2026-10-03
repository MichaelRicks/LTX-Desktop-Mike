/**
 * The SVG filter definitions the preview references for film looks.
 *
 * A look is a 3x3 channel matrix plus a per-channel transfer curve
 * (shared/film-looks.ts), which maps onto feColorMatrix + feComponentTransfer —
 * the same two operations the export runs as ffmpeg's colorchannelmixer +
 * curves, from the same numbers. That is what keeps the preview and the file
 * honest with each other.
 *
 * color-interpolation-filters="sRGB" is load-bearing: SVG filters default to
 * linearRGB, which would silently grade a differently-encoded image than ffmpeg
 * does and put every preset slightly off.
 */

import { resolveFilmLook, type ClipFilmLook } from '../../shared/film-looks'

/** Stable DOM id for a look at an intensity, so the style and the def agree. */
export function filmLookFilterId(look: ClipFilmLook | undefined | null): string | null {
  if (!look) return null
  const intensity = Math.round(Math.max(0, Math.min(100, look.intensity)))
  if (intensity <= 0) return null
  return `film-look-${look.presetId}-${intensity}`
}

export function FilmLookDefs({ looks }: { looks: readonly ClipFilmLook[] }) {
  const seen = new Set<string>()
  const defs: Array<{ id: string, look: ClipFilmLook }> = []
  for (const look of looks) {
    const id = filmLookFilterId(look)
    if (!id || seen.has(id)) continue
    seen.add(id)
    defs.push({ id, look })
  }
  if (defs.length === 0) return null

  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute pointer-events-none" style={{ position: 'absolute' }}>
      <defs>
        {defs.map(({ id, look }) => {
          const resolved = resolveFilmLook(look)
          if (!resolved) return null
          const m = resolved.matrix
          const values = [
            m[0], m[1], m[2], 0, 0,
            m[3], m[4], m[5], 0, 0,
            m[6], m[7], m[8], 0, 0,
            0, 0, 0, 1, 0,
          ].map((v) => v.toFixed(5)).join(' ')
          return (
            <filter
              key={id}
              id={id}
              colorInterpolationFilters="sRGB"
              x="0"
              y="0"
              width="100%"
              height="100%"
            >
              <feColorMatrix type="matrix" values={values} />
              <feComponentTransfer>
                <feFuncR type="table" tableValues={resolved.curves.r.map((v) => v.toFixed(5)).join(' ')} />
                <feFuncG type="table" tableValues={resolved.curves.g.map((v) => v.toFixed(5)).join(' ')} />
                <feFuncB type="table" tableValues={resolved.curves.b.map((v) => v.toFixed(5)).join(' ')} />
              </feComponentTransfer>
            </filter>
          )
        })}
      </defs>
    </svg>
  )
}
