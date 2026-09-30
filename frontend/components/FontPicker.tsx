import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { FONT_CATALOG, FONT_CATEGORIES, primaryFontFamily } from '../../shared/font-catalog'

// Clipchamp-style font picker: every name drawn in its own typeface, grouped by
// category. Expands inline (not a floating menu) so a scrolling properties panel
// can't clip it.

interface FontPickerProps {
  /** CSS font-family stack, e.g. "Bebas Neue, sans-serif". */
  value: string
  onChange: (stack: string) => void
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const current = primaryFontFamily(value)

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white hover:border-zinc-600 focus:outline-none focus:border-cyan-500/50"
        title="Font"
      >
        <span className="truncate text-sm" style={{ fontFamily: `${current}, sans-serif` }}>{current}</span>
        <ChevronDown className={`h-3 w-3 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1">
          {FONT_CATEGORIES.map(cat => (
            <div key={cat}>
              <div className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{cat}</div>
              {FONT_CATALOG.filter(f => f.category === cat).map(f => {
                const selected = f.family.toLowerCase() === current.toLowerCase()
                return (
                  <button
                    key={f.family}
                    onClick={() => { onChange(`${f.family}, sans-serif`); setOpen(false) }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                      selected ? 'bg-cyan-600/20 text-white' : 'text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="w-3 shrink-0">{selected && <Check className="h-3 w-3 text-cyan-400" />}</span>
                    <span className="text-base leading-tight truncate" style={{ fontFamily: `${f.family}, sans-serif` }}>{f.family}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
