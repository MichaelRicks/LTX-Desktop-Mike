import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FILM_LOOKS,
  FILM_LOOKS_BY_ID,
  IDENTITY_CURVE,
  IDENTITY_MATRIX,
  ffmpegFilmLookChain,
  resolveFilmLook,
  sampleCurve,
} from '../../shared/film-looks.ts'

describe('film looks', () => {
  it('ships a curated set with unique ids', () => {
    assert.ok(FILM_LOOKS.length >= 10)
    assert.equal(new Set(FILM_LOOKS.map((l) => l.id)).size, FILM_LOOKS.length)
    assert.equal(FILM_LOOKS_BY_ID.size, FILM_LOOKS.length)
  })

  it('keeps every curve inside 0..1 and the same length', () => {
    for (const look of FILM_LOOKS) {
      for (const ch of ['r', 'g', 'b'] as const) {
        const table = look.curves[ch]
        assert.equal(table.length, IDENTITY_CURVE.length, `${look.id}.${ch} length`)
        for (const v of table) {
          assert.ok(v >= 0 && v <= 1, `${look.id}.${ch} has ${v} outside 0..1`)
        }
      }
    }
  })

  it('leaves neutral grey neutral in the mono looks', () => {
    // A mono matrix must be a weighted average, or it shifts exposure as well
    // as colour and the preset reads as "darker" rather than "black and white".
    for (const id of ['noir', 'panchromatic', 'ortho']) {
      const m = FILM_LOOKS_BY_ID.get(id)!.matrix
      for (let row = 0; row < 3; row++) {
        const sum = m[row * 3] + m[row * 3 + 1] + m[row * 3 + 2]
        assert.ok(Math.abs(sum - 1) < 1e-6, `${id} row ${row} sums to ${sum}`)
      }
    }
  })

  it('treats a missing preset or zero intensity as no look', () => {
    assert.equal(resolveFilmLook(undefined), null)
    assert.equal(resolveFilmLook({ presetId: 'noir', intensity: 0 }), null)
    assert.equal(resolveFilmLook({ presetId: 'not-a-look', intensity: 100 }), null)
    assert.equal(ffmpegFilmLookChain({ presetId: 'noir', intensity: 0 }), '')
  })

  it('blends toward identity with intensity', () => {
    const full = resolveFilmLook({ presetId: 'noir', intensity: 100 })!
    const half = resolveFilmLook({ presetId: 'noir', intensity: 50 })!
    for (let i = 0; i < 9; i++) {
      const expected = IDENTITY_MATRIX[i] + (full.matrix[i] - IDENTITY_MATRIX[i]) * 0.5
      assert.ok(Math.abs(half.matrix[i] - expected) < 1e-9, `matrix[${i}]`)
    }
    // Half a look is half as far from leaving the pixel alone.
    const fullDelta = Math.abs(sampleCurve(full.curves.r, 0.25) - 0.25)
    const halfDelta = Math.abs(sampleCurve(half.curves.r, 0.25) - 0.25)
    assert.ok(halfDelta < fullDelta)
  })

  it('builds an ffmpeg chain ffmpeg can parse', () => {
    for (const look of FILM_LOOKS) {
      const chain = ffmpegFilmLookChain({ presetId: look.id, intensity: 100 })
      assert.ok(chain.includes('colorchannelmixer=') || chain.includes('curves='), `${look.id} produced nothing`)
      if (chain.includes('curves=')) {
        // Points are quoted because they are space separated; an unbalanced
        // quote silently swallows the rest of the filter graph.
        assert.equal((chain.match(/'/g) ?? []).length % 2, 0, `${look.id} has an odd number of quotes`)
      }
      assert.ok(!chain.includes('NaN'), `${look.id} produced NaN`)
      assert.ok(!/[\n\r]/.test(chain), `${look.id} spans lines`)
    }
  })

  it('samples a curve the way an SVG table transfer does', () => {
    const table = [0, 0.5, 1]
    assert.equal(sampleCurve(table, 0), 0)
    assert.equal(sampleCurve(table, 0.25), 0.25)
    assert.equal(sampleCurve(table, 1), 1)
    // Out of range clamps rather than extrapolating.
    assert.equal(sampleCurve(table, 2), 1)
    assert.equal(sampleCurve(table, -1), 0)
  })
})
