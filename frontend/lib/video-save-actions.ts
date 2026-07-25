/**
 * Shared "Save video" / "Save video frame" actions for the app's video players.
 * Used by both the React GenSpace asset viewer and the imperative GPM lightbox,
 * so these are plain functions (no React) that own the full flow:
 * save dialog → copy / ffmpeg frame extract → transient toast.
 */

import { fileUrlToPath } from './file-url'

function baseNameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? 'video'
  return base.replace(/\.[^.]+$/, '')
}

function extOf(p: string): string {
  return p.match(/\.[^.\\/]+$/)?.[0] ?? ''
}

/** Sanitize a caption/prompt into a safe-ish filename stem. */
function toStem(name: string | undefined, fallbackPath: string): string {
  const raw = name?.trim() ? name.trim() : baseNameNoExt(fallbackPath)
  return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
}

let toastEl: HTMLDivElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

function flashToast(message: string, isError = false): void {
  if (toastTimer) clearTimeout(toastTimer)
  if (!toastEl) {
    toastEl = document.createElement('div')
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = message
  toastEl.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483646', 'padding:10px 16px', 'border-radius:8px',
    'font:500 13px system-ui,sans-serif',
    `background:${isError ? '#7f1d1d' : '#16161b'}`,
    'color:#f3f3f6', `border:1px solid ${isError ? '#b91c1c' : '#34343d'}`,
    'box-shadow:0 12px 40px rgba(0,0,0,0.5)', 'pointer-events:none',
  ].join(';')
  toastTimer = setTimeout(() => {
    toastEl?.remove()
    toastEl = null
  }, 2400)
}

/**
 * Copy a video to a user-chosen location. `pathOrUrl` may be a raw filesystem
 * path (GenSpace asset) or a file:// URL (GPM lightbox media.src).
 */
export async function saveVideoFile(pathOrUrl: string, suggestedName?: string): Promise<void> {
  const api = window.electronAPI
  if (!api?.showSaveDialog || !api?.copyFileToPath) {
    flashToast('Save unavailable — please restart the app', true)
    return
  }
  const srcPath = fileUrlToPath(pathOrUrl)
  const ext = extOf(srcPath) || '.mp4'
  try {
    const dest = await api.showSaveDialog({
      title: 'Save Video',
      defaultPath: `${toStem(suggestedName, srcPath)}${ext}`,
      filters: [
        { name: 'Video', extensions: [ext.slice(1)] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!dest) return // user cancelled
    const res = await api.copyFileToPath({ srcPath, destPath: dest })
    flashToast(res?.success ? 'Video saved' : 'Could not save video', !res?.success)
  } catch {
    flashToast('Could not save video', true)
  }
}

/**
 * Save the frame currently shown in `videoEl` as an image at a user-chosen path.
 * Uses ffmpeg (frame-accurate) in the main process rather than a canvas grab,
 * which would taint under production webSecurity.
 */
export async function saveVideoFrame(
  videoEl: HTMLVideoElement,
  pathOrUrl: string,
  suggestedName?: string,
): Promise<void> {
  const api = window.electronAPI
  if (!api?.showSaveDialog || !api?.extractVideoFrame) {
    flashToast('Save unavailable — please restart the app', true)
    return
  }
  const srcPath = fileUrlToPath(pathOrUrl)
  const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0
  let t = Number.isFinite(videoEl.currentTime) ? Math.max(0, videoEl.currentTime) : 0
  // A video paused/ended at its exact duration has no frame to decode AT that
  // timestamp — the accurate seek lands past the final frame and ffmpeg writes
  // nothing. Previews autoplay to the end, so this was failing almost every time.
  // Back off ~one frame from the end so there's always a real frame to grab.
  if (duration > 0 && t > duration - 0.05) t = Math.max(0, duration - 0.05)
  const stem = `${toStem(suggestedName, srcPath)}_frame_${t.toFixed(2).replace('.', '_')}`
  try {
    const dest = await api.showSaveDialog({
      title: 'Save Video Frame',
      defaultPath: `${stem}.png`,
      filters: [
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'JPEG Image', extensions: ['jpg'] },
      ],
    })
    if (!dest) return // user cancelled
    const res = await api.extractVideoFrame({ videoPath: srcPath, seekTime: t, outputPath: dest })
    flashToast(res?.path ? 'Frame saved' : 'Could not save frame', !res?.path)
  } catch {
    flashToast('Could not save frame', true)
  }
}
