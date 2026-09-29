import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, ExternalLink, Loader2, X } from 'lucide-react'
import type { Asset } from '../types/project-model'

/**
 * "Direct with Claude": turns a short brief into a prompt and opens it, prefilled,
 * in Claude Desktop's Code tab. Claude runs in the user's OWN Claude app on their
 * own plan (no API keys / per-call billing) and edits the timeline through the RiX
 * MCP server + rix-editor skill. The user presses Send in Claude.
 */

type Aspect = '9:16' | '16:9' | '1:1'

type ClipTransition = 'cut' | 'dissolve' | 'dip-to-black'

const TRANSITION_OPTIONS: Array<{ value: ClipTransition; label: string; brief: string }> = [
  { value: 'cut', label: 'Straight cuts', brief: 'straight cuts between clips (a fade from black at the start and to black at the end is fine)' },
  { value: 'dissolve', label: 'Cross dissolve', brief: 'cross dissolve between every clip' },
  { value: 'dip-to-black', label: 'Dip to black', brief: 'dip to black between every clip' },
]

export interface DirectorBrief {
  lengthSec: number
  aspect: Aspect
  folder: string // '' = let Claude choose from all footage
  musicPath: string // '' = no music
  transition: ClipTransition
  title: string
  notes: string
  shotListFirst: boolean
  exportWhenDone: boolean
}

export function buildDirectorPrompt(brief: DirectorBrief, project: { id: string; name: string }): string {
  const lines = [
    'Cut a video in RiX with the rix-editor tools, following the rix-editor skill.',
    '',
    `Project: "${project.name}" (project_id ${project.id}). Confirm with rix_status that this is still the open project before editing; if it isn't, stop and ask me.`,
    '',
    'Brief:',
    `- Length: about ${brief.lengthSec}s, aspect ${brief.aspect}`,
    brief.folder
      ? `- Footage: my Studio Assets folder "${brief.folder}" (this project's own clips are fair game too)`
      : '- Footage: choose the best matching clips from my Studio Assets library and this project',
    brief.musicPath ? `- Music: ${brief.musicPath}` : '- Music: none',
    `- Transitions: ${(TRANSITION_OPTIONS.find(t => t.value === brief.transition) ?? TRANSITION_OPTIONS[0]).brief}`,
    ...(brief.title.trim() ? [`- End on a title: "${brief.title.trim()}"`] : []),
    ...(brief.notes.trim() ? [`- Notes: ${brief.notes.trim()}`] : []),
    '',
    brief.shotListFirst
      ? 'Show me your shot list and wait for my OK before building.'
      : "Build it without waiting for my approval.",
    `Build on a new timeline, review your cut with render_frames, then ${brief.exportWhenDone
      ? 'export it and tell me the file path.'
      : "stop and tell me it's ready — don't export, I'll review it in RiX first."}`,
  ]
  return lines.join('\n')
}

type McpStatus = Awaited<ReturnType<typeof window.electronAPI.mcpGetStatus>>

function agoLabel(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

export function DirectWithClaudeModal({ project, projectAudio, onClose, onOpened }: {
  project: { id: string; name: string }
  projectAudio: Asset[]
  onClose: () => void
  onOpened: (message: string) => void
}) {
  const [folders, setFolders] = useState<string[]>([])
  const [libraryAudio, setLibraryAudio] = useState<Array<{ name: string; path: string; folder: string }>>([])
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<DirectorBrief>({
    lengthSec: 30, aspect: '16:9', folder: '', musicPath: '', transition: 'cut', title: '', notes: '',
    shotListFirst: true, exportWhenDone: true,
  })
  const set = <K extends keyof DirectorBrief>(k: K, v: DirectorBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  useEffect(() => {
    void window.electronAPI.gpmLibList().then(lib => {
      setFolders(lib.folders)
      setLibraryAudio(lib.files.filter(f => f.isAudio).map(f => ({ name: f.name, path: f.path, folder: f.folder })))
    }).catch(() => {})
  }, [])

  const refreshStatus = useCallback(() => {
    void window.electronAPI.mcpGetStatus().then(setStatus).catch(() => {})
  }, [])
  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const prompt = useMemo(() => buildDirectorPrompt(brief, project), [brief, project])
  const ready = !!status?.running

  const openInClaude = async () => {
    setOpening(true)
    setError(null)
    try {
      const r = await window.electronAPI.openClaudeCode({ prompt })
      if (!r.success) { setError(r.error); return }
      onOpened('Opened in Claude — review the brief and press Send')
      onClose()
    } finally {
      setOpening(false)
    }
  }

  const fieldCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
  const labelCls = 'block text-xs font-medium text-zinc-400 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-xl relative overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Clapperboard className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Direct with Claude</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* Connection */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                !ready ? 'bg-zinc-600' : status?.lastClient ? 'bg-emerald-400' : 'bg-amber-400'
              }`} />
              <div className="text-xs min-w-0">
                {!ready ? (
                  <span className="text-zinc-300">Claude can't reach the editor yet.</span>
                ) : status?.lastClient ? (
                  <span className="text-zinc-300">
                    Editor is open to Claude · last connected: <span className="text-white">{status.lastClient.name}</span>, {agoLabel(status.lastClient.at)}
                  </span>
                ) : (
                  <span className="text-zinc-300">Editor is open to Claude · no Claude app has connected yet.</span>
                )}
              </div>
            </div>
            {status && !status.forcedOn && (
              <label className="flex items-center gap-2 text-xs text-zinc-300 flex-shrink-0 cursor-pointer" title="Lets your Claude app edit timelines in RiX through a private, local-only connection">
                <input
                  type="checkbox"
                  checked={status.enabled}
                  onChange={(e) => void window.electronAPI.mcpSetEnabled({ enabled: e.target.checked }).then(refreshStatus)}
                  className="accent-[rgb(var(--accent))]"
                />
                Allow Claude to control the editor
              </label>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Length (seconds)</label>
              <input type="number" min={5} max={600} value={brief.lengthSec}
                onChange={(e) => set('lengthSec', Math.max(5, Math.min(600, Number(e.target.value) || 30)))} className={fieldCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Aspect</label>
              <div className="flex gap-2">
                {(['9:16', '16:9', '1:1'] as Aspect[]).map(a => (
                  <button key={a} onClick={() => set('aspect', a)}
                    className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                      brief.aspect === a ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >{a}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Footage</label>
            <select value={brief.folder} onChange={(e) => set('folder', e.target.value)} className={fieldCls}>
              <option value="">Let Claude choose from all my footage</option>
              {folders.map(f => <option key={f} value={f}>Studio Assets › {f}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Music</label>
            <select value={brief.musicPath} onChange={(e) => set('musicPath', e.target.value)} className={fieldCls}>
              <option value="">No music</option>
              {projectAudio.length > 0 && (
                <optgroup label="This project">
                  {projectAudio.map(a => <option key={a.id} value={a.path}>{a.path.split(/[\\/]/).pop()}</option>)}
                </optgroup>
              )}
              {libraryAudio.length > 0 && (
                <optgroup label="Studio Assets">
                  {libraryAudio.map(a => <option key={a.path} value={a.path}>{a.folder} › {a.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>

          <div>
            <label className={labelCls}>Transitions between clips</label>
            <select value={brief.transition} onChange={(e) => set('transition', e.target.value as ClipTransition)} className={fieldCls}>
              {TRANSITION_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>End on a title (optional)</label>
            <input value={brief.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. TRICK OR TREAT" className={fieldCls} />
          </div>

          <div>
            <label className={labelCls}>Notes for Claude (optional)</label>
            <textarea value={brief.notes} onChange={(e) => set('notes', e.target.value)} rows={3}
              placeholder="Mood, pacing, shots to include or avoid, keep the witch's dialogue…" className={`${fieldCls} resize-none`} />
          </div>

          <div className="flex flex-col gap-2 text-sm text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={brief.shotListFirst} onChange={(e) => set('shotListFirst', e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Show me the shot list before building
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={brief.exportWhenDone} onChange={(e) => set('exportWhenDone', e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Export when done (to Studio Assets › RiX Edits)
            </label>
          </div>

          <details className="rounded-xl border border-zinc-800 bg-zinc-950/50">
            <summary className="px-4 py-2.5 text-xs text-zinc-400 cursor-pointer select-none">What Claude will receive</summary>
            <pre className="px-4 pb-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">{prompt}</pre>
          </details>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 space-y-2">
          <button
            onClick={() => void openInClaude()}
            disabled={!ready || opening}
            className="w-full py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Open in Claude
          </button>
          <p className="text-[11px] text-zinc-500 text-center">
            Opens Claude Desktop's Code tab with this brief filled in — you press Send. Runs on your own Claude plan; RiX never sees your Claude login.
          </p>
        </div>
      </div>
    </div>
  )
}
