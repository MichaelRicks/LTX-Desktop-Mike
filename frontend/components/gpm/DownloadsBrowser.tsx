/**
 * Downloads Browser — a left-side media library backed by REAL folders/files
 * on disk (via Electron IPC under <Downloads>/PromptManagerPro). Create/rename/
 * delete folders, add images/videos, move media between folders, and drag to
 * reorder folders. Unlike the browser extension there's no directory-handle
 * permission dance — it's the real filesystem.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Folder, FolderPlus, FolderOpen, GripVertical, Pencil, RefreshCw, Send, Trash2, Upload, X } from 'lucide-react'
import { pathToFileUrl } from '../../lib/file-url'
import { useProjects } from '../../contexts/ProjectContext'
import { MediaThumb } from './MediaThumb'
import { useDownloadsBrowserOpen, setDownloadsBrowserOpen } from './downloads-browser-store'

const C = {
  panel: '#0e0e12', card: '#16161b', elev: '#1c1c22',
  border: '#26262d', borderLt: '#34343d',
  text: '#f3f3f6', muted: '#8c8c95', faint: '#5c5c65',
  blue: '#1f8fff', green: '#28c76f',
}

export interface LibFile { folder: string; name: string; path: string; isVideo: boolean }
const ORDER_KEY = 'gpm_dl_order'
export const FILE_DND = 'application/x-gpm-dl-file'
const FOLDER_DND = 'application/x-gpm-dl-folder'

function loadOrder(): string[] { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as string[] } catch { return [] } }
function saveOrder(o: string[]) { localStorage.setItem(ORDER_KEY, JSON.stringify(o)) }
function applyOrder(folders: string[]): string[] {
  const ord = loadOrder().filter((f) => folders.includes(f))
  return [...ord, ...folders.filter((f) => !ord.includes(f))]
}

function Dock({ onClose }: { onClose: () => void }) {
  const { setGenSpaceInputImagePath, setCurrentTab } = useProjects()
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<LibFile[]>([])
  const [active, setActive] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<LibFile | null>(null)
  const [moveDest, setMoveDest] = useState('')
  const [dropLine, setDropLine] = useState<{ target: string; before: boolean } | null>(null)
  const dragFolder = useRef<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600) }

  const api = window.electronAPI
  const refresh = async () => {
    if (!api) return
    const d = await api.gpmLibList()
    const ordered = applyOrder(d.folders)
    setFolders(ordered)
    setFiles(d.files)
    setActive((a) => (a && ordered.includes(a) ? a : ordered[0] ?? ''))
  }
  useEffect(() => { void refresh() }, [])

  const createFolder = async () => {
    const n = newName.trim(); if (!n || !api) return
    const r = await api.gpmLibCreateFolder({ name: n })
    if (r.success) { saveOrder([...loadOrder(), n]); setNewName(''); setActive(n); await refresh() } else flash(r.error)
  }
  const commitRename = async (from: string) => {
    const to = renameVal.trim(); setRenaming(null)
    if (!to || to === from || !api) return
    const r = await api.gpmLibRenameFolder({ from, to })
    if (r.success) { saveOrder(loadOrder().map((f) => (f === from ? to : f))); if (active === from) setActive(to); await refresh() } else flash(r.error)
  }
  const deleteFolder = async (name: string) => {
    if (!api || !window.confirm(`Delete folder "${name}" and its files?`)) return
    const r = await api.gpmLibDeleteFolder({ name })
    if (r.success) { saveOrder(loadOrder().filter((f) => f !== name)); await refresh() } else flash(r.error)
  }
  const addFiles = async () => {
    if (!api || !active) return
    const paths = await api.showOpenFileDialog({
      title: `Add to ${active}`, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov', 'avi'] }],
    })
    if (!paths || paths.length === 0) return
    const r = await api.gpmLibAddFiles({ folder: active, srcPaths: paths })
    if (r.success) { flash(`Added ${r.added} file(s)`); await refresh() } else flash(r.error)
  }
  const moveFile = async (f: LibFile, toFolder: string) => {
    if (!api || f.folder === toFolder) return
    const r = await api.gpmLibMoveFile({ fromFolder: f.folder, name: f.name, toFolder })
    if (r.success) { await refresh() } else flash(r.error)
  }
  const deleteFile = async (f: LibFile) => {
    if (!api) return
    const r = await api.gpmLibDeleteFile({ folder: f.folder, name: f.name })
    if (r.success) await refresh(); else flash(r.error)
  }
  const sendToGenSpace = (f: LibFile) => {
    if (f.isVideo) return
    setGenSpaceInputImagePath(f.path)
    setCurrentTab('gen-space')
    flash('Sent to Gen Space')
  }
  const openMove = (f: LibFile) => {
    setMoveTarget(f)
    setMoveDest(folders.find((x) => x !== f.folder) ?? '')
  }
  const confirmMove = async () => {
    if (!moveTarget || !moveDest) return
    await moveFile(moveTarget, moveDest)
    setMoveTarget(null)
  }

  // Drag-reorder folders, with a blue drop-line indicator like the extension.
  const onFolderDrop = (target: string, before: boolean) => {
    const dragged = dragFolder.current
    dragFolder.current = null
    setDropLine(null)
    if (!dragged || dragged === target) return
    const order = folders.filter((f) => f !== dragged)
    let idx = order.indexOf(target)
    if (!before) idx += 1
    order.splice(idx, 0, dragged)
    saveOrder(order); setFolders(order)
  }

  const activeFiles = files.filter((f) => f.folder === active)

  return (
    <div className="fixed top-0 left-0 z-[55] h-screen w-[340px] flex flex-col" style={{ background: C.panel, borderRight: `1px solid ${C.border}`, boxShadow: '8px 0 24px rgba(0,0,0,0.4)' }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}><FolderOpen size={15} style={{ color: C.blue }} />Downloads</span>
        <div className="flex items-center gap-1">
          <button onClick={() => void api?.gpmLibReveal({ folder: active || undefined })} title="Open folder in Explorer" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><FolderOpen size={14} /></button>
          <button onClick={() => void refresh()} title="Refresh" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><RefreshCw size={14} /></button>
          <button onClick={onClose} title="Close" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><X size={16} /></button>
        </div>
      </div>

      <div className="flex gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createFolder() }} placeholder="New folder…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
        <button onClick={() => void createFolder()} title="Create folder" className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}><FolderPlus size={13} /></button>
      </div>

      {/* Folders */}
      <div className="overflow-y-auto shrink-0" style={{ maxHeight: '40%', borderBottom: `1px solid ${C.border}` }}>
        {folders.map((f) => {
          const count = files.filter((x) => x.folder === f).length
          const isActive = f === active
          return (
            <div
              key={f}
              draggable
              onDragStart={(e) => { dragFolder.current = f; e.dataTransfer.setData(FOLDER_DND, f); e.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { dragFolder.current = null; setDropLine(null) }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(FOLDER_DND) && !e.dataTransfer.types.includes(FILE_DND)) return
                e.preventDefault()
                if (dragFolder.current && dragFolder.current !== f) {
                  const r = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY - r.top < r.height / 2
                  setDropLine({ target: f, before })
                }
              }}
              onDragLeave={() => setDropLine((d) => (d?.target === f ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer.types.includes(FILE_DND)) { const d = JSON.parse(e.dataTransfer.getData(FILE_DND)) as LibFile; void moveFile(d, f) }
                else if (dragFolder.current) onFolderDrop(f, dropLine?.before ?? true)
              }}
              onClick={() => setActive(f)}
              className="relative flex items-center gap-1.5 px-3 py-2 cursor-pointer group"
              style={{ background: isActive ? 'rgba(31,143,255,0.12)' : 'transparent', borderLeft: `2px solid ${isActive ? C.blue : 'transparent'}` }}
            >
              {dropLine?.target === f && (
                <div
                  className="absolute left-0 right-0 z-10 pointer-events-none"
                  style={{ [dropLine.before ? 'top' : 'bottom']: -1, height: 2, background: C.blue, boxShadow: `0 0 4px ${C.blue}` }}
                />
              )}
              <GripVertical size={12} style={{ color: C.faint, cursor: 'grab' }} />
              <Folder size={13} style={{ color: isActive ? C.blue : C.muted }} />
              {renaming === f ? (
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={() => void commitRename(f)} onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(f) }} className="flex-1 rounded px-1 py-0.5 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
              ) : (
                <span className="flex-1 text-xs truncate" style={{ color: C.text }}>{f}</span>
              )}
              <span className="text-[10px] tabular-nums" style={{ color: C.faint }}>{count}</span>
              <Pencil size={11} className="opacity-0 group-hover:opacity-100" style={{ color: C.muted }} onClick={(e) => { e.stopPropagation(); setRenaming(f); setRenameVal(f) }} />
              <Trash2 size={11} className="opacity-0 group-hover:opacity-100" style={{ color: C.muted }} onClick={(e) => { e.stopPropagation(); void deleteFolder(f) }} />
            </div>
          )
        })}
        {folders.length === 0 && <p className="text-[11px] text-center py-4" style={{ color: C.faint }}>No folders yet.</p>}
      </div>

      {/* Media grid */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>{active || '—'} ({activeFiles.length})</span>
        <button onClick={() => void addFiles()} disabled={!active} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40" style={{ background: C.green, color: '#fff' }}><Upload size={11} />Add files</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {activeFiles.length === 0
          ? <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>Empty. Add files or drag media here.</p>
          : (
            <div className="grid grid-cols-2 gap-2">
              {activeFiles.map((f) => (
                <MediaThumb
                  key={f.path} src={pathToFileUrl(f.path)} isVideo={f.isVideo} name={f.name}
                  className="rounded-md" style={{ border: `1px solid ${C.border}` }}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData(FILE_DND, JSON.stringify(f)); e.dataTransfer.effectAllowed = 'copyMove' }}
                >
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100">
                    {!f.isVideo && (
                      <button onClick={() => sendToGenSpace(f)} title="Send to Gen Space as input image" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: C.green, color: '#fff' }}><Send size={11} /></button>
                    )}
                    <button onClick={() => openMove(f)} title="Move to folder…" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><FolderOpen size={11} /></button>
                    <button onClick={() => void deleteFile(f)} title="Delete" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Trash2 size={11} /></button>
                  </div>
                </MediaThumb>
              ))}
            </div>
          )}
      </div>

      {toast && <div className="absolute left-1/2 bottom-4 -translate-x-1/2 px-3 py-2 rounded-lg text-xs" style={{ background: C.elev, border: `1px solid ${C.borderLt}`, color: C.text }}>{toast}</div>}

      <button
        onClick={onClose} title="Close Downloads Browser"
        className="fixed top-1/2 -translate-y-1/2 z-[56] flex items-center justify-center"
        style={{ left: 340, width: 16, height: 84, background: C.blue, color: '#fff', borderRadius: '0 8px 8px 0', boxShadow: '3px 0 10px rgba(0,0,0,0.35)' }}
      >
        <ChevronLeft size={14} />
      </button>

      {moveTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setMoveTarget(null)}>
          <div
            className="rounded-lg p-4 w-[280px]" style={{ background: C.card, border: `1px solid ${C.borderLt}`, boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold mb-2" style={{ color: C.text }}>Move To Folder…</p>
            <p className="text-xs mb-1 truncate" style={{ color: C.text }}>"{moveTarget.name}"</p>
            <p className="text-[11px] mb-3" style={{ color: C.muted }}>From: <span style={{ color: C.blue }}>{moveTarget.folder}</span></p>
            <select
              value={moveDest} onChange={(e) => setMoveDest(e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none mb-3"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            >
              {folders.filter((f) => f !== moveTarget.folder).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMoveTarget(null)} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>Cancel</button>
              <button onClick={() => void confirmMove()} disabled={!moveDest} className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={{ background: C.blue, color: '#fff' }}>Move</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DownloadsBrowser() {
  const open = useDownloadsBrowserOpen()
  if (!open) {
    return (
      <button onClick={() => setDownloadsBrowserOpen(true)} title="Open Downloads Browser" className="fixed top-1/2 -translate-y-1/2 left-0 flex items-center justify-center" style={{ width: 24, height: 84, background: C.blue, color: '#fff', borderRadius: '0 8px 8px 0', boxShadow: '3px 0 10px rgba(0,0,0,0.35)' }}>
        <ChevronLeft size={18} style={{ transform: 'rotate(180deg)' }} />
      </button>
    )
  }
  return <Dock onClose={() => setDownloadsBrowserOpen(false)} />
}
