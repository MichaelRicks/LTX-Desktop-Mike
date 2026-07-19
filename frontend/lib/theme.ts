/**
 * Curated color-palette themes for the main LTX app.
 *
 * How it works: the Tailwind `zinc-*` scale (which the whole main-app UI uses
 * for its greys/blacks) is redirected to CSS variables `--zinc-50..950` in
 * tailwind.config.js. A palette just rewrites those variables plus the accent,
 * so all ~1000 existing `zinc-*` class uses re-theme at once — no per-component
 * migration. The Studio Pro / GPM panels use their own hex constants and are
 * intentionally left untouched.
 *
 * Persistence is renderer-only (localStorage) — deliberately avoiding the
 * flaky settings.json userData path.
 */

type ZincShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950'

export interface Palette {
  id: string
  name: string
  /** One-line description for the picker. */
  blurb: string
  /** RGB channels ("R G B") for each zinc shade. */
  zinc: Record<ZincShade, string>
  /** Accent RGB channels + darker hover shade. */
  accent: string
  accentDark: string
}

export const PALETTES: Palette[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'The classic neutral black — default.',
    zinc: {
      '50': '250 250 250', '100': '244 244 245', '200': '228 228 231', '300': '212 212 216',
      '400': '161 161 170', '500': '113 113 122', '600': '82 82 91', '700': '63 63 70',
      '800': '39 39 42', '900': '24 24 27', '950': '9 9 11',
    },
    accent: '43 97 255', accentDark: '26 80 224',
  },
  {
    id: 'slate',
    name: 'Slate',
    blurb: 'Cool blue-grey, a touch softer than black.',
    zinc: {
      '50': '248 250 252', '100': '241 245 249', '200': '226 232 240', '300': '203 213 225',
      '400': '148 163 184', '500': '100 116 139', '600': '71 85 105', '700': '51 65 85',
      '800': '30 41 59', '900': '15 23 42', '950': '2 6 23',
    },
    accent: '43 97 255', accentDark: '26 80 224',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    blurb: 'Pure neutral grey, no color tint.',
    zinc: {
      '50': '250 250 250', '100': '245 245 245', '200': '229 229 229', '300': '212 212 212',
      '400': '163 163 163', '500': '115 115 115', '600': '82 82 82', '700': '64 64 64',
      '800': '38 38 38', '900': '23 23 23', '950': '10 10 10',
    },
    accent: '43 97 255', accentDark: '26 80 224',
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    blurb: 'Warm charcoal with an amber accent.',
    zinc: {
      '50': '250 250 249', '100': '245 245 244', '200': '231 229 228', '300': '214 211 209',
      '400': '168 162 158', '500': '120 113 108', '600': '87 83 78', '700': '68 64 60',
      '800': '41 37 36', '900': '28 25 23', '950': '12 10 9',
    },
    accent: '245 158 11', accentDark: '217 119 6',
  },
  {
    id: 'indigo-night',
    name: 'Indigo Night',
    blurb: 'Deep blue-black with an indigo accent.',
    zinc: {
      '50': '246 248 252', '100': '235 238 248', '200': '214 220 238', '300': '186 194 220',
      '400': '140 150 190', '500': '92 103 148', '600': '64 74 112', '700': '44 52 84',
      '800': '26 32 58', '900': '15 20 40', '950': '8 11 24',
    },
    accent: '99 102 241', accentDark: '79 70 229',
  },
  {
    id: 'plum',
    name: 'Plum',
    blurb: 'Dark aubergine with a violet accent.',
    zinc: {
      '50': '249 246 252', '100': '240 234 246', '200': '226 214 234', '300': '208 188 218',
      '400': '178 152 190', '500': '138 110 150', '600': '100 76 112', '700': '72 52 84',
      '800': '48 32 58', '900': '32 20 40', '950': '20 12 26',
    },
    accent: '168 85 247', accentDark: '147 51 234',
  },
]

const STORAGE_KEY = 'ltx-theme-palette'
const DEFAULT_ID = 'midnight'

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

/** Write a palette's variables onto :root. The derived --bg/--surface/etc.
 *  (defined in index.css) reference these, so they follow automatically. */
export function applyPalette(id: string): void {
  const palette = getPalette(id)
  const root = document.documentElement
  for (const [shade, value] of Object.entries(palette.zinc)) {
    root.style.setProperty(`--zinc-${shade}`, value)
  }
  root.style.setProperty('--accent', palette.accent)
  root.style.setProperty('--accent-dark', palette.accentDark)
}

export function getStoredPaletteId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ID
  } catch {
    return DEFAULT_ID
  }
}

export function setStoredPaletteId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage unavailable — theme just won't persist across restarts.
  }
}

/** Apply the persisted palette. Call once at startup, before first paint. */
export function initTheme(): void {
  applyPalette(getStoredPaletteId())
}

/** Apply + persist. Call from the picker. */
export function selectPalette(id: string): void {
  applyPalette(id)
  setStoredPaletteId(id)
}
