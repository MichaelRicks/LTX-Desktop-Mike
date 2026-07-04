import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export type MenuAction = 'new-project' | 'save-project' | 'export-project' | 'import-project' | 'show-keyboard-shortcuts'

function sendMenuAction(window: BrowserWindow, action: MenuAction): void {
  window.webContents.send('menu-action', action)
}

/** Replaces Electron's auto-generated default menu so File has real Project
 * Save/Export/Import actions (mirroring the equivalent in-app buttons) for
 * users who reach for the menu bar out of habit. The actions themselves run
 * in the renderer (ProjectContext/Project.tsx own the project state), so
 * each item just forwards an IPC message for the renderer to act on. */
export function createAppMenu(window: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project', click: () => sendMenuAction(window, 'new-project') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction(window, 'save-project') },
        { label: 'Export Project...', click: () => sendMenuAction(window, 'export-project') },
        { type: 'separator' },
        { label: 'Import Project...', click: () => sendMenuAction(window, 'import-project') },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${app.getName()} ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/Lightricks/LTX-Desktop') },
        { label: 'Keyboard Shortcuts', click: () => sendMenuAction(window, 'show-keyboard-shortcuts') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Electron shows no native right-click menu by default, even though the
 * Edit menu's accelerators (Ctrl+V etc.) already work - `context-menu` fires
 * on every right-click with everything needed to build one (isEditable,
 * per-action editFlags), so no renderer/preload changes are required. */
export function registerEditContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return

    const { editFlags } = params
    Menu.buildFromTemplate([
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ]).popup()
  })
}
