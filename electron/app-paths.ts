import { app } from 'electron'
import path from 'path'
import os from 'os'

// Dev runs use a separate folder so the fork never collides with an installed
// LTX Desktop (independent single-instance lock + isolated settings). The dev
// userData's `models/` is junctioned to the installed app's models, so nothing
// re-downloads. Packaged builds keep the original folder name.
export const APP_FOLDER_NAME = app.isPackaged ? 'LTXDesktop' : 'LTXDesktopMikeDev'

if (!app.isPackaged) {
  app.setName('LTX Desktop Studio Pro')
}

function resolveUserDataPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(localAppData, APP_FOLDER_NAME)
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      APP_FOLDER_NAME,
    )
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(xdgData, APP_FOLDER_NAME)
}

app.setPath('userData', resolveUserDataPath())

export function getAppDataDir(): string {
  return app.getPath('userData')
}

export function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}
