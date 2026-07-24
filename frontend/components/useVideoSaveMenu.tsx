/**
 * Right-click "Save video / Save video frame" menu for React-rendered <video>
 * players. Returns an `onContextMenu` handler to attach to the video and a
 * `menu` node to render. The imperative GPM lightbox has its own DOM version;
 * both share the actions in ../lib/video-save-actions.
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { saveVideoFile, saveVideoFrame } from '../lib/video-save-actions'

interface MenuState {
  x: number
  y: number
  video: HTMLVideoElement
  sourcePath: string
  name?: string
  /** Optional per-video action: restore this generation's recipe into Gen Space. */
  onRegenerate?: () => void
}

const MENU_W = 168
const MENU_H = 76
const ITEM_H = 31

export function useVideoSaveMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const onContextMenu = useCallback(
    (
      e: React.MouseEvent<HTMLVideoElement>,
      opts: { sourcePath: string; name?: string; onRegenerate?: () => void },
    ) => {
      e.preventDefault()
      // Clamp so the menu stays on-screen near the cursor.
      const height = MENU_H + (opts.onRegenerate ? ITEM_H : 0)
      const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
      const y = Math.min(e.clientY, window.innerHeight - height - 8)
      setMenu({
        x, y, video: e.currentTarget,
        sourcePath: opts.sourcePath, name: opts.name, onRegenerate: opts.onRegenerate,
      })
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
          {/* Full-screen backdrop: an outside click / right-click dismisses the
              menu. Sits just below the menu so the menu buttons stay clickable. */}
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
            onClick={() => { void saveVideoFile(menu.sourcePath, menu.name); setMenu(null) }}
          >
            Save video
          </button>
          <button
            style={itemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#27272a')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => { void saveVideoFrame(menu.video, menu.sourcePath, menu.name); setMenu(null) }}
          >
            Save video frame
          </button>
        </div>
        </>,
        document.body,
      )
    : null

  return { onContextMenu, menu: menuNode }
}
