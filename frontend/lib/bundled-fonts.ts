import { FONT_CATALOG, fontHasBold, isBoldWeight } from '../../shared/font-catalog'

// Register the fonts shipped in public/fonts with the renderer. Resolved against
// document.baseURI so it works both from the Vite dev server and from the
// packaged file:// build (public/ → dist/).
let registered = false

export function registerBundledFonts(): void {
  if (registered || typeof document === 'undefined' || !('fonts' in document)) return
  registered = true
  for (const f of FONT_CATALOG) {
    if (!f.bundled) continue
    const url = (file: string) => `url("${new URL(`fonts/${file}`, document.baseURI).href}")`
    // Single-weight fonts claim the whole weight range so a Bold request reuses the
    // real glyphs instead of the browser faking a bold the export can't reproduce.
    const faces: FontFace[] = f.bundled.bold
      ? [
          new FontFace(f.family, url(f.bundled.regular), { weight: '100 500' }),
          new FontFace(f.family, url(f.bundled.bold), { weight: '600 900' }),
        ]
      : [new FontFace(f.family, url(f.bundled.regular), { weight: '100 900' })]
    for (const face of faces) {
      document.fonts.add(face)
      face.load().catch(() => { /* missing file: falls back to the next font in the stack */ })
    }
  }
}

/**
 * The weight to PREVIEW with: fonts without a bold face render normal, since the
 * export draws their only face — keeps the preview honest about the output.
 */
export function previewFontWeight(fontFamily: string, weight: string): string {
  return isBoldWeight(weight) && !fontHasBold(fontFamily) ? 'normal' : weight
}
