/**
 * Persist a Prompt Manager Pro library image (a dataURL) to a real file on disk
 * so it can be used as an LTX `imagePath` (Gen Space input image / generation).
 *
 * Library images live in IndexedDB as dataURLs; LTX generation needs a file
 * path. We write the bytes into the app data dir (alongside how the editor
 * stages temp images) and return the resulting path.
 */

/** MIME type used to carry a library image across an HTML5 drag onto the
 *  Gen Space prompt box. The drop handler in GenSpace reads this. */
export const GPM_IMAGE_DND_TYPE = 'application/x-gpm-image'

export interface GpmDndImage {
  id?: string
  name: string
  dataUrl: string
}

function mimeToExt(mime: string, name: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  const ext = name.split('.').pop()?.toLowerCase()
  return ext && ext.length <= 4 ? ext : 'png'
}

export async function saveDataUrlToTempFile(dataUrl: string, name: string): Promise<string> {
  const api = window.electronAPI
  if (!api) throw new Error('electronAPI unavailable')
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Unsupported image data (expected base64 dataURL)')
  const mime = match[1]
  const base64 = match[2]
  const ext = mimeToExt(mime, name)

  // App data dir = the parent of the models dir (mirrors the editor's temp-image staging).
  const modelsPath = await api.getModelsPath()
  const baseDir = modelsPath.replace(/[/\\]models$/, '')
  const safe = (name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'ref').slice(0, 40)
  const filePath = `${baseDir}/gpm_ref_${Date.now()}_${safe}.${ext}`

  const res = await api.saveFile({ filePath, data: base64, encoding: 'base64' })
  if (!res.success) throw new Error(res.error)
  return res.path
}
