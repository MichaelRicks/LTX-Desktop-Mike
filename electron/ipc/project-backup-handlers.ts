import fs from 'fs'
import path from 'path'
import { getProjectAssetsPath } from '../app-state'
import { logger } from '../logger'
import { handle } from './typed-handle'

/**
 * On-disk copy of each project record. The renderer keeps projects in
 * localStorage, which a bad shutdown can roll back or wipe; this writes the same
 * JSON next to the project's media (<project assets>/<projectId>/project.rix.json)
 * so Home can offer to restore whatever localStorage lost.
 */

export const PROJECT_BACKUP_FILE = 'project.rix.json'
// A backup that was newer than the record about to replace it (localStorage rolled
// back, then the stale project got saved). Kept so the newer state stays restorable.
const NEWER_BACKUP_FILE = 'project.rix.newer.json'

// Ids of deleted projects -> when they were deleted. Another copy of localStorage
// (rolled back, or a different dev origin) may still hold a deleted project; without
// this it would write the backup again and the project would come back.
const DELETED_PROJECTS_FILE = '.deleted-projects.json'

// Project ids become a folder name: refuse anything that could leave the assets root.
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function backupPath(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`Invalid project id: ${projectId}`)
  return path.join(getProjectAssetsPath(), projectId, PROJECT_BACKUP_FILE)
}

function deletedProjectsPath(): string {
  return path.join(getProjectAssetsPath(), DELETED_PROJECTS_FILE)
}

function readDeletedProjects(): Record<string, number> {
  try {
    const file = deletedProjectsPath()
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    )
  } catch (error) {
    logger.warn(`Ignoring unreadable deleted-projects list: ${error}`)
    return {}
  }
}

function writeDeletedProjects(deleted: Record<string, number>): void {
  const file = deletedProjectsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(deleted), 'utf-8')
  fs.renameSync(tmp, file)
}

interface BackupSummary { file: string; name: string; updatedAt: number; assetCount: number }

function summarize(file: string, fallbackName: string): BackupSummary | null {
  try {
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    return {
      file,
      name: typeof parsed.name === 'string' ? parsed.name : fallbackName,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      assetCount: Array.isArray(parsed.assets) ? parsed.assets.length : 0,
    }
  } catch (error) {
    logger.warn(`Skipping unreadable project backup ${file}: ${error}`)
    return null
  }
}

/** The most recently updated of a project's backup files, or null. */
function newestBackup(projectId: string): BackupSummary | null {
  const main = backupPath(projectId)
  const candidates = [main, path.join(path.dirname(main), NEWER_BACKUP_FILE)]
    .map(file => summarize(file, projectId))
    .filter((s): s is BackupSummary => s !== null)
  return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}

export function registerProjectBackupHandlers(): void {
  handle('saveProjectBackup', ({ projectId, data }) => {
    try {
      const file = backupPath(projectId)
      const incomingUpdatedAt = Number((JSON.parse(data) as { updatedAt?: unknown }).updatedAt) || 0
      const deleted = readDeletedProjects()
      if (projectId in deleted) {
        // A copy from before the delete stays deleted; one edited since is wanted again.
        if (incomingUpdatedAt <= deleted[projectId]) return { success: true as const }
        delete deleted[projectId]
        writeDeletedProjects(deleted)
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const newest = newestBackup(projectId)
      if (newest && newest.file === file && newest.updatedAt > incomingUpdatedAt) {
        fs.renameSync(file, path.join(path.dirname(file), NEWER_BACKUP_FILE))
      }
      // Write-then-rename so a crash mid-write never leaves a truncated backup.
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, data, 'utf-8')
      fs.renameSync(tmp, file)
      return { success: true as const }
    } catch (error) {
      logger.error(`Failed to save project backup ${projectId}: ${error}`)
      return { success: false as const, error: String(error) }
    }
  })

  handle('listProjectBackups', () => {
    const backups: { projectId: string; name: string; updatedAt: number; assetCount: number }[] = []
    try {
      const root = getProjectAssetsPath()
      if (!fs.existsSync(root)) return backups
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !PROJECT_ID_PATTERN.test(entry.name)) continue
        const newest = newestBackup(entry.name)
        if (!newest) continue
        backups.push({
          projectId: entry.name,
          name: newest.name,
          updatedAt: newest.updatedAt,
          assetCount: newest.assetCount,
        })
      }
    } catch (error) {
      logger.error(`Failed to list project backups: ${error}`)
    }
    return backups
  })

  handle('listDeletedProjects', () => (
    Object.entries(readDeletedProjects()).map(([projectId, deletedAt]) => ({ projectId, deletedAt }))
  ))

  handle('readProjectBackup', ({ projectId }) => {
    try {
      const newest = newestBackup(projectId)
      if (!newest) return { success: false as const, error: 'No backup found' }
      return { success: true as const, data: fs.readFileSync(newest.file, 'utf-8') }
    } catch (error) {
      return { success: false as const, error: String(error) }
    }
  })

  handle('deleteProjectBackup', ({ projectId }) => {
    try {
      const file = backupPath(projectId)
      fs.rmSync(file, { force: true })
      fs.rmSync(path.join(path.dirname(file), NEWER_BACKUP_FILE), { force: true })
      writeDeletedProjects({ ...readDeletedProjects(), [projectId]: Date.now() })
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: String(error) }
    }
  })
}
