# RiX brand assets

Source artwork lives in `source/`. Everything the app ships is **generated** from
it — don't hand-edit the outputs, change the source or the script and re-run:

```sh
backend/.venv/Scripts/python scripts/build-brand-assets.py   # Windows
backend/.venv/bin/python scripts/build-brand-assets.py       # macOS / Linux
```

Pillow is the only dependency, and `backend/pyproject.toml` already requires it.

## Source files

| File | What it is | Used for |
| --- | --- | --- |
| `rix-appicon-thick.webp` | Chunky white mark on a black rounded square, no gold. 1408², bleeds to the canvas edge. | `resources/icon.{png,ico,icns}`, `resources/icons/*` |
| `rix-lockup-on-cream.webp` | Full stacked lockup — mark, `RIX`, rule-flanked tagline — dark ink + gold on cream. | every `public/brand/*` lockup, both themes |
| `rix-mark-gold-on-black.webp` | Mark only, white→grey gradient with the gold slash and box, on black. | `public/brand/rix-mark-gold*` |
| `rix-lockup-faux-alpha.webp` | **Unusable.** Looks transparent but the checkerboard is painted into the pixels — it's flat RGB like the rest. Kept only so nobody re-downloads it expecting alpha. | — |

None of the sources have an alpha channel, so the script keys the known flat
background out per file and derives the rest.

## Generated assets

**App icon** — `resources/icon.png` (1024), `icon.ico` (16/24/32/48/64/128/256),
`icon.icns`, and `resources/icons/<n>x<n>.png` for Linux.

As drawn, the R fills only ~48% of the square, which collapses to a speck in the
taskbar, so the script rescales it inside the same silhouette: 70% for 64px and
up, 78% at 48px and below. That per-size optical sizing is deliberate — see
`ICON_SCALE` in the script.

**16px is hand-authored**, not downsampled. With only ~12px of drawing area, any
resample blurs the sprocket holes, the counter and the box into grey mush, so
`PIXEL_ICON_16` is the same mark redrawn on the pixel grid — the box dropped,
the R and the film strip squared up so every edge lands on a whole pixel. It
rasterises aliased and ends up strictly two-tone. Edit it as ASCII art; `#` is
ink and `.` is the plate. 24px and up still come from the resampled masters.

`.icns` is written byte-wise rather than through Pillow, whose ICNS writer only
works where macOS' `iconutil` exists — and these builds run on Windows.

**In-app** — `public/brand/`, each at 1x and `@2x`, all transparent:

| Asset | Ink | Where |
| --- | --- | --- |
| `rix-mark` | white + gold | `<RixLogo variant="mark">`, and the left half of the horizontal lockup |
| `rix-wordmark` | white | right half of the horizontal lockup |
| `rix-lockup` | white + gold | `variant="stacked"` — About, the startup screen |
| `rix-lockup-light` | dark + gold | light backgrounds: README, the landing page, print |
| `rix-mark-gold` | gradient + gold | the richer standalone mark, for large empty-state art |

The dark variants are the cream lockup with its *neutral* ink pushed to white;
the gold accent (`#C6923C`) is matched on saturation and left alone.

## Notes

- The wordmark is set `RIX` but the product name is `RiX`. That's inherited from
  the artwork, not a bug in the export.
- `resources/icon_source.svg` is the retired LTX mark, kept for history only —
  nothing reads it.
