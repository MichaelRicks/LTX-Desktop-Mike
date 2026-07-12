import { useEffect, useRef, useState } from 'react'
import { Orbit, Upload, X, ChevronLeft, ChevronRight, Send, Save, Shuffle, FolderOpen } from 'lucide-react'
import type { GpmImage } from './gpm-storage'
import { gpmId } from './gpm-storage'
import { GPM_IMAGE_DND_TYPE, type GpmDndImage } from './gpm-image-file'
import { FILE_DND, type LibFile } from './DownloadsBrowser'
import { ApiClient } from '@/lib/api-client'
import {
  AZIMUTH_BUCKETS, ELEVATION_BUCKETS, DISTANCE_BUCKETS,
  snapAzimuth, snapElevation, snapPose, poseToPrompt,
} from './qwen-angle-mapping'

// Matches the standalone app's own detent labels — easier to scan than raw
// degrees, and these are the LoRA's real vocabulary words anyway.
const ELEVATION_SHORT_LABELS = ['Low', 'Eye', 'Elevated', 'High']

const SAVE_FOLDER_KEY = 'gpm_qwen_angle_save_folder'

/* Theme tokens — matches PromptManagerPro.tsx's C object exactly. */
const C = {
  panel: '#0e0e12', card: '#16161b', elev: '#1c1c22',
  border: '#26262d', borderLt: '#34343d',
  text: '#f3f3f6', muted: '#8c8c95', faint: '#5c5c65',
  blue: '#1f8fff', green: '#28c76f', amber: '#f5a623',
}
const ACCENT2 = '#ff5c93' // camera-dot / sight-line accent, distinct from C.blue

interface ResultEntry {
  id: string
  dataUrl: string
  prompt: string
  seed: number
  isMock: boolean
}

/* ---- 3D orbit gizmo math (ported verbatim from the standalone app) -------
   Fixed viewpoint: the VIEW never moves, only the camera dot orbits. One
   constant projection, no scene graph. See reference/README.md in the
   standalone repo for why this beats an orbiting-camera implementation. */
const G3D = {
  pitch: (28 * Math.PI) / 180,
  D: 3.2,
  f: 220,
  cx: 110, cy: 95,
  radii: [0.8, 1.0, 1.25],
}
function g3dProject(x: number, y: number, z: number) {
  const c = Math.cos(G3D.pitch), s = Math.sin(G3D.pitch)
  const y2 = y * c - z * s
  const z2 = y * s + z * c
  const k = G3D.f / (G3D.D - z2)
  return { sx: G3D.cx + x * k, sy: G3D.cy - y2 * k, depth: z2 }
}
function g3dDotWorld(azDeg: number, elDeg: number, znIdx: number) {
  const az = (azDeg * Math.PI) / 180
  const el = (elDeg * Math.PI) / 180
  const r = G3D.radii[znIdx]
  return { x: r * Math.cos(el) * Math.sin(az), y: r * Math.sin(el), z: r * Math.cos(el) * Math.cos(az) }
}
function ringPoints(azFrom: number, azTo: number, r: number, steps: number) {
  const pts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const a = ((azFrom + (azTo - azFrom) * (i / steps)) * Math.PI) / 180
    pts.push({ x: r * Math.sin(a), y: 0, z: r * Math.cos(a) })
  }
  return pts
}
function drawPolyline(
  ctxBack: CanvasRenderingContext2D, ctxFront: CanvasRenderingContext2D,
  pts: { x: number; y: number; z: number }[],
  style: Partial<CanvasRenderingContext2D>,
) {
  for (const ctx of [ctxBack, ctxFront]) {
    ctx.save()
    Object.assign(ctx, style)
    ctx.beginPath()
    let started = false
    for (const p of pts) {
      const front = p.z >= 0
      if ((ctx === ctxFront) !== front) { started = false; continue }
      const q = g3dProject(p.x, p.y, p.z)
      if (started) ctx.lineTo(q.sx, q.sy); else { ctx.moveTo(q.sx, q.sy); started = true }
    }
    ctx.stroke()
    ctx.restore()
  }
}

export function QwenMultiAnglePanel({ onUse, flash }: {
  onUse: (img: GpmImage) => void
  flash: (m: string) => void
}) {
  const [source, setSource] = useState<{ name: string; dataUrl: string } | null>(null)
  const [view, setView] = useState<'dial' | '3d'>('3d')
  const [azDeg, setAzDeg] = useState(135)
  const [elDeg, setElDeg] = useState(0)
  const [znIdx, setZnIdx] = useState(0)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [seed, setSeed] = useState(42)
  const [randomizeSeed, setRandomizeSeed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<ResultEntry[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [saveFolder, setSaveFolder] = useState<string | null>(() => localStorage.getItem(SAVE_FOLDER_KEY))
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragState = useRef<{ lastX: number; lastY: number } | null>(null)

  const azIdx = snapAzimuth(azDeg)
  const elIdx = snapElevation(elDeg)
  const pose = snapPose(azDeg, elDeg, DISTANCE_BUCKETS[znIdx].zoom)
  const isEcu = znIdx === 0 && /extreme close-up/i.test(extraPrompt)
  const prompt = extraPrompt.trim() ? `${poseToPrompt(pose)}, ${extraPrompt.trim()}` : poseToPrompt(pose)

  /* ---- source image: file picker + drag-drop (from disk or another GPM panel) ---- */
  const readDataUrl = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file)
  })
  const onSourceDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const gpm = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
    if (gpm) { const d = JSON.parse(gpm) as GpmDndImage; setSource({ name: d.name, dataUrl: d.dataUrl }); return }
    // Studio Assets (Downloads Browser) drags on-disk files by path, not a
    // dataUrl. Read the bytes and build a real data URL — the backend
    // generate call needs actual image data, not a file:// reference.
    const lib = e.dataTransfer.getData(FILE_DND)
    if (lib) {
      const d = JSON.parse(lib) as LibFile
      if (!d.isVideo && !d.isAudio) {
        const file = await window.electronAPI?.readLocalFile?.({ filePath: d.path })
        if (file) setSource({ name: d.name, dataUrl: `data:${file.mimeType};base64,${file.data}` })
      }
      return
    }
    const file = e.dataTransfer.files?.[0]
    if (file?.type.startsWith('image/')) setSource({ name: file.name, dataUrl: await readDataUrl(file) })
  }
  const onSourcePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (file) setSource({ name: file.name, dataUrl: await readDataUrl(file) })
  }

  /* ---- 3D canvas draw ---- */
  useEffect(() => {
    if (view !== '3d') return
    const back = backCanvasRef.current?.getContext('2d')
    const front = frontCanvasRef.current?.getContext('2d')
    if (!back || !front) return
    back.clearRect(0, 0, 220, 190)
    front.clearRect(0, 0, 220, 190)

    const rOrbit = G3D.radii[znIdx]
    drawPolyline(back, front, ringPoints(0, 360, rOrbit, 96), { strokeStyle: C.borderLt, lineWidth: 1.5 })
    AZIMUTH_BUCKETS.forEach((b, i) => {
      drawPolyline(back, front,
        [0.93, 1.07].map((rr) => {
          const a = (b.deg * Math.PI) / 180
          return { x: rr * rOrbit * Math.sin(a), y: 0, z: rr * rOrbit * Math.cos(a) }
        }),
        { strokeStyle: i === azIdx ? C.blue : C.borderLt, lineWidth: i === azIdx ? 2.5 : 1.5 })
    })
    const azC = AZIMUTH_BUCKETS[azIdx].deg
    drawPolyline(back, front, ringPoints(azC - 22.5, azC + 22.5, rOrbit, 24), { strokeStyle: C.blue, lineWidth: 4, lineCap: 'round' })

    const d = g3dDotWorld(azDeg, elDeg, znIdx)
    const behind = d.z < 0
    const ctx = behind ? back : front
    const dp = g3dProject(d.x, d.y, d.z)
    const fp = g3dProject(d.x, 0, d.z)
    const op = g3dProject(0, 0, 0)

    ctx.save()
    ctx.globalAlpha = behind ? 0.45 : 1
    ctx.setLineDash([4, 4]); ctx.strokeStyle = ACCENT2; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(dp.sx, dp.sy); ctx.lineTo(op.sx, op.sy); ctx.stroke()
    ctx.setLineDash(behind ? [3, 3] : [])
    ctx.strokeStyle = ACCENT2; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(fp.sx, fp.sy); ctx.lineTo(dp.sx, dp.sy); ctx.stroke()
    ctx.beginPath(); ctx.arc(dp.sx, dp.sy, 6, 0, Math.PI * 2)
    ctx.fillStyle = ACCENT2; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.restore()

    front.save()
    front.beginPath(); front.arc(op.sx, op.sy, 3, 0, Math.PI * 2)
    front.fillStyle = C.borderLt; front.fill()
    front.restore()

    const fpnt = g3dProject(0, 0, rOrbit * 1.24)
    front.save()
    front.font = '600 9px sans-serif'; front.textAlign = 'center'; front.fillStyle = C.muted
    front.fillText('FRONT', fpnt.sx, fpnt.sy + 3)
    front.restore()
  }, [view, azDeg, elDeg, znIdx, azIdx])

  const onGizmoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { lastX: e.clientX, lastY: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onGizmoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.lastX
    const dy = e.clientY - dragState.current.lastY
    dragState.current = { lastX: e.clientX, lastY: e.clientY }
    setAzDeg((a) => a + dx * 0.5)
    setElDeg((el) => Math.max(-30, Math.min(60, el - dy * 0.35)))
  }
  const onGizmoPointerUp = () => { dragState.current = null }
  const onGizmoWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZnIdx((z) => Math.max(0, Math.min(2, z + (e.deltaY > 0 ? 1 : -1))))
  }

  /* ---- dial (2D) geometry ---- */
  const R = 78
  const azToXY = (deg: number, r = R) => {
    const rad = (deg * Math.PI) / 180
    return [r * Math.sin(rad), r * Math.cos(rad)]
  }

  const generate = async () => {
    if (!source || busy) return
    setBusy(true)
    const result = await ApiClient.qwenMultiAngleGenerate({
      image_data_url: source.dataUrl,
      azimuth_deg: azDeg,
      elevation_deg: elDeg,
      zoom: DISTANCE_BUCKETS[znIdx].zoom,
      seed,
      randomize_seed: randomizeSeed,
      use_lightning: true,
      extra_prompt: extraPrompt,
    })
    if (!result.ok) {
      flash(`Generate failed: ${result.error.message}`)
      setBusy(false)
      return
    }
    const entry: ResultEntry = {
      id: gpmId(),
      dataUrl: result.data.image_data_url,
      prompt: result.data.prompt,
      seed: result.data.seed,
      isMock: false,
    }
    setHistory((h) => { const next = [...h, entry]; setHistIdx(next.length - 1); return next })
    setBusy(false)
  }

  const current = histIdx >= 0 ? history[histIdx] : null

  const inject = () => {
    if (!current) return
    onUse({ id: current.id, name: `qwen-angle-${current.seed}`, folderId: null, dataUrl: current.dataUrl, addedAt: Date.now(), isVideo: false })
    flash('Sent to Gen Space')
  }

  const chooseFolder = async () => {
    const dir = await window.electronAPI?.showOpenDirectoryDialog?.({ title: 'Choose a folder for saved angle images' })
    if (!dir) return
    setSaveFolder(dir)
    localStorage.setItem(SAVE_FOLDER_KEY, dir)
    setSaveStatus(`Save folder: ${dir}`)
  }
  const saveResult = async () => {
    if (!current) return
    let folder = saveFolder
    if (!folder) {
      folder = await window.electronAPI?.showOpenDirectoryDialog?.({ title: 'Choose a folder for saved angle images' }) ?? null
      if (!folder) return
      setSaveFolder(folder)
      localStorage.setItem(SAVE_FOLDER_KEY, folder)
    }
    const slug = current.prompt.replace(/^<sks>\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `${folder}/qwen_angle_${stamp}_${slug || 'image'}.png`
    const base64 = current.dataUrl.split(',')[1] ?? current.dataUrl
    const res = await window.electronAPI?.saveFile?.({ filePath, data: base64, encoding: 'base64' })
    if (res?.success) { setSaveStatus(`Saved: ${res.path}`); flash('Saved') }
    else { setSaveStatus(`Save failed: ${res?.error ?? 'unknown error'}`); flash('Save failed') }
  }
  const onResultDragStart = (e: React.DragEvent) => {
    if (!current) return
    e.dataTransfer.setData(GPM_IMAGE_DND_TYPE, JSON.stringify({ name: `qwen-angle-${current.seed}`, dataUrl: current.dataUrl }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Orbit size={16} style={{ color: C.blue }} />
        <span className="text-sm font-semibold" style={{ color: C.text }}>Multi-Angle</span>
      </div>

      <div className="flex flex-wrap gap-3 mb-2">
        {/* source image — 16:9, generously sized */}
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onSourceDrop(e)}
            onClick={() => fileRef.current?.click()}
            className="rounded-md cursor-pointer overflow-hidden relative w-full"
            style={{ border: source ? `1px solid ${C.border}` : `1px dashed ${C.borderLt}`, aspectRatio: '16/9', background: C.card }}
            title="Click or drop an image"
          >
            {source
              ? <img src={source.dataUrl} alt={source.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ color: C.faint }}>
                  <Upload size={18} /><span className="text-[10px]">Click or drop an image</span>
                </div>}
            {source && (
              <button
                onClick={(e) => { e.stopPropagation(); setSource(null); setHistory([]); setHistIdx(-1) }}
                className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded"
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }} title="Clear"
              ><X size={12} /></button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onSourcePick(e)} />

          {/* extra prompt — sits under the preview image to fill the space
             left over now that the image is a short 16:9 box. */}
          <div className="relative mt-2">
            <textarea
              value={extraPrompt} onChange={(e) => setExtraPrompt(e.target.value)} rows={4}
              placeholder="Extra prompt — lighting, mood, added elements"
              className="w-full text-[11px] rounded px-2 py-1.5 resize-none"
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
            />
            {extraPrompt && (
              <button onClick={() => setExtraPrompt('')} className="absolute top-1 right-1 h-4 w-4 flex items-center justify-center rounded-full" style={{ background: C.borderLt, color: C.text }}>
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* camera controls */}
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div className="flex rounded-md overflow-hidden mb-2" style={{ border: `1px solid ${C.border}` }}>
            {(['3d', 'dial'] as const).map((v) => (
              <button
                key={v} onClick={() => setView(v)}
                className="flex-1 text-[11px] py-1.5 font-medium"
                style={{ background: view === v ? C.blue : C.card, color: view === v ? '#fff' : C.muted }}
              >{v === '3d' ? '3D Orbit' : 'Dial'}</button>
            ))}
          </div>

          {view === '3d' ? (
            <div
              onPointerDown={onGizmoPointerDown} onPointerMove={onGizmoPointerMove} onPointerUp={onGizmoPointerUp}
              onWheel={onGizmoWheel}
              className="relative mb-2 mx-auto" style={{ width: 220, height: 190, cursor: 'grab', touchAction: 'none' }}
            >
              <canvas ref={backCanvasRef} width={220} height={190} className="absolute inset-0 pointer-events-none" />
              <canvas ref={frontCanvasRef} width={220} height={190} className="absolute inset-0 pointer-events-none" />
            </div>
          ) : (
            <div className="flex justify-center mb-2">
              <svg width={180} height={180} viewBox="-90 -90 180 180">
                {AZIMUTH_BUCKETS.map((b, i) => {
                  const [x0, y0] = azToXY(b.deg - 22.5, 84), [x1, y1] = azToXY(b.deg + 22.5, 84)
                  const [xi0, yi0] = azToXY(b.deg - 22.5, 36), [xi1, yi1] = azToXY(b.deg + 22.5, 36)
                  return (
                    <path
                      key={b.deg}
                      d={`M ${xi0} ${yi0} L ${x0} ${y0} A 84 84 0 0 1 ${x1} ${y1} L ${xi1} ${yi1} A 36 36 0 0 0 ${xi0} ${yi0} Z`}
                      fill={i === azIdx ? 'rgba(31,143,255,0.35)' : C.card}
                      stroke={i === azIdx ? C.blue : C.border}
                      onClick={() => setAzDeg(b.deg)}
                      style={{ cursor: 'pointer' }}
                    />
                  )
                })}
                <circle r={11} fill={C.borderLt} />
                <polygon points="-6,9 6,9 0,20" fill={C.borderLt} />
                <circle cx={azToXY(azDeg, 60)[0]} cy={azToXY(azDeg, 60)[1]} r={8} fill={ACCENT2} stroke="#fff" strokeWidth={1.5} />
              </svg>
            </div>
          )}

          {/* elevation */}
          <div className="flex gap-1 mb-2">
            {ELEVATION_BUCKETS.map((b, i) => (
              <button
                key={b.deg} onClick={() => setElDeg(b.deg)}
                className="flex-1 text-[10px] py-1 rounded"
                style={{ background: i === elIdx ? C.blue : C.card, color: i === elIdx ? '#fff' : C.muted, border: `1px solid ${i === elIdx ? C.blue : C.border}` }}
              >{ELEVATION_SHORT_LABELS[i]}</button>
            ))}
          </div>

          {/* zoom + ECU */}
          <div className="flex gap-1 mb-2">
            {DISTANCE_BUCKETS.map((b, i) => (
              <button
                key={b.zoom} onClick={() => setZnIdx(i)}
                className="flex-1 text-[10px] py-1.5 rounded"
                style={{ background: i === znIdx && !isEcu ? C.blue : C.card, color: i === znIdx && !isEcu ? '#fff' : C.muted, border: `1px solid ${i === znIdx && !isEcu ? C.blue : C.border}` }}
              >{b.phrase}</button>
            ))}
            <button
              onClick={() => { setZnIdx(0); if (!/extreme close-up/i.test(extraPrompt)) setExtraPrompt((p) => (p.trim() ? `${p.trim()}, extreme close-up` : 'extreme close-up')) }}
              className="flex-1 text-[10px] py-1.5 rounded font-semibold"
              style={{ background: isEcu ? C.amber : C.card, color: isEcu ? '#1a1206' : C.muted, border: `1px solid ${isEcu ? C.amber : C.border}` }}
            >ECU</button>
          </div>
        </div>
      </div>

      {/* live prompt preview */}
      <div className="rounded px-2 py-1.5 mb-2 text-[10px] font-mono truncate" style={{ background: C.elev, color: ACCENT2, border: `1px solid ${C.border}` }} title={prompt}>
        {prompt}
      </div>

      {/* seed */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px]" style={{ color: C.muted }}>Seed</span>
        <input
          type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)}
          className="flex-1 text-[11px] rounded px-2 py-1"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        />
        <button
          onClick={() => setRandomizeSeed((r) => !r)} title="Randomize seed each generation"
          className="h-6 w-6 flex items-center justify-center rounded"
          style={{ background: randomizeSeed ? C.blue : C.card, color: randomizeSeed ? '#fff' : C.muted, border: `1px solid ${randomizeSeed ? C.blue : C.border}` }}
        ><Shuffle size={12} /></button>
      </div>

      <button
        onClick={() => void generate()} disabled={!source || busy}
        className="w-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold mb-3 disabled:opacity-40"
        style={{ background: C.blue, color: '#fff' }}
      >
        {busy ? 'Generating…' : 'Generate'}
      </button>

      {/* result + history — deliberately large, matching the standalone's
         prominent result window (min-height 420px, up to 74vh there). */}
      {history.length > 0 && (
        <div className="pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div
            className="relative rounded-md overflow-hidden mb-2 flex items-center justify-center"
            style={{ background: '#000', minHeight: 320, maxHeight: '60vh' }}
          >
            {current && (
              <img
                src={current.dataUrl} alt="" draggable onDragStart={onResultDragStart}
                style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
              />
            )}
            {current?.isMock && (
              <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.65)', color: C.amber }}>
                Preview &middot; backend not wired yet
              </div>
            )}
            {history.length > 1 && (
              <>
                <button
                  onClick={() => setHistIdx((i) => Math.max(0, i - 1))} disabled={histIdx <= 0}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded disabled:opacity-30"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                ><ChevronLeft size={18} /></button>
                <button
                  onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))} disabled={histIdx >= history.length - 1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded disabled:opacity-30"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                ><ChevronRight size={18} /></button>
                <div className="absolute bottom-2 right-2 px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(0,0,0,0.6)', color: C.text }}>
                  {histIdx + 1} / {history.length}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-1.5 mb-1.5">
            <button
              onClick={inject} disabled={!current}
              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: C.blue, color: '#fff' }}
            ><Send size={12} />Inject</button>
            <button
              onClick={() => void saveResult()} disabled={!current}
              className="flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] disabled:opacity-40"
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
            ><Save size={12} />Save</button>
            <button
              onClick={() => void chooseFolder()}
              className="flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px]"
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }} title="Choose save folder"
            ><FolderOpen size={12} /></button>
          </div>
          {saveStatus && <p className="text-[10px] break-all" style={{ color: C.faint }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  )
}
