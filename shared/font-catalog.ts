// Text-overlay fonts: one list shared by the editor (picker + live preview) and
// the native export (drawtext fontfile), so the burned-in title uses the same
// font the preview showed.
//
// `bundled` files ship in public/fonts (→ dist/fonts, unpacked from asar so ffmpeg
// can read them); all are OFL / Apache 2.0 (licenses in public/fonts/licenses,
// credited in NOTICES.md). `system` files are Windows fonts we can't redistribute
// but every Windows install has, resolved from the Windows Fonts folder.

export type FontCategory = 'Bold & Display' | 'Fun' | 'Spooky & Elegant' | 'Clean'

export interface FontFiles {
  regular: string
  bold?: string
}

export interface FontEntry {
  family: string
  category: FontCategory
  bundled?: FontFiles
  system?: FontFiles
}

export const FONT_CATEGORIES: FontCategory[] = ['Bold & Display', 'Fun', 'Spooky & Elegant', 'Clean']

export const FONT_CATALOG: FontEntry[] = [
  { family: 'Bebas Neue', category: 'Bold & Display', bundled: { regular: 'BebasNeue-Regular.ttf' } },
  { family: 'Anton', category: 'Bold & Display', bundled: { regular: 'Anton-Regular.ttf' } },
  { family: 'Oswald', category: 'Bold & Display', bundled: { regular: 'Oswald-Regular.ttf', bold: 'Oswald-Bold.ttf' } },
  { family: 'Impact', category: 'Bold & Display', system: { regular: 'impact.ttf' } },
  { family: 'Dela Gothic One', category: 'Bold & Display', bundled: { regular: 'DelaGothicOne-Regular.ttf' } },
  { family: 'Krona One', category: 'Bold & Display', bundled: { regular: 'KronaOne-Regular.ttf' } },

  { family: 'Luckiest Guy', category: 'Fun', bundled: { regular: 'LuckiestGuy-Regular.ttf' } },
  { family: 'Bangers', category: 'Fun', bundled: { regular: 'Bangers-Regular.ttf' } },
  { family: 'Knewave', category: 'Fun', bundled: { regular: 'Knewave-Regular.ttf' } },
  { family: 'Chicle', category: 'Fun', bundled: { regular: 'Chicle-Regular.ttf' } },
  { family: 'Permanent Marker', category: 'Fun', bundled: { regular: 'PermanentMarker-Regular.ttf' } },
  { family: 'Comic Sans MS', category: 'Fun', system: { regular: 'comic.ttf', bold: 'comicbd.ttf' } },

  { family: 'Creepster', category: 'Spooky & Elegant', bundled: { regular: 'Creepster-Regular.ttf' } },
  { family: 'Cinzel', category: 'Spooky & Elegant', bundled: { regular: 'Cinzel-Regular.ttf', bold: 'Cinzel-Bold.ttf' } },
  { family: 'Georgia', category: 'Spooky & Elegant', system: { regular: 'georgia.ttf', bold: 'georgiab.ttf' } },
  { family: 'Times New Roman', category: 'Spooky & Elegant', system: { regular: 'times.ttf', bold: 'timesbd.ttf' } },

  { family: 'Montserrat', category: 'Clean', bundled: { regular: 'Montserrat-Regular.ttf', bold: 'Montserrat-Bold.ttf' } },
  { family: 'Inter', category: 'Clean', system: { regular: 'arial.ttf', bold: 'arialbd.ttf' } },
  { family: 'Arial', category: 'Clean', system: { regular: 'arial.ttf', bold: 'arialbd.ttf' } },
  { family: 'Verdana', category: 'Clean', system: { regular: 'verdana.ttf', bold: 'verdanab.ttf' } },
  { family: 'Courier New', category: 'Clean', system: { regular: 'cour.ttf', bold: 'courbd.ttf' } },
]

/** Primary family name from a CSS font-family stack ("Bebas Neue, sans-serif" → "Bebas Neue"). */
export function primaryFontFamily(stack: string | undefined): string {
  return (stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '')
}

/** Catalog entry for a CSS font-family stack; unknown families (e.g. Helvetica) → Arial. */
export function findFont(stack: string | undefined): FontEntry {
  const name = primaryFontFamily(stack).toLowerCase()
  return FONT_CATALOG.find(f => f.family.toLowerCase() === name)
    ?? FONT_CATALOG.find(f => f.family === 'Arial')!
}

/** CSS weights 600+ (and 'bold') count as bold. */
export function isBoldWeight(weight: string | number | undefined): boolean {
  if (weight === 'bold') return true
  const n = Number(weight)
  return Number.isFinite(n) && n >= 600
}

/** Whether a font actually has a bold face (single-weight display fonts don't). */
export function fontHasBold(stack: string | undefined): boolean {
  const f = findFont(stack)
  return Boolean((f.bundled ?? f.system)?.bold)
}
