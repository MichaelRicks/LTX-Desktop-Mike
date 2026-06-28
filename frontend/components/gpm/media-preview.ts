/**
 * Shared media preview for Prompt Manager Pro thumbnails (ported from the Grok
 * extension's hover-preview + lightbox).
 *  - Hover (500ms delay) → a larger preview popup to the side; videos autoplay
 *    muted + looped, images scale to fit. Dismissed on leave / scroll / click.
 *  - Double-click → a fullscreen lightbox; images zoom, videos play with sound.
 * Implemented imperatively against document.body so a single shared popup/lightbox
 * serves every thumbnail without React plumbing.
 */

export interface PreviewMedia { src: string; isVideo: boolean; isAudio?: boolean; name?: string }

const DELAY_MS = 500
const MAX = 480
const GAP = 12

let hoverEl: HTMLDivElement | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function ensureHover(): HTMLDivElement {
  if (hoverEl) return hoverEl
  const el = document.createElement('div')
  el.id = 'gpm-hover-preview'
  el.style.cssText = [
    'position:fixed', 'z-index:2147483600', 'pointer-events:none', 'display:none',
    'border-radius:10px', 'overflow:hidden', 'background:#0e0e12',
    'border:1px solid #34343d', 'box-shadow:0 18px 50px rgba(0,0,0,0.6)',
  ].join(';')
  document.body.appendChild(el)
  window.addEventListener('scroll', hidePreview, true)
  window.addEventListener('click', hidePreview, true)
  hoverEl = el
  return el
}

export function schedulePreview(anchor: HTMLElement, media: PreviewMedia): void {
  if (!media.src) return
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => showPreview(anchor, media), DELAY_MS)
}

export function cancelPreview(): void {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  hidePreview()
}

function showPreview(anchor: HTMLElement, media: PreviewMedia): void {
  const el = ensureHover()
  el.innerHTML = ''
  const common = 'display:block;max-width:480px;max-height:480px;width:auto;height:auto;'
  if (media.isVideo) {
    const v = document.createElement('video')
    v.src = media.src; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true
    v.setAttribute('playsinline', ''); v.draggable = false; v.style.cssText = common
    el.appendChild(v)
    void v.play().catch(() => {})
  } else {
    const img = document.createElement('img')
    img.src = media.src; img.draggable = false; img.style.cssText = common
    el.appendChild(img)
  }
  el.style.display = 'block'
  el.style.left = '-9999px'
  el.style.top = '0px'
  requestAnimationFrame(() => positionPreview(anchor))
}

function positionPreview(anchor: HTMLElement): void {
  if (!hoverEl) return
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(hoverEl.offsetWidth || MAX, MAX)
  const h = Math.min(hoverEl.offsetHeight || MAX, MAX)
  let left = r.left - w - GAP
  let top = r.top + r.height / 2 - h / 2
  if (left < 8) {
    const right = r.right + GAP
    if (right + w <= vw - 8) left = right
    else {
      left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2))
      const above = r.top - h - GAP, below = r.bottom + GAP
      top = above >= 8 ? above : (below + h <= vh - 8 ? below : top)
    }
  }
  hoverEl.style.top = Math.max(8, Math.min(vh - h - 8, top)) + 'px'
  hoverEl.style.left = Math.max(8, Math.min(vw - w - 8, left)) + 'px'
}

function hidePreview(): void {
  if (!hoverEl) return
  const v = hoverEl.querySelector('video')
  if (v) v.pause()
  hoverEl.style.display = 'none'
  hoverEl.innerHTML = ''
}

// ── Lightbox ────────────────────────────────────────────────────────────────
let lightboxEl: HTMLDivElement | null = null

export function openLightbox(media: PreviewMedia): void {
  cancelPreview()
  closeLightbox()
  const overlay = document.createElement('div')
  overlay.id = 'gpm-lightbox'
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483601', 'background:rgba(0,0,0,0.85)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:32px',
  ].join(';')

  const stop = (e: Event) => e.stopPropagation()
  const inner = 'max-width:95vw;max-height:92vh;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,0.7);'
  if (media.isAudio) {
    const a = document.createElement('audio')
    a.src = media.src; a.controls = true; a.autoplay = true
    a.style.cssText = 'width:min(80vw,480px);' + inner; a.onclick = stop
    overlay.appendChild(a)
    void a.play().catch(() => {})
  } else if (media.isVideo) {
    const v = document.createElement('video')
    v.src = media.src; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true
    v.style.cssText = inner; v.onclick = stop
    overlay.appendChild(v)
    void v.play().catch(() => {})
  } else {
    const img = document.createElement('img')
    img.src = media.src; img.style.cssText = inner + 'object-fit:contain;'; img.onclick = stop
    overlay.appendChild(img)
  }
  const close = document.createElement('button')
  close.textContent = '✕'
  close.title = 'Close (Esc)'
  close.style.cssText = [
    'position:absolute', 'top:16px', 'right:20px', 'width:36px', 'height:36px',
    'border-radius:8px', 'border:1px solid #34343d', 'background:#16161b', 'color:#f3f3f6',
    'font-size:16px', 'cursor:pointer',
  ].join(';')
  close.onclick = closeLightbox
  overlay.appendChild(close)
  if (media.name) {
    const label = document.createElement('div')
    label.textContent = media.name
    label.style.cssText = 'position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#8c8c95;font-size:12px;font-family:system-ui,sans-serif;'
    overlay.appendChild(label)
  }
  overlay.addEventListener('click', closeLightbox)
  document.body.appendChild(overlay)
  lightboxEl = overlay
  window.addEventListener('keydown', onLightboxKey, true)
}

function onLightboxKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
}

export function closeLightbox(): void {
  window.removeEventListener('keydown', onLightboxKey, true)
  if (lightboxEl) { lightboxEl.remove(); lightboxEl = null }
}
