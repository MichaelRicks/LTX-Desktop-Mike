/**
 * The Studio Assets folder that quick-save actions (the asset Download button)
 * drop files into, so a save takes zero clicks instead of a native Save dialog.
 * Tracks the folder the user last opened/worked in inside the Studio Assets panel;
 * persisted in localStorage so it survives across the GenSpace <-> panel divide and
 * across restarts. Defaults to "Inbox" (the folder Studio Assets auto-creates).
 */

const KEY = 'gpm_dl_last_folder'
const DEFAULT_FOLDER = 'Inbox'

export function getStudioAssetsTarget(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_FOLDER
  } catch {
    return DEFAULT_FOLDER
  }
}

export function setStudioAssetsTarget(folder: string): void {
  try {
    if (folder) localStorage.setItem(KEY, folder)
  } catch {
    // localStorage unavailable — quick-save just falls back to the default folder.
  }
}
