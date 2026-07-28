/**
 * Right-click "Save image" menu for React-rendered <img> elements (the asset
 * lightbox). Image counterpart to useVideoSaveMenu — returns an `onContextMenu`
 * handler to attach to the image and a `menu` node to render.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { saveImageFile } from '../lib/video-save-actions'

interface MenuState {
  x: number
  y: number
  sourcePath: string
  name?: string
  /** Optional: restore this generation's recipe into Gen Space. */
  onRegenerate?: () => void
}

const MENU_W = 168
const MENU_H = 45
const ITEM_H = 31

export function useImageSaveMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const onContextMenu = useCallback(
    (
      e: React.MouseEvent<HTMLImageElement>,
      opts: { sourcePath: string; name?: string; onRegenerate?: () => void },
    ) => {
      e.preventDefault()
      const height = MENU_H + (opts.onRegenerate ? ITEM_H : 0)
      const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
      const y = Math.min(e.clientY, window.innerHeight - height - 8)
      setMenu({ x, y, sourcePath: opts.sourcePath, name: opts.name, onRegenerate: opts.onRegenerate })
    },
    [],
  )

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menu])

  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px',
    background: 'transparent', border: 'none', color: '#e4e4e7', fontSize: 13,
    cursor: 'pointer', borderRadius: 6,
  }

  const menuNode = menu
    ? createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 2147483644 }}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
          />
          <div
            style={{
              position: 'fixed', left: menu.x, top: menu.y, width: MENU_W,
              zIndex: 2147483645, padding: 4, borderRadius: 8,
              background: '#18181b', border: '1px solid #34343d',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.onRegenerate && (
              <button
                style={itemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#27272a')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => { menu.onRegenerate?.(); setMenu(null) }}
              >
                Regenerate
              </button>
            )}
            <button
              style={itemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#27272a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => { void saveImageFile(menu.sourcePath, menu.name); setMenu(null) }}
            >
              Save image
            </button>
          </div>
        </>,
        document.body,
      )
    : null

  return { onContextMenu, menu: menuNode }
}
