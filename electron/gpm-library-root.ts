import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// Lets the user point the Prompt Manager Pro Downloads Browser at any folder
// on disk instead of the default `<Downloads>/PromptManagerPro`. The chosen
// path always comes from a native dialog (trusted), and is persisted here so
// it survives restarts and can be added to the allowed-roots list.

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'gpm-library-root.json')
let cached: string | null | undefined

function load(): string | null {
  if (cached !== undefined) return cached
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8')
    const parsed = JSON.parse(raw) as { root?: string }
    cached = parsed.root && fs.existsSync(parsed.root) ? parsed.root : null
  } catch {
    cached = null
  }
  return cached
}

export function getLibraryRootOverride(): string | null {
  return load()
}

export function setLibraryRootOverride(root: string | null): void {
  cached = root
  try {
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify({ root }))
  } catch {
    // Best effort — worst case the override doesn't survive a restart.
  }
}

export function defaultLibraryRoot(): string {
  return path.join(app.getPath('downloads'), 'PromptManagerPro')
}

export function resolveLibraryRoot(): string {
  return getLibraryRootOverride() ?? defaultLibraryRoot()
}
