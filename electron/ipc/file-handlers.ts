import { dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { getAllowedRoots } from '../config'
import { logger } from '../logger'
import { getMainWindow } from '../window'
import { validatePath, approvePath } from '../path-validation'
import { getProjectAssetsPath, setProjectAssetsPath } from '../app-state'
import { extractVideoFrameToFile, getVideoDimensions } from '../export/ffmpeg-utils'
import { createDownsampledThumbnail, getImageDimensions, getThumbnailPaths } from './image-utils'
import { handle } from './typed-handle'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
}

function readLocalFileAsBase64(filePath: string): { data: string; mimeType: string } {
  const data = fs.readFileSync(filePath)
  const base64 = data.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  return { data: base64, mimeType }
}

// Electron's clipboard can't write a real CF_HDROP (custom format names get
// registered as new formats), so let PowerShell's Set-Clipboard do it — that's
// what Explorer's own Copy produces, and what browsers accept on paste.
function copyFileToClipboardWin(filePath: string): Promise<void> {
  const quoted = `'${filePath.replace(/'/g, "''")}'`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath ${quoted}`],
      { windowsHide: true, timeout: 10000 },
      (err) => (err ? reject(err) : resolve()),
    )
  })
}

function searchDirectoryForFilesImpl(dir: string, filenames: string[]): Record<string, string> {
  const results: Record<string, string> = {}
  const remaining = new Set(filenames.map(f => f.toLowerCase()))

  const walk = (currentDir: string, depth: number) => {
    if (remaining.size === 0 || depth > 10) return
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (remaining.size === 0) break
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          if (remaining.has(lower)) {
            results[lower] = fullPath
            remaining.delete(lower)
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1)
        }
      }
    } catch {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  walk(dir, 0)
  return results
}

function resolveLocalSourcePath(srcPath: string): string {
  if (!srcPath || !srcPath.trim()) {
    throw new Error('Source path is empty')
  }

  const normalized = srcPath.trim()

  if (!path.isAbsolute(normalized)) {
    throw new Error(`Source path must be absolute: ${srcPath}`)
  }

  const resolved = path.resolve(normalized)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Source file does not exist: ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Source path is not a file: ${resolved}`)
  }
  return resolved
}

function getUniqueDestinationPath(destDir: string, fileName: string): string {
  const parsed = path.parse(fileName)
  let candidate = path.join(destDir, fileName)
  let idx = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${parsed.name}(${idx})${parsed.ext}`)
    idx += 1
  }
  return candidate
}

function copyToProjectAssetDirectory(srcPath: string, projectId: string): string {
  const assetsRoot = getProjectAssetsPath()
  const destDir = path.join(assetsRoot, projectId)
  fs.mkdirSync(destDir, { recursive: true })
  const fileName = path.basename(srcPath)
  const destPath = getUniqueDestinationPath(destDir, fileName)
  fs.copyFileSync(srcPath, destPath)
  return destPath
}

function createVideoBigThumbnail(videoPath: string, bigThumbnailPath: string): void {
  extractVideoFrameToFile({
    videoPath,
    seekTime: 0,
    outputPath: bigThumbnailPath,
    timeoutMs: 30000,
  })
}

function createVisualThumbnails(assetPath: string, type: 'video' | 'image'): { bigThumbnailPath: string; smallThumbnailPath: string } {
  const { bigThumbnailPath: generatedBigThumbnailPath, smallThumbnailPath } = getThumbnailPaths(assetPath)
  let bigThumbnailPath: string

  switch (type) {
    case 'video':
      bigThumbnailPath = generatedBigThumbnailPath
      createVideoBigThumbnail(assetPath, bigThumbnailPath)
      break
    case 'image':
      bigThumbnailPath = assetPath
      break
    default: {
      const unsupportedType: never = type
      throw new Error(`Unsupported visual asset type: ${unsupportedType}`)
    }
  }

  createDownsampledThumbnail(bigThumbnailPath, smallThumbnailPath)
  return { bigThumbnailPath, smallThumbnailPath }
}

function getVisualAssetDimensions(assetPath: string, type: 'video' | 'image'): { width: number; height: number } {
  switch (type) {
    case 'video':
      return getVideoDimensions(assetPath)
    case 'image':
      return getImageDimensions(assetPath)
    default: {
      const unsupportedType: never = type
      throw new Error(`Unsupported visual asset type: ${unsupportedType}`)
    }
  }
}

export function registerFileHandlers(): void {
  handle('openLtxApiKeyPage', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://console.ltx.video/api-keys/')
    return true
  })

  handle('openLtxBillingPage', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://console.ltx.video/billings/#buy')
    return true
  })

  handle('openFalApiKeyPage', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://fal.ai/dashboard/keys')
    return true
  })

  handle('openHuggingFaceRepo', async ({ repoId }) => {
    const { shell } = await import('electron')
    await shell.openExternal(`https://huggingface.co/${repoId}`)
    return true
  })

  handle('openExternalUrl', async ({ url }) => {
    const { shell } = await import('electron')
    // Only https — never let the renderer open file://, custom-scheme, or other handlers.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Only https URLs may be opened')
    }
    if (parsed.protocol !== 'https:') throw new Error('Only https URLs may be opened')
    await shell.openExternal(url)
    return true
  })

  const HF_AUTHORIZE_URL = 'https://huggingface.co/oauth/authorize'

  handle('openHuggingFaceAuth', async (params) => {
    const { shell } = await import('electron')
    const url = new URL(HF_AUTHORIZE_URL)
    url.searchParams.set('client_id', params.clientId)
    url.searchParams.set('redirect_uri', params.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', params.scope)
    url.searchParams.set('state', params.state)
    url.searchParams.set('code_challenge', params.codeChallenge)
    url.searchParams.set('code_challenge_method', params.codeChallengeMethod)
    await shell.openExternal(url.toString())
    return true
  })

  handle('openTwitterCompose', async ({ text, filePath }) => {
    const { shell } = await import('electron')
    // Put the file on the clipboard (Windows file-drop list) so the user can just
    // Ctrl+V into the compose box — Windows' focus-stealing guard won't let us
    // raise Explorer above the browser, so a drag-from-Explorer is a scavenger hunt.
    let normalizedPath: string | null = null
    if (filePath) {
      try {
        normalizedPath = validatePath(filePath, getAllowedRoots())
        if (process.platform === 'win32') await copyFileToClipboardWin(normalizedPath)
      } catch (err) {
        logger.warn(`openTwitterCompose: could not copy file to clipboard: ${err}`)
      }
    }
    const url = new URL('https://twitter.com/intent/tweet')
    if (text) url.searchParams.set('text', text)
    await shell.openExternal(url.toString())
    // Fallback: still reveal the file for drag-and-drop, AFTER the browser has
    // opened so it isn't immediately buried under the new browser window.
    if (normalizedPath) {
      const revealPath = normalizedPath
      setTimeout(() => shell.showItemInFolder(revealPath), 1500)
    }
    return true
  })

  handle('openParentFolderOfFile', async ({ filePath }) => {
    const { shell } = await import('electron')
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    const parentDir = path.dirname(normalizedPath)
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(`Parent directory not found: ${parentDir}`)
    }
    shell.openPath(parentDir)
  })

  handle('showItemInFolder', async ({ filePath }) => {
    const { shell } = await import('electron')
    shell.showItemInFolder(filePath)
  })

  handle('readLocalFile', async ({ filePath }) => {
    try {
      const normalizedPath = validatePath(filePath, getAllowedRoots())

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`File not found: ${normalizedPath}`)
      }

      return readLocalFileAsBase64(normalizedPath)
    } catch (error) {
      logger.error( `Error reading local file: ${error}`)
      throw error
    }
  })

  handle('showSaveDialog', async ({ title, defaultPath, filters }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) {
      // Indistinguishable from "user cancelled" to the renderer (the IPC
      // contract returns null either way), but this case is a real bug, not
      // a cancellation — log it so it's diagnosable instead of silent.
      logger.error('showSaveDialog: no main window available')
      return null
    }
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: title || 'Save File',
        defaultPath,
        filters: filters || [],
      })
      if (result.canceled || !result.filePath) return null
      approvePath(result.filePath)
      return result.filePath
    } catch (error) {
      logger.error(`showSaveDialog failed: ${error}`)
      return null
    }
  })

  handle('saveFile', async ({ filePath, data, encoding }) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
      } else {
        fs.writeFileSync(filePath, data, 'utf-8')
      }
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('saveBinaryFile', async ({ filePath, data }) => {
    try {
      validatePath(filePath, getAllowedRoots())
      fs.writeFileSync(filePath, Buffer.from(data))
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving binary file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('copyFileToPath', async ({ srcPath, destPath }) => {
    try {
      validatePath(srcPath, getAllowedRoots())
      // destPath is a user-chosen save location approved via showSaveDialog.
      validatePath(destPath, getAllowedRoots())
      fs.copyFileSync(srcPath, destPath)
      return { success: true, path: destPath }
    } catch (error) {
      logger.error(`Error copying file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('showOpenDirectoryDialog', async ({ title }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approvePath(result.filePaths[0])
    return result.filePaths[0]
  })

  handle('searchDirectoryForFiles', ({ directory, filenames }) => {
    return searchDirectoryForFilesImpl(directory, filenames)
  })

  handle('addVisualAssetToProject', ({ srcPath, projectId, type }) => {
    try {
      const resolvedSrc = resolveLocalSourcePath(srcPath)
      const destPath = copyToProjectAssetDirectory(resolvedSrc, projectId)
      const { bigThumbnailPath, smallThumbnailPath } = createVisualThumbnails(destPath, type)
      const { width, height } = getVisualAssetDimensions(destPath, type)

      return {
        success: true,
        path: destPath,
        bigThumbnailPath,
        smallThumbnailPath,
        width,
        height,
      }
    } catch (error) {
      logger.error(`Error adding asset to project: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('addGenericAssetToProject', ({ srcPath, projectId }) => {
    try {
      const resolvedSrc = resolveLocalSourcePath(srcPath)
      const destPath = copyToProjectAssetDirectory(resolvedSrc, projectId)
      return { success: true, path: destPath }
    } catch (error) {
      logger.error(`Error copying file to project assets: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('makeThumbnailsForProjectAsset', ({ path: assetPath, type }) => {
    try {
      const resolvedAssetPath = resolveLocalSourcePath(assetPath)
      const { bigThumbnailPath, smallThumbnailPath } = createVisualThumbnails(resolvedAssetPath, type)

      return {
        success: true,
        bigThumbnailPath,
        smallThumbnailPath,
      }
    } catch (error) {
      logger.error(`Error creating thumbnails for project asset: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('makeDimensionsForProjectAsset', ({ path: assetPath, type }) => {
    try {
      const resolvedAssetPath = resolveLocalSourcePath(assetPath)
      const { width, height } = getVisualAssetDimensions(resolvedAssetPath, type)

      return {
        success: true,
        width,
        height,
      }
    } catch (error) {
      logger.error(`Error creating dimensions for project asset: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  handle('getProjectAssetsPath', () => {
    return getProjectAssetsPath()
  })

  handle('openProjectAssetsPathChangeDialog', async () => {
    try {
      const mainWindow = getMainWindow()
      if (!mainWindow) return { success: false, error: 'No window' }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Project Assets Path',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'cancelled' }
      const selectedPath = path.resolve(result.filePaths[0])
      setProjectAssetsPath(selectedPath)
      approvePath(selectedPath)
      return { success: true, path: selectedPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  handle('checkFilesExist', ({ filePaths }) => {
    const results: Record<string, boolean> = {}
    for (const p of filePaths) {
      try {
        results[p] = fs.existsSync(p)
      } catch {
        results[p] = false
      }
    }
    return results
  })

  handle('showOpenFileDialog', async ({ title, filters, properties }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const props: any[] = ['openFile']
    if (properties?.includes('multiSelections')) props.push('multiSelections')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select File',
      filters: filters || [],
      properties: props,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    for (const fp of result.filePaths) {
      approvePath(fp)
    }
    return result.filePaths
  })

}
