import { dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { getAllowedRoots } from '../config'
import { getMainWindow } from '../window'
import { validatePath } from '../path-validation'
import { logger } from '../logger'
import { handle } from './typed-handle'
import { defaultLibraryRoot, resolveLibraryRoot, setLibraryRootOverride } from '../gpm-library-root'

// Real-filesystem media library for the Prompt Manager Pro "Downloads Browser".
// Lives under the OS Downloads dir (an allowed root) so files are real and the
// user can open the folder in their file manager.

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MEDIA_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT])
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
}

function libRoot(): string {
  const root = resolveLibraryRoot()
  fs.mkdirSync(root, { recursive: true })
  return root
}

function safeName(name: string): string {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`Invalid name: ${name}`)
  }
  return name.trim()
}

function folderPath(name: string): string {
  const p = path.join(libRoot(), safeName(name))
  validatePath(p, getAllowedRoots())
  return p
}

function uniqueTarget(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  let i = 1
  let candidate = path.join(dir, `${base}-${i}${ext}`)
  while (fs.existsSync(candidate)) { i++; candidate = path.join(dir, `${base}-${i}${ext}`) }
  return candidate
}

export function registerLibraryHandlers(): void {
  handle('gpmLibList', () => {
    const root = libRoot()
    let folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    if (folders.length === 0) {
      fs.mkdirSync(path.join(root, 'Inbox'), { recursive: true })
      folders = ['Inbox']
    }
    const files: Array<{ folder: string; name: string; path: string; isVideo: boolean; isAudio: boolean }> = []
    for (const folder of folders) {
      const fp = path.join(root, folder)
      for (const entry of fs.readdirSync(fp, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!MEDIA_EXT.has(ext)) continue
        files.push({ folder, name: entry.name, path: path.join(fp, entry.name), isVideo: VIDEO_EXT.has(ext), isAudio: AUDIO_EXT.has(ext) })
      }
    }
    return { root, folders, files }
  })

  handle('gpmLibCreateFolder', ({ name }) => {
    try { fs.mkdirSync(folderPath(name)); return { success: true as const } }
    catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'create failed' } }
  })

  handle('gpmLibRenameFolder', ({ from, to }) => {
    try { fs.renameSync(folderPath(from), folderPath(to)); return { success: true as const } }
    catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'rename failed' } }
  })

  handle('gpmLibDeleteFolder', ({ name }) => {
    try { fs.rmSync(folderPath(name), { recursive: true, force: true }); return { success: true as const } }
    catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'delete failed' } }
  })

  handle('gpmLibAddFiles', ({ folder, srcPaths }) => {
    try {
      const dest = folderPath(folder)
      let added = 0
      for (const src of srcPaths) {
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
        const ext = path.extname(src).toLowerCase()
        if (!MEDIA_EXT.has(ext)) continue
        fs.copyFileSync(src, uniqueTarget(path.join(dest, path.basename(src))))
        added++
      }
      return { success: true as const, added }
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : 'add failed' }
    }
  })

  handle('gpmLibMoveFile', ({ fromFolder, name, toFolder }) => {
    try {
      const src = path.join(folderPath(fromFolder), safeName(name))
      const target = uniqueTarget(path.join(folderPath(toFolder), safeName(name)))
      fs.renameSync(src, target)
      return { success: true as const }
    } catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'move failed' } }
  })

  handle('gpmLibDeleteFile', ({ folder, name }) => {
    try { fs.rmSync(path.join(folderPath(folder), safeName(name)), { force: true }); return { success: true as const } }
    catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'delete failed' } }
  })

  handle('gpmLibReveal', ({ folder }) => {
    try { void shell.openPath(folder ? folderPath(folder) : libRoot()); return { success: true as const } }
    catch (e) { logger.warn(`gpmLibReveal failed: ${e}`); return { success: false as const, error: 'reveal failed' } }
  })

  handle('gpmLibReadAsDataUrl', ({ path: p }) => {
    try {
      validatePath(p, getAllowedRoots())
      const ext = path.extname(p).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
      const b64 = fs.readFileSync(p).toString('base64')
      return { success: true as const, dataUrl: `data:${mime};base64,${b64}` }
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : 'read failed' }
    }
  })

  handle('gpmLibGetRoot', () => ({ root: libRoot(), isDefault: resolveLibraryRoot() === defaultLibraryRoot() }))

  handle('gpmLibChooseRoot', async () => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { title: 'Choose Downloads Browser folder', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: 'Choose Downloads Browser folder', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return { root: null }
    const chosen = result.filePaths[0]
    setLibraryRootOverride(chosen)
    fs.mkdirSync(chosen, { recursive: true })
    return { root: chosen }
  })

  handle('gpmLibResetRoot', () => {
    setLibraryRootOverride(null)
    return { root: libRoot() }
  })
}
