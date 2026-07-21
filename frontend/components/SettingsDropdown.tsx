import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from './ui/tooltip'

// Generic settings dropdown used across the prompt bar's control rows.
export function SettingsDropdown({
  trigger,
  options,
  value,
  onChange,
  title,
  tooltip,
}: {
  trigger: React.ReactNode
  options: { value: string; label: string; disabled?: boolean; tooltip?: string; icon?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
  title: string
  tooltip?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The panel is portalled out of this subtree, so a single containsclick
    // check isn't enough — test the trigger and the panel separately.
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPanelPos({
        left: Math.min(rect.left, window.innerWidth - 180),
        bottom: window.innerHeight - rect.top + 8,
        // The panel grows upward from the trigger (anchored via `bottom`), so with
        // many options (e.g. lots of tags) it can extend above the top of the
        // viewport and render unreachable. Cap it to the space actually available
        // above the trigger and let the option list scroll instead.
        maxHeight: Math.max(120, rect.top - 16),
      })
    }
    setIsOpen(!isOpen)
  }

  const triggerButton = (
    <button
      ref={triggerRef}
      onClick={handleToggle}
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-1.5 rounded-md transition-colors ${isOpen ? 'bg-zinc-700 hover:bg-zinc-700' : 'hover:bg-zinc-800'}`}
    >
      {trigger}
    </button>
  )

  // Rendered via a portal into document.body — AssetCard (and other callers) clip
  // overflow for rounded thumbnails, which would otherwise clip this popup invisible
  // since position:absolute is still contained by an overflow-hidden ancestor.
  const panel = isOpen && panelPos && createPortal(
    (
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: panelPos.left, bottom: panelPos.bottom, maxHeight: panelPos.maxHeight }}
          className="bg-zinc-800 border border-zinc-700 rounded-md p-2 min-w-[160px] shadow-xl z-[9999] flex flex-col"
        >
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 shrink-0">{title}</div>
          {/* Scrolls within the viewport-aware maxHeight above, so a long option list
              (e.g. many tags, or many catalog / custom IC-LoRAs) stays reachable. */}
          <div className="space-y-1 overflow-y-auto">
            {options.map(option => (
              <div key={option.value} className="relative group/option">
                <button
                  onClick={() => { if (!option.disabled) { onChange(option.value); setIsOpen(false) } }}
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-md transition-colors text-left ${
                    option.disabled
                      ? 'cursor-not-allowed'
                      : value === option.value ? 'bg-white/20 hover:bg-white/25' : 'hover:bg-zinc-700'
                  }`}
                >
                  <span className={`flex items-center gap-2.5 text-sm ${
                    option.disabled
                      ? 'text-zinc-600'
                      : value === option.value ? 'text-white' : 'text-zinc-400'
                  }`}>
                    {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                    {option.label}
                  </span>
                  {value === option.value && !option.disabled && (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                {option.disabled && option.tooltip && (
                  <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-zinc-700 rounded text-xs text-zinc-300 whitespace-nowrap opacity-0 group-hover/option:opacity-100 pointer-events-none z-[10000] transition-opacity">
                    {option.tooltip}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
    ),
    document.body,
  )

  return (
    <div className="relative">
      {tooltip && !isOpen ? <Tooltip content={tooltip}>{triggerButton}</Tooltip> : triggerButton}
      {panel}
    </div>
  )
}
