/**
 * Builds a full project `Asset` from an image/video dropped from the Prompt
 * Manager Pro Downloads Browser (`FILE_DND`) or Images tab (`GPM_IMAGE_DND_TYPE`)
 * — neither is a registered project Asset yet, so this copies the file into
 * project storage and probes duration/dimensions, mirroring the file-picker
 * import path in `useEditorMediaImport.ts`.
 */
import type { Asset } from '../../types/project-model'
import { GPM_IMAGE_DND_TYPE, saveDataUrlToTempFile, type GpmDndImage } from '../../components/gpm/gpm-image-file'
import { FILE_DND, type LibFile } from '../../components/gpm/DownloadsBrowser'
import { addVisualAssetToProject } from '../../lib/asset-copy'
import { pathToFileUrl } from '../../lib/file-url'

function getMediaDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = url
    v.onloadedmetadata = () => resolve(v.duration)
    v.onerror = () => resolve(5)
  })
}

export async function buildAssetFromPath(path: string, isVideo: boolean, currentProjectId: string | null, name: string): Promise<Asset> {
  let persistentPath = path
  let bigThumbnailPath: string | undefined
  let smallThumbnailPath: string | undefined
  let width: number | undefined
  let height: number | undefined
  let duration = 5
  if (isVideo) duration = await getMediaDuration(pathToFileUrl(path))
  if (currentProjectId) {
    const copied = await addVisualAssetToProject(path, currentProjectId, isVideo ? 'video' : 'image')
    if (copied) {
      persistentPath = copied.path
      bigThumbnailPath = copied.bigThumbnailPath
      smallThumbnailPath = copied.smallThumbnailPath
      width = copied.width
      height = copied.height
    }
  }
  return {
    id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: isVideo ? 'video' : 'image',
    path: persistentPath,
    bigThumbnailPath,
    smallThumbnailPath,
    width,
    height,
    prompt: `Imported: ${name}`,
    resolution: 'imported',
    duration,
    createdAt: Date.now(),
  }
}

export function isDroppedMediaEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE)
}

/** Reads a Downloads Browser / Images tab drop payload and resolves it to a full Asset, or null if neither type is present. */
export function readDroppedMediaAsset(e: React.DragEvent, currentProjectId: string | null): Promise<Asset | null> {
  const dlData = e.dataTransfer.getData(FILE_DND)
  if (dlData) {
    const f = JSON.parse(dlData) as LibFile
    return buildAssetFromPath(f.path, f.isVideo, currentProjectId, f.name)
  }
  const gpmData = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
  if (gpmData) {
    const { name, dataUrl } = JSON.parse(gpmData) as GpmDndImage
    return saveDataUrlToTempFile(dataUrl, name).then((path) => buildAssetFromPath(path, false, currentProjectId, name))
  }
  return Promise.resolve(null)
}
