/**
 * Film looks: the curated grade presets the video editor applies per clip.
 *
 * A look is deliberately expressible in a form BOTH renderers can execute
 * exactly, so the preview and the export cannot drift:
 *
 *   1. a 3x3 RGB channel matrix     -> SVG feColorMatrix       | ffmpeg colorchannelmixer
 *   2. a per-channel transfer curve -> SVG feComponentTransfer | ffmpeg curves
 *
 * applied in that order on gamma-encoded RGB. Saturation and temperature are
 * folded into the matrix at authoring time rather than handed to a renderer's
 * own saturation knob, because ffmpeg's eq=saturation works in YUV off the
 * stream's colorspace tags while SVG's saturate() is a fixed Rec.709 matrix --
 * the two would disagree on exactly the untagged mp4s this app generates.
 *
 * Curves are 17 evenly spaced samples (x = i/16). SVG interpolates linearly
 * between table entries and ffmpeg splines between knots, but both pass through
 * the same 17 points, so the gap between knots stays well under 1/255.
 *
 * Presets are stable once shipped: a clip stores only { presetId, intensity },
 * so retuning a published preset would restyle finished projects.
 */

export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]
/** 17 evenly spaced output samples for input x = i/16, each in [0,1]. */
export type CurveTable = readonly number[]

export interface FilmLook {
  id: string
  name: string
  /** One line for the picker, describing the look rather than the math. */
  blurb: string
  matrix: Matrix3
  curves: { r: CurveTable, g: CurveTable, b: CurveTable }
}

export const CURVE_STEPS = 33

export const IDENTITY_MATRIX: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
export const IDENTITY_CURVE: CurveTable = Array.from({ length: CURVE_STEPS }, (_, i) => i / (CURVE_STEPS - 1))

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// --- matrix helpers -------------------------------------------------------

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out as unknown as Matrix3
}

export function mixMatrix(from: Matrix3, to: Matrix3, t: number): Matrix3 {
  return from.map((v, i) => v + (to[i] - v) * t) as unknown as Matrix3
}

/** Rec.709 luma weights -- the same ones SVG's saturate() matrix is built from. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

/** s = 0 fully desaturated, 1 unchanged, > 1 more saturated. */
function saturation(s: number): Matrix3 {
  const [lr, lg, lb] = LUMA
  return [
    lr + s * (1 - lr), lg * (1 - s), lb * (1 - s),
    lr * (1 - s), lg + s * (1 - lg), lb * (1 - s),
    lr * (1 - s), lg * (1 - s), lb + s * (1 - lb),
  ]
}

/** Per-channel gain, e.g. warmth as more red / less blue. */
function gain(r: number, g: number, b: number): Matrix3 {
  return [r, 0, 0, 0, g, 0, 0, 0, b]
}

/** Mono conversion with custom channel weights -- how a black-and-white stock's
 *  spectral sensitivity reads: red-weighted flatters skin, blue-weighted darkens it. */
function mono(wr: number, wg: number, wb: number): Matrix3 {
  const sum = wr + wg + wb
  const [r, g, b] = [wr / sum, wg / sum, wb / sum]
  return [r, g, b, r, g, b, r, g, b]
}

// --- curve helpers --------------------------------------------------------

/** Sample a continuous transfer function into a table. */
function curve(fn: (x: number) => number): CurveTable {
  return Array.from({ length: CURVE_STEPS }, (_, i) => clamp01(fn(i / (CURVE_STEPS - 1))))
}

/** Contrast S-curve pivoting on mid grey. k > 0 steepens, k < 0 softens. */
function sCurve(k: number): CurveTable {
  return curve((x) => x - k * Math.sin(2 * Math.PI * x) * 0.5)
}

/** Lift the toe and/or pull the shoulder down: the faded, milky-black film look. */
function fade(blackLift: number, whiteDrop = 0): CurveTable {
  return curve((x) => blackLift + x * (1 - blackLift - whiteDrop))
}

function gamma(g: number): CurveTable {
  return curve((x) => Math.pow(x, g))
}

/**
 * Read a table at an arbitrary x with the same linear interpolation the SVG
 * table transfer uses, so authoring-time composition matches render time.
 */
export function sampleCurve(table: CurveTable, x: number): number {
  const pos = clamp01(x) * (table.length - 1)
  const i = Math.floor(pos)
  if (i >= table.length - 1) return table[table.length - 1]
  return table[i] + (table[i + 1] - table[i]) * (pos - i)
}

/** Apply tables in sequence: later(earlier(x)). */
function chain(...tables: CurveTable[]): CurveTable {
  return curve((x) => tables.reduce((v, t) => sampleCurve(t, v), x))
}

export function mixCurve(from: CurveTable, to: CurveTable, t: number): CurveTable {
  return from.map((v, i) => v + (to[i] - v) * t)
}

// --- the curated set ------------------------------------------------------

export const FILM_LOOKS: readonly FilmLook[] = [
  {
    id: 'super-8',
    name: 'Super 8',
    blurb: 'Warm home-movie stock - soft contrast, milky blacks',
    matrix: multiply(saturation(0.88), gain(1.06, 1.0, 0.94)),
    curves: {
      r: chain(fade(0.06), sCurve(-0.04)),
      g: chain(fade(0.05), sCurve(-0.04)),
      b: chain(fade(0.07), sCurve(-0.04), gamma(1.04)),
    },
  },
  {
    id: '16mm-daylight',
    name: '16mm Daylight',
    blurb: 'Clean documentary stock - fine contrast, slightly cool',
    matrix: multiply(saturation(0.95), gain(0.99, 1.0, 1.03)),
    curves: { r: sCurve(0.05), g: sCurve(0.05), b: chain(sCurve(0.05), fade(0.01)) },
  },
  {
    id: 'theatrical-print',
    name: 'Theatrical Print',
    blurb: 'Release-print grade - teal shadows, warm highlights',
    matrix: multiply(saturation(1.05), gain(1.02, 1.0, 1.0)),
    curves: {
      r: curve((x) => x + 0.05 * x * x - 0.02 * (1 - x)),
      g: sCurve(0.06),
      b: curve((x) => x + 0.05 * (1 - x) * (1 - x) - 0.04 * x * x),
    },
  },
  {
    id: 'tungsten-reversal',
    name: 'Tungsten Reversal',
    blurb: 'Shot cold and pushed - blue shadows, punchy mids',
    matrix: multiply(saturation(1.08), gain(0.95, 0.99, 1.1)),
    curves: { r: sCurve(0.1), g: sCurve(0.1), b: chain(sCurve(0.1), fade(0.04)) },
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    blurb: 'Silver retained - desaturated, hard contrast',
    matrix: saturation(0.35),
    curves: { r: sCurve(0.2), g: sCurve(0.2), b: sCurve(0.2) },
  },
  {
    id: 'cross-process',
    name: 'Cross Process',
    blurb: 'Wrong chemistry on purpose - cyan shadows, acid highlights',
    matrix: multiply(saturation(1.25), gain(1.04, 1.0, 0.98)),
    curves: {
      r: curve((x) => x + 0.2 * x * (1 - x)),
      g: sCurve(0.08),
      b: curve((x) => 0.08 + x * 0.86 - 0.06 * x * x),
    },
  },
  {
    id: 'faded-archive',
    name: 'Faded Archive',
    blurb: 'Decades in a hot attic - low saturation, warm cast',
    matrix: multiply(saturation(0.6), gain(1.08, 1.0, 0.9)),
    curves: { r: fade(0.12, 0.03), g: fade(0.1, 0.05), b: fade(0.1, 0.08) },
  },
  {
    id: 'three-strip',
    name: 'Three Strip',
    blurb: 'Dye-transfer spectacle - dense blacks, loud primaries',
    matrix: multiply(saturation(1.45), gain(1.03, 1.0, 1.0)),
    curves: {
      r: chain(sCurve(0.12), gamma(1.05)),
      g: chain(sCurve(0.12), gamma(1.05)),
      b: chain(sCurve(0.12), gamma(1.08)),
    },
  },
  {
    id: 'day-for-night',
    name: 'Day for Night',
    blurb: 'Noon printed as moonlight - blue, crushed, quiet',
    matrix: multiply(saturation(0.55), gain(0.82, 0.92, 1.18)),
    curves: {
      r: chain(gamma(1.5), fade(0, 0.1)),
      g: chain(gamma(1.45), fade(0, 0.08)),
      b: chain(gamma(1.25), fade(0.02, 0.05)),
    },
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    blurb: 'Last light - warm highlights, open shadows',
    matrix: multiply(saturation(1.1), gain(1.08, 1.01, 0.92)),
    curves: {
      r: curve((x) => x + 0.06 * x),
      g: sCurve(0.03),
      b: chain(fade(0.04), gamma(1.06)),
    },
  },
  {
    id: 'noir',
    name: 'Noir',
    blurb: 'Hard black and white - deep shadows, blown practicals',
    matrix: mono(0.3, 0.6, 0.1),
    curves: { r: sCurve(0.22), g: sCurve(0.22), b: sCurve(0.22) },
  },
  {
    id: 'panchromatic',
    name: 'Panchromatic',
    blurb: 'Classic mono - red-weighted, flattering on skin',
    matrix: mono(0.45, 0.45, 0.1),
    curves: { r: sCurve(0.08), g: sCurve(0.08), b: sCurve(0.08) },
  },
  {
    id: 'ortho',
    name: 'Ortho',
    blurb: 'Blue-sensitive mono - dark skies, dramatic skin',
    matrix: mono(0.1, 0.35, 0.55),
    curves: { r: sCurve(0.12), g: sCurve(0.12), b: sCurve(0.12) },
  },
  {
    id: 'modern-blockbuster',
    name: 'Modern Blockbuster',
    blurb: 'Teal and orange - the contemporary tentpole grade',
    matrix: multiply(saturation(1.12), gain(1.05, 0.99, 1.02)),
    curves: {
      r: curve((x) => x + 0.08 * x * x),
      g: curve((x) => x - 0.02 * x * (1 - x)),
      b: curve((x) => x + 0.1 * (1 - x) * (1 - x) - 0.06 * x * x),
    },
  },
] as const

export const FILM_LOOKS_BY_ID: ReadonlyMap<string, FilmLook> = new Map(FILM_LOOKS.map((l) => [l.id, l]))

/** What a clip stores. Intensity is 0-100; 0 is the untouched image. */
export interface ClipFilmLook { presetId: string, intensity: number }

export interface ResolvedLook { matrix: Matrix3, curves: { r: CurveTable, g: CurveTable, b: CurveTable } }

/**
 * The look at a given intensity, as the numbers both renderers execute.
 * Intensity blends the recipe toward identity, so 40% really is "40% of the way
 * to this look" in preview and export alike. Null when there is nothing to apply.
 */
export function resolveFilmLook(clipLook: ClipFilmLook | undefined | null): ResolvedLook | null {
  if (!clipLook) return null
  const look = FILM_LOOKS_BY_ID.get(clipLook.presetId)
  if (!look) return null
  const t = Math.max(0, Math.min(100, clipLook.intensity)) / 100
  if (t <= 0) return null
  if (t >= 1) return { matrix: look.matrix, curves: look.curves }
  return {
    matrix: mixMatrix(IDENTITY_MATRIX, look.matrix, t),
    curves: {
      r: mixCurve(IDENTITY_CURVE, look.curves.r, t),
      g: mixCurve(IDENTITY_CURVE, look.curves.g, t),
      b: mixCurve(IDENTITY_CURVE, look.curves.b, t),
    },
  }
}

const isIdentityMatrix = (m: Matrix3) => m.every((v, i) => Math.abs(v - IDENTITY_MATRIX[i]) < 1e-6)
const isIdentityCurve = (c: CurveTable) => c.every((v, i) => Math.abs(v - IDENTITY_CURVE[i]) < 1e-6)

/**
 * The look as an ffmpeg filter-chain fragment (no leading comma), or '' when it
 * is a no-op. colorchannelmixer and curves are RGB filters, so ffmpeg inserts the
 * yuv -> rgb conversion itself; both are per-pixel matrix/table ops and cost
 * nothing next to the encoder.
 */
export function ffmpegFilmLookChain(clipLook: ClipFilmLook | undefined | null): string {
  const resolved = resolveFilmLook(clipLook)
  if (!resolved) return ''
  const parts: string[] = []
  const m = resolved.matrix
  if (!isIdentityMatrix(m)) {
    const v = m.map((n) => n.toFixed(4))
    parts.push(
      `colorchannelmixer=rr=${v[0]}:rg=${v[1]}:rb=${v[2]}`
      + `:gr=${v[3]}:gg=${v[4]}:gb=${v[5]}`
      + `:br=${v[6]}:bg=${v[7]}:bb=${v[8]}`,
    )
  }
  const { r, g, b } = resolved.curves
  if (!isIdentityCurve(r) || !isIdentityCurve(g) || !isIdentityCurve(b)) {
    const points = (table: CurveTable) =>
      table.map((y, i) => `${(i / (table.length - 1)).toFixed(4)}/${y.toFixed(4)}`).join(' ')
    parts.push(`curves=r='${points(r)}':g='${points(g)}':b='${points(b)}'`)
  }
  return parts.join(',')
}
