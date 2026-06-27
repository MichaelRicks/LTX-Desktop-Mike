/**
 * Prompt Manager Pro — collapsible dock.
 *
 * Real React UI matching the `ltx-gpm.jsx` prototype (C color tokens, tabbed
 * dock, collapsible Sections with collapse-all), wired to the REAL pure engines
 * in `@/gpm-core`. Every panel can Copy its assembled prompt or Inject it into
 * the LTX Gen Space prompt box (via ProjectContext). No generation simulation.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera, ChevronRight, Copy, Download, Eraser, Film, Folder, FolderPlus, Image as ImageIcon,
  Layers, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Search, Send, Trash2, Upload, Wand2, X,
} from 'lucide-react'
import {
  PERF_FAMILIES, assemblePerformance, perfLabel, type PerfDelivery,
  SHOT_PRESETS, SHOT_ANCHORS, buildShotPrompt, type ShotState,
  CAM_CATS, filterCameraCards, type CameraCategory,
  WF_ROLES, buildWorkflowPrompt, type WfState, type WfRole,
} from '@/gpm-core'
import { useProjects } from '@/contexts/ProjectContext'
import {
  type GpmPromptFolder, type GpmImageFolder, type GpmImage, gpmId,
  loadPromptFolders, savePromptFolders, loadImageFolders, saveImageFolders,
  loadImages, putImage, deleteImage, exportBackup, importBackup, parseBackup,
  loadAllPromptThumbs, deletePromptThumb,
} from './gpm-storage'
import { saveDataUrlToTempFile, GPM_IMAGE_DND_TYPE } from './gpm-image-file'

/* Theme tokens sampled from the LTX / GPM screenshots (from the prototype). */
const C = {
  panel: '#0e0e12', card: '#16161b', elev: '#1c1c22',
  border: '#26262d', borderLt: '#34343d',
  text: '#f3f3f6', muted: '#8c8c95', faint: '#5c5c65',
  blue: '#1f8fff', green: '#28c76f', amber: '#f5a623',
}

// Camera reference thumbnails, bundled by Vite. Map filename -> resolved URL.
const CAM_IMAGE_URLS = import.meta.glob('../../assets/gpm-camera/*.jpg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
function camImageUrl(file?: string): string | undefined {
  if (!file) return undefined
  const hit = Object.entries(CAM_IMAGE_URLS).find(([p]) => p.endsWith('/' + file))
  return hit?.[1]
}

type GpmTab = 'performance' | 'shot' | 'camera' | 'workflow' | 'prompts' | 'images' | 'plates'

interface PerfState {
  familyIndex: number
  intensity: number
  asymmetry: number
  dialogue: string
  delivery: PerfDelivery
}

/* Section open-state shared across the dock, with a global collapse-all. */
interface SectionCtl {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
}

/* ---- UI atoms (ported from the prototype) -------------------------------- */
function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${className}`} style={{ color: C.muted }}>
      {children}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1 rounded tabular-nums" style={{ background: C.elev, color: C.blue, fontSize: 9 }}>
      {children}
    </span>
  )
}

function Slider({
  value, min, max, step, onChange, left, mid, right,
}: {
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void
  left?: string | number; mid?: string; right?: string | number
}) {
  return (
    <div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 cursor-pointer"
        style={{ accentColor: C.blue, background: 'transparent' }}
      />
      <div className="flex justify-between mt-1 text-[10px] tracking-wide" style={{ color: C.faint }}>
        <span>{left}</span><span>{mid}</span><span>{right}</span>
      </div>
    </div>
  )
}

function Section({
  id, title, ctl, right, children,
}: {
  id: string; title: React.ReactNode; ctl: SectionCtl
  right?: React.ReactNode; children: React.ReactNode
}) {
  const open = ctl.isOpen(id)
  return (
    <div className="rounded-lg mb-2 overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <button
        onClick={() => ctl.toggle(id)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ background: C.card, color: C.text }}
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: C.muted }} />
          {title}
        </span>
        {right}
      </button>
      {open && <div className="p-3" style={{ borderTop: `1px solid ${C.border}` }}>{children}</div>}
    </div>
  )
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <Search size={14} style={{ color: C.faint }} />
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-xs" style={{ color: C.text }}
      />
    </div>
  )
}

/* Copy + Inject action row, shared by panels with a single assembled output. */
function ActionRow({
  text, onCopy, onInject,
}: { text: string; onCopy: (t: string) => void; onInject: (t: string) => void }) {
  const disabled = !text.trim()
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <button
        onClick={() => onCopy(text)} disabled={disabled}
        className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
        style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
      >
        <Copy size={13} />Copy prompt
      </button>
      <button
        onClick={() => onInject(text)} disabled={disabled}
        title="Send the assembled prompt to the LTX Gen Space prompt box"
        className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
        style={{ background: C.green, color: '#fff' }}
      >
        <Send size={13} />Inject into prompt
      </button>
    </div>
  )
}

/* ---- Performance Studio --------------------------------------------------- */
function PerformancePanel({
  perf, setPerf, ctl, onCopy, onInject,
}: {
  perf: PerfState; setPerf: React.Dispatch<React.SetStateAction<PerfState>>
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void
}) {
  const up = <K extends keyof PerfState>(k: K, v: PerfState[K]) => setPerf((p) => ({ ...p, [k]: v }))
  const perfOut = useMemo(() => assemblePerformance(perf), [perf])
  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        24 emotion families with intensity, asymmetry, dialogue, and delivery pacing
      </p>
      <Section id="perf-controls" title="Controls" ctl={ctl}>
        <Label>Emotion Family</Label>
        <select
          value={perf.familyIndex} onChange={(e) => up('familyIndex', parseInt(e.target.value, 10))}
          className="w-full rounded-md px-3 py-2 text-sm mb-4 outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        >
          {PERF_FAMILIES.map((f, i) => <option key={f.family} value={i}>{f.family}</option>)}
        </select>

        <div className="flex items-center justify-between">
          <Label>Intensity <span style={{ color: C.blue }}>{perfLabel(PERF_FAMILIES[perf.familyIndex], perf.intensity)}</span></Label>
          <span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.intensity.toFixed(2)}</span>
        </div>
        <Slider value={perf.intensity} min={0} max={1} step={0.01} onChange={(v) => up('intensity', v)} left="contained" mid="surfacing" right="breaking" />

        <div className="flex items-center justify-between mt-4">
          <Label>Asymmetry</Label>
          <span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.asymmetry.toFixed(2)}</span>
        </div>
        <Slider value={perf.asymmetry} min={0} max={1} step={0.01} onChange={(v) => up('asymmetry', v)} left="symmetric" mid="" right="acted" />

        <div className="mt-4 mb-1 flex items-center gap-2">
          <Label>Dialogue</Label>
          {perf.dialogue.trim() && <span className="text-[10px]" style={{ color: C.amber }}>auto-appends lip sync</span>}
        </div>
        <textarea
          value={perf.dialogue} onChange={(e) => up('dialogue', e.target.value)} rows={2}
          className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />

        <Label className="mt-4">Delivery</Label>
        <select
          value={perf.delivery} onChange={(e) => up('delivery', e.target.value as PerfDelivery)}
          className="w-full rounded-md px-3 py-2 text-sm outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        >
          <option value="natural">Natural (let emotion set the pace)</option>
          <option value="slow">Slow (weigh each word)</option>
          <option value="halting">Halting (start, stop, search)</option>
        </select>
      </Section>

      <Section id="perf-assembled" title={`Assembled · ${perfOut.label}`} ctl={ctl}>
        <div className="space-y-1.5">
          {perfOut.layers.map((l) => (
            <div key={l.k} className="text-[11px] leading-snug">
              <span className="font-semibold" style={{ color: C.muted }}>{l.k}: </span>
              <span style={{ color: C.text }}>{l.v}</span>
            </div>
          ))}
        </div>
      </Section>
      <ActionRow text={perfOut.text} onCopy={onCopy} onInject={onInject} />
    </div>
  )
}

/* ---- Shot Setup ----------------------------------------------------------- */
const SHOT_RANGES: Record<'rot' | 'tilt' | 'zoom', [number, number]> = { rot: [-90, 90], tilt: [-45, 45], zoom: [1, 20] }
const clampShot = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v))

function ShotPanel({
  shot, setShot, ctl, onCopy, onInject, onUseImage, flash,
}: {
  shot: ShotState; setShot: React.Dispatch<React.SetStateAction<ShotState>>
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void
  onUseImage: (img: GpmImage) => void; flash: (m: string) => void
}) {
  const shotOut = useMemo(() => buildShotPrompt(shot), [shot])
  const setSlider = (k: 'rot' | 'tilt' | 'zoom', v: number) => setShot((s) => ({ ...s, [k]: v, preset: null }))
  const nudge = (k: 'rot' | 'tilt' | 'zoom', d: number) => setSlider(k, clampShot(shot[k] + d, SHOT_RANGES[k][0], SHOT_RANGES[k][1]))
  const toggleAnchor = (id: string) => setShot((s) => ({ ...s, anchors: { ...s.anchors, [id]: !s.anchors[id] } }))
  const sliders: Array<['rot' | 'tilt' | 'zoom', string, number, number]> = [
    ['rot', 'Rotate', -90, 90], ['tilt', 'Tilt', -45, 45], ['zoom', 'Zoom', 1, 20],
  ]

  // Source frame the virtual camera reframes.
  const [srcImage, setSrcImage] = useState<{ name: string; dataUrl: string } | null>(null)
  const [library, setLibrary] = useState<GpmImage[]>([])
  const [picker, setPicker] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { void loadImages().then(setLibrary) }, [])

  const readFile = (file: File) => {
    const r = new FileReader()
    r.onload = () => setSrcImage({ name: file.name, dataUrl: String(r.result) })
    r.readAsDataURL(file)
  }
  const onDropImg = (e: React.DragEvent) => {
    e.preventDefault()
    const gpm = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
    if (gpm) { const d = JSON.parse(gpm) as { name: string; dataUrl: string }; setSrcImage(d); return }
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) readFile(file)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      w: () => nudge('zoom', 1), s: () => nudge('zoom', -1),
      a: () => nudge('rot', -5), d: () => nudge('rot', 5),
      q: () => nudge('tilt', 5), e: () => nudge('tilt', -5),
    }
    const fn = map[e.key.toLowerCase()]
    if (fn) { e.preventDefault(); fn() }
  }
  const scale = 0.6 + ((shot.zoom - 1) / 19) * 2.4
  const previewTransform = `perspective(600px) rotateX(${-shot.tilt * 0.7}deg) rotateY(${shot.rot * 0.7}deg) scale(${scale.toFixed(3)})`

  const applyShot = () => {
    if (shotOut.trim()) onInject(shotOut)
    if (srcImage) onUseImage({ id: gpmId(), name: srcImage.name, folderId: null, dataUrl: srcImage.dataUrl, addedAt: Date.now(), isVideo: false })
  }
  const resetView = () => setShot((s) => ({ ...s, rot: 0, tilt: 0, zoom: 8, preset: null }))

  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        Virtual camera composer — a transformation applied to the selected shot's existing frame.
      </p>

      <Section id="shot-source" title="Source frame & preview" ctl={ctl}>
        {!srcImage ? (
          <div
            onDragOver={(e) => e.preventDefault()} onDrop={onDropImg}
            className="rounded-md py-6 px-3 text-center"
            style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}
          >
            <ImageIcon size={20} style={{ margin: '0 auto 6px' }} />
            <div className="text-[11px] mb-2">Drag an image here (from the Images tab or a file)</div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setPicker(true)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.blue, color: '#fff' }}>Pick from library</button>
              <button onClick={() => fileRef.current?.click()} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Upload</button>
            </div>
          </div>
        ) : (
          <>
            <div
              tabIndex={0} onKeyDown={onKey} onDragOver={(e) => e.preventDefault()} onDrop={onDropImg}
              className="relative w-full rounded-md overflow-hidden outline-none"
              style={{ aspectRatio: '16/9', background: '#000', border: `1px solid ${C.border}` }}
              title="Click here, then WASD to move · Q/E tilt"
            >
              <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: '600px' }}>
                <img src={srcImage.dataUrl} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', transform: previewTransform, transition: 'transform .08s' }} />
              </div>
              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.6)', color: C.muted }}>
                W/S zoom · A/D rotate · Q/E tilt
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setPicker(true)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Change</button>
              <button onClick={() => fileRef.current?.click()} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Upload</button>
              <button onClick={resetView} title="Reset rotate/tilt/zoom to default" className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}><RotateCcw size={11} />Reset</button>
              <button onClick={() => setSrcImage(null)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>Remove</button>
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f) }} />
      </Section>

      <Section id="shot-presets" title="Presets" ctl={ctl}>
        <div className="grid grid-cols-4 gap-1.5">
          {SHOT_PRESETS.map((p) => {
            const active = shot.preset?.name === p.name
            return (
              <button
                key={p.name}
                onClick={() => setShot({ rot: p.rot, tilt: p.tilt, zoom: p.zoom, preset: p, anchors: shot.anchors })}
                className="rounded-md py-1.5 text-[10px] flex flex-col items-center gap-0.5"
                style={{ background: active ? C.blue : C.elev, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
              >
                <span style={{ fontSize: 13 }}>{p.icon}</span>{p.name}
              </button>
            )
          })}
        </div>
      </Section>
      <Section
        id="shot-camera" title="Camera" ctl={ctl}
        right={<span onClick={(e) => { e.stopPropagation(); resetView() }} className="flex items-center gap-1 text-[10px]" style={{ color: C.muted }}><RotateCcw size={11} />Reset</span>}
      >
        {sliders.map(([k, lbl, mn, mx]) => (
          <div key={k} className="mb-3">
            <div className="flex justify-between"><Label>{lbl}</Label><span className="text-xs tabular-nums" style={{ color: C.blue }}>{shot[k]}</span></div>
            <Slider value={shot[k]} min={mn} max={mx} step={1} onChange={(v) => setSlider(k, v)} left={mn} mid="" right={mx} />
          </div>
        ))}
      </Section>
      <Section id="shot-anchors" title="Consistency anchors" ctl={ctl}>
        <div className="flex flex-wrap gap-1.5">
          {SHOT_ANCHORS.map((a) => {
            const on = !!shot.anchors[a.id]
            return (
              <button
                key={a.id} onClick={() => toggleAnchor(a.id)}
                className="rounded-full px-2.5 py-1 text-[10px]"
                style={{ background: on ? 'rgba(31,143,255,0.15)' : C.elev, color: on ? C.blue : C.muted, border: `1px solid ${on ? C.blue : C.border}` }}
              >
                {a.label}
              </button>
            )
          })}
        </div>
      </Section>
      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}>
        {shotOut}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => onCopy(shotOut)} disabled={!shotOut.trim()}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        >
          <Copy size={13} />Copy prompt
        </button>
        <button
          onClick={applyShot} disabled={!shotOut.trim()}
          title={srcImage ? 'Inject the shot prompt and send the source image to Gen Space' : 'Inject the shot prompt'}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
          style={{ background: C.green, color: '#fff' }}
        >
          <Send size={13} />{srcImage ? 'Apply + image' : 'Inject into prompt'}
        </button>
      </div>

      {picker && (
        <ImagePicker library={library} onPick={(img) => { setSrcImage({ name: img.name, dataUrl: img.dataUrl }); setPicker(false); flash('Source frame set') }} onClose={() => setPicker(false)} />
      )}
    </div>
  )
}

/* ---- Camera techniques ---------------------------------------------------- */
function CameraPanel({
  search, setSearch, camCat, setCamCat, onInject, flash,
}: {
  search: string; setSearch: (v: string) => void
  camCat: 'All' | CameraCategory; setCamCat: (c: 'All' | CameraCategory) => void
  onInject: (t: string) => void; flash: (m: string) => void
}) {
  const cards = useMemo(() => filterCameraCards(camCat, search), [camCat, search])
  return (
    <div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search camera techniques…" />
      <div className="flex flex-wrap gap-1.5 my-3">
        {CAM_CATS.map((cat) => {
          const active = camCat === cat
          return (
            <button
              key={cat} onClick={() => setCamCat(cat)}
              className="rounded-full px-2.5 py-1 text-[10px]"
              style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
            >
              {cat}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const url = camImageUrl(c.image)
          return (
            <button
              key={c.id}
              onClick={() => { onInject(c.phrase); flash(`Injected "${c.label}"`) }}
              title={c.phrase}
              className="rounded-lg overflow-hidden text-left transition-transform hover:scale-[1.02]"
              style={{ border: `1px solid ${C.border}`, background: C.card }}
            >
              <div style={{ aspectRatio: '4/3', background: (url || c.svg) ? '#0f1117' : 'linear-gradient(135deg, #2b2620, #14110d)' }} className="relative flex items-end p-2 overflow-hidden">
                {url
                  ? <img src={url} alt={c.label} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  : c.svg
                    ? <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: c.svg }} />
                    : <Camera size={14} style={{ color: C.amber, opacity: 0.7 }} />}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.text }}>{c.label}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---- Workflow ------------------------------------------------------------- */
function WorkflowPanel({
  wf, setWf, perfText, ctl, onCopy, onInject, onUseImage, flash,
}: {
  wf: WfState; setWf: React.Dispatch<React.SetStateAction<WfState>>; perfText: string
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void
  onUseImage: (img: GpmImage) => void; flash: (m: string) => void
}) {
  const wfOut = useMemo(() => buildWorkflowPrompt(wf, perfText), [wf, perfText])
  const upSlot = (id: string, patch: Partial<WfState['slots'][number]>) =>
    setWf((w) => ({ ...w, slots: w.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const addSlot = () =>
    setWf((w) => ({ ...w, slots: [...w.slots, { id: 's' + Date.now(), role: 'general', note: '', filled: false }] }))
  const up = <K extends keyof WfState>(k: K, v: WfState[K]) => setWf((w) => ({ ...w, [k]: v }))
  const filledCount = wf.slots.filter((s) => s.filled).length

  // Bind reference images from the Images library to slots.
  const [library, setLibrary] = useState<GpmImage[]>([])
  useEffect(() => { void loadImages().then(setLibrary) }, [])
  const imgById = useMemo(() => {
    const m: Record<string, GpmImage> = {}
    for (const im of library) m[im.id] = im
    return m
  }, [library])
  const [pickerSlot, setPickerSlot] = useState<string | null>(null)
  const bindImage = (slotId: string, img: GpmImage) => {
    upSlot(slotId, { imgId: img.id, imgName: img.name, filled: true })
    setPickerSlot(null)
  }
  const unbindImage = (slotId: string) => upSlot(slotId, { imgId: undefined, imgName: undefined, filled: false })

  // Bound images, in slot order. LTX's Gen Space takes a single input image,
  // so Inject sends the first bound image (and notes if there are more).
  const boundImages = wf.slots
    .filter((s): s is typeof s & { imgId: string } => !!s.imgId && !!imgById[s.imgId])
    .map((s) => imgById[s.imgId])
  const injectWorkflow = () => {
    if (wfOut.trim()) onInject(wfOut)
    if (boundImages.length > 0) {
      onUseImage(boundImages[0])
      if (boundImages.length > 1) flash(`Sent 1st of ${boundImages.length} images (LTX takes one input image)`)
    }
  }

  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        Multi-reference assembly — each slot binds an image to a role as <Chip>@imageN</Chip>.
      </p>
      <Section
        id="wf-slots" title={`Reference slots (${filledCount} filled)`} ctl={ctl}
        right={
          <span onClick={(e) => { e.stopPropagation(); addSlot() }} className="flex items-center gap-1 text-[10px]" style={{ color: C.blue }}>
            <Plus size={11} /> Add
          </span>
        }
      >
        <div className="space-y-2">
          {wf.slots.map((s, i) => (
            <div key={s.id} className="rounded-lg p-2 flex gap-2 items-center" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
              <div className="relative w-28 shrink-0">
                <button
                  onClick={() => setPickerSlot(s.id)}
                  title={s.imgName ? `Bound: ${s.imgName} — click to change` : 'Bind a reference image'}
                  className="w-full rounded flex items-center justify-center overflow-hidden text-[8px] text-center"
                  style={{ aspectRatio: '16/9', background: s.imgId ? '#000' : 'transparent', border: `1px dashed ${s.imgId ? C.border : C.borderLt}`, color: C.faint }}
                >
                  {s.imgId && imgById[s.imgId]
                    ? (imgById[s.imgId].isVideo
                        ? <Film size={16} style={{ color: C.amber }} />
                        : <img src={imgById[s.imgId].dataUrl} alt="" className="w-full h-full object-cover" />)
                    : <ImageIcon size={15} style={{ color: C.faint }} />}
                </button>
                {s.imgId && (
                  <button
                    onClick={() => unbindImage(s.id)} title="Unbind image"
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center rounded-full"
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded tabular-nums" style={{ background: C.card, color: C.blue }}>@image{i + 1}</span>
                  <select
                    value={s.role} onChange={(e) => upSlot(s.id, { role: e.target.value as WfRole })}
                    className="flex-1 rounded px-1.5 py-1 text-[11px] outline-none"
                    style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
                  >
                    {WF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <input
                  value={s.note} onChange={(e) => upSlot(s.id, { note: e.target.value })} placeholder="note (e.g. STORM)"
                  className="w-full rounded px-2 py-1 text-[11px] outline-none"
                  style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="wf-directive" title="Directive & output" ctl={ctl}>
        <Label>Directive</Label>
        <textarea
          value={wf.directive} onChange={(e) => up('directive', e.target.value)} rows={2}
          className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none mb-3"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Aspect</Label>
            <select
              value={wf.aspectRatio} onChange={(e) => up('aspectRatio', e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            >
              {['16:9', '9:16', '1:1', '2.39:1'].map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Motion hint</Label>
            <input
              value={wf.motionHint} onChange={(e) => up('motionHint', e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            />
          </div>
        </div>
      </Section>

      <Section id="wf-perf" title="Performance (embedded)" ctl={ctl}>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: C.text }}>
          <input
            type="checkbox" checked={wf.performance.enabled}
            onChange={(e) => setWf((w) => ({ ...w, performance: { enabled: e.target.checked } }))}
            style={{ accentColor: C.blue }}
          />
          Append the current Performance Studio prompt to this workflow
        </label>
      </Section>

      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, minHeight: 44 }}>
        {wfOut || <span style={{ color: C.faint }}>Fill a slot or write a directive to assemble the prompt…</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => onCopy(wfOut)} disabled={!wfOut.trim()}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        >
          <Copy size={13} />Copy prompt
        </button>
        <button
          onClick={injectWorkflow} disabled={!wfOut.trim() && boundImages.length === 0}
          title="Inject the prompt and send the first bound image to Gen Space"
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
          style={{ background: C.green, color: '#fff' }}
        >
          <Send size={13} />{boundImages.length > 0 ? `Inject + ${boundImages.length} img` : 'Inject into prompt'}
        </button>
      </div>

      {pickerSlot && (
        <ImagePicker library={library} onPick={(img) => bindImage(pickerSlot, img)} onClose={() => setPickerSlot(null)} />
      )}
    </div>
  )
}

/* Image library picker overlay for binding a reference image to a slot. */
function ImagePicker({ library, onPick, onClose }: { library: GpmImage[]; onPick: (img: GpmImage) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const items = library.filter((im) => !q || im.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '80%', background: C.panel, border: `1px solid ${C.borderLt}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
          <span className="text-sm font-semibold" style={{ color: C.text }}>Bind reference image</span>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><X size={16} /></button>
        </div>
        <div className="p-3"><SearchBar value={q} onChange={setQ} placeholder="Search images…" /></div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {items.length === 0
            ? <p className="text-[11px] text-center py-8" style={{ color: C.faint }}>No images in the library. Add some in the Images tab.</p>
            : (
              <div className="grid grid-cols-3 gap-2">
                {items.map((im) => (
                  <button
                    key={im.id} onClick={() => onPick(im)} title={im.name}
                    className="rounded-md overflow-hidden" style={{ aspectRatio: '16/9', background: '#000', border: `1px solid ${C.border}` }}
                  >
                    {im.isVideo
                      ? <span className="w-full h-full flex items-center justify-center"><Film size={18} style={{ color: C.amber }} /></span>
                      : <img src={im.dataUrl} alt={im.name} className="w-full h-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function Stub({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg p-5 text-center" style={{ background: C.card, border: `1px dashed ${C.borderLt}` }}>
      <Layers size={22} style={{ color: C.faint, margin: '0 auto 8px' }} />
      <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>{title}</div>
      <div className="text-[11px]" style={{ color: C.muted }}>{desc}</div>
      <div className="text-[10px] mt-3 px-2 py-1 rounded inline-block" style={{ background: C.elev, color: C.faint }}>port pending</div>
    </div>
  )
}

/* ---- Backup (import / export) shared row --------------------------------- */
function BackupRow({ onAfterImport, flash }: { onAfterImport: () => void; flash: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const doExport = async () => {
    try {
      const data = await exportBackup()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url; a.download = `gpm-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      flash('Backup exported')
    } catch { flash('Export failed') }
  }
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!window.confirm('Import will REPLACE your current Prompt Manager Pro library. Continue?')) return
    try {
      const r = await importBackup(parseBackup(await file.text()))
      onAfterImport()
      flash(`Imported ${r.promptFolders} folders · ${r.prompts} prompts · ${r.images} images`)
    } catch (err) { flash('Import failed: ' + (err instanceof Error ? err.message : 'bad file')) }
  }
  return (
    <div className="flex gap-2 mb-3">
      <button onClick={() => fileRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>
        <Upload size={12} />Import / Restore
      </button>
      <button onClick={doExport} className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>
        <Download size={12} />Export / Backup
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
    </div>
  )
}

/* ---- Prompts (folders + cards) ------------------------------------------- */
function PromptsPanel({
  ctl, onCopy, onInject, flash,
}: { ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void; flash: (m: string) => void }) {
  const [folders, setFolders] = useState<GpmPromptFolder[]>([])
  const [search, setSearch] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const reload = () => {
    void loadPromptFolders().then(setFolders)
    void loadAllPromptThumbs().then(setThumbs)
  }
  useEffect(reload, [])

  const persist = (next: GpmPromptFolder[]) => { setFolders(next); void savePromptFolders(next) }
  const addFolder = () => { const n = newFolder.trim(); if (!n) return; persist([{ id: gpmId(), name: n, prompts: [] }, ...folders]); setNewFolder('') }
  const commitRename = (id: string) => { const n = renameVal.trim(); if (n) persist(folders.map((f) => (f.id === id ? { ...f, name: n } : f))); setRenameId(null) }
  const deleteFolder = (id: string) => { if (window.confirm('Delete this folder and all its prompts?')) persist(folders.filter((f) => f.id !== id)) }
  const addPrompt = (fid: string) => { const p = { id: gpmId(), text: '' }; persist(folders.map((f) => (f.id === fid ? { ...f, prompts: [p, ...f.prompts] } : f))); setEditId(p.id); setDraft('') }
  const savePrompt = (fid: string, pid: string) => { persist(folders.map((f) => (f.id === fid ? { ...f, prompts: f.prompts.map((p) => (p.id === pid ? { ...p, text: draft } : p)) } : f))); setEditId(null); flash('Saved') }
  const deletePrompt = (fid: string, pid: string) => {
    persist(folders.map((f) => (f.id === fid ? { ...f, prompts: f.prompts.filter((p) => p.id !== pid) } : f)))
    if (thumbs[pid]) { void deletePromptThumb(pid); setThumbs((t) => { const n = { ...t }; delete n[pid]; return n }) }
  }

  const q = search.trim().toLowerCase()
  return (
    <div>
      <BackupRow onAfterImport={reload} flash={flash} />
      <SearchBar value={search} onChange={setSearch} placeholder="Search prompts…" />
      <div className="flex gap-2 my-3">
        <input
          value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFolder() }}
          placeholder="New folder name…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <button onClick={addFolder} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
          <FolderPlus size={13} />Add
        </button>
      </div>
      {folders.length === 0 && <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>No folders yet. Create one or Import a backup.</p>}
      {folders.map((f) => {
        const cards = f.prompts.filter((p) => !q || p.text.toLowerCase().includes(q))
        if (q && cards.length === 0) return null
        return (
          <Section
            key={f.id} id={`pf-${f.id}`} ctl={ctl} title={`${f.name} (${f.prompts.length})`}
            right={
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Plus size={13} style={{ color: C.blue, cursor: 'pointer' }} onClick={() => addPrompt(f.id)} />
                <Pencil size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => { setRenameId(f.id); setRenameVal(f.name) }} />
                <Trash2 size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => deleteFolder(f.id)} />
              </span>
            }
          >
            {renameId === f.id && (
              <div className="flex gap-2 mb-2">
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f.id) }} className="flex-1 rounded px-2 py-1 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
                <button onClick={() => commitRename(f.id)} className="rounded px-2 text-xs" style={{ background: C.blue, color: '#fff' }}>Save</button>
              </div>
            )}
            {cards.length === 0 && <p className="text-[11px]" style={{ color: C.faint }}>No prompts. Use + to add one.</p>}
            <div className="space-y-2">
              {cards.map((p) => (
                <div key={p.id} className="rounded-lg p-2" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
                  {editId === p.id ? (
                    <>
                      <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="w-full rounded px-2 py-1 text-[11px] outline-none resize-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }} />
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => savePrompt(f.id, p.id)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.blue, color: '#fff' }}>Save</button>
                        <button onClick={() => setEditId(null)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      {thumbs[p.id] && (
                        <img
                          src={thumbs[p.id]} alt="" loading="lazy"
                          className="w-full rounded mb-2 object-cover"
                          style={{ maxHeight: 120, border: `1px solid ${C.border}` }}
                        />
                      )}
                      <div className="text-[11px] leading-snug mb-2" style={{ color: C.text, maxHeight: 66, overflow: 'hidden' }}>
                        {p.text || <span style={{ color: C.faint }}>(empty)</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => onInject(p.text)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold" style={{ background: C.green, color: '#fff' }}><Send size={11} />Inject</button>
                        <button onClick={() => onCopy(p.text)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}><Copy size={11} />Copy</button>
                        <button onClick={() => { setEditId(p.id); setDraft(p.text) }} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Pencil size={11} />Edit</button>
                        <button onClick={() => deletePrompt(f.id, p.id)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Trash2 size={11} />Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

/* ---- Images (folders + reference library) -------------------------------- */
function ImagesPanel({ ctl, onCopy, onUse, flash }: { ctl: SectionCtl; onCopy: (t: string) => void; onUse: (img: GpmImage) => void; flash: (m: string) => void }) {
  const [folders, setFolders] = useState<GpmImageFolder[]>([])
  const [images, setImages] = useState<GpmImage[]>([])
  const [newFolder, setNewFolder] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const targetFolder = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reload = () => { void loadImageFolders().then(setFolders); void loadImages().then(setImages) }
  useEffect(reload, [])

  const addFolder = () => {
    const n = newFolder.trim(); if (!n) return
    const next = [{ id: gpmId(), name: n }, ...folders]; setFolders(next); void saveImageFolders(next); setNewFolder('')
  }
  const commitRename = (id: string) => {
    const n = renameVal.trim()
    if (n) { const next = folders.map((f) => (f.id === id ? { ...f, name: n } : f)); setFolders(next); void saveImageFolders(next) }
    setRenameId(null)
  }
  const deleteFolder = (id: string) => {
    if (!window.confirm('Delete this folder? Images inside are also removed.')) return
    const next = folders.filter((f) => f.id !== id); setFolders(next); void saveImageFolders(next)
    images.filter((im) => im.folderId === id).forEach((im) => void deleteImage(im.id))
    setImages(images.filter((im) => im.folderId !== id))
  }
  const pickFor = (folderId: string) => { targetFolder.current = folderId; fileRef.current?.click() }
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []); e.target.value = ''
    const folderId = targetFolder.current
    for (const file of files) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file)
      })
      const img: GpmImage = { id: gpmId(), name: file.name, folderId, dataUrl, addedAt: Date.now(), isVideo: file.type.startsWith('video') }
      await putImage(img); setImages((prev) => [img, ...prev])
    }
    if (files.length) flash(`Added ${files.length} item(s)`)
  }
  const removeImage = (id: string) => { void deleteImage(id); setImages(images.filter((im) => im.id !== id)) }

  const renderGrid = (items: GpmImage[]) => (
    <div className="grid grid-cols-3 gap-2">
      {items.map((im) => (
        <div
          key={im.id} className="rounded-md overflow-hidden relative group" style={{ border: `1px solid ${C.border}`, background: C.card }} title={im.name}
          draggable={!im.isVideo}
          onDragStart={(e) => {
            e.dataTransfer.setData(GPM_IMAGE_DND_TYPE, JSON.stringify({ name: im.name, dataUrl: im.dataUrl }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div style={{ aspectRatio: '1', background: '#000' }} className="flex items-center justify-center">
            {im.isVideo
              ? <Film size={20} style={{ color: C.amber }} />
              : <img src={im.dataUrl} alt={im.name} className="w-full h-full object-cover" draggable={false} />}
          </div>
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!im.isVideo && (
              <button onClick={() => onUse(im)} title="Send to Gen Space as input image" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: C.green, color: '#fff' }}><Send size={11} /></button>
            )}
            <button onClick={() => onCopy(im.name)} title="Copy filename" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Copy size={11} /></button>
            <button onClick={() => removeImage(im.id)} title="Delete" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Trash2 size={11} /></button>
          </div>
        </div>
      ))}
    </div>
  )

  const unassigned = images.filter((im) => !im.folderId || !folders.some((f) => f.id === im.folderId))
  return (
    <div>
      <BackupRow onAfterImport={reload} flash={flash} />
      <p className="text-[11px] mb-2" style={{ color: C.muted }}>Reference-image library organized in folders ({images.length} items).</p>
      <div className="flex gap-2 mb-3">
        <input
          value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFolder() }}
          placeholder="New image folder…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <button onClick={addFolder} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
          <FolderPlus size={13} />Add
        </button>
      </div>
      {folders.length === 0 && unassigned.length === 0 && (
        <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>No image folders yet. Create one or Import a backup.</p>
      )}
      {folders.map((f) => {
        const items = images.filter((im) => im.folderId === f.id)
        return (
          <Section
            key={f.id} id={`if-${f.id}`} ctl={ctl}
            title={<span className="flex items-center gap-1.5"><Folder size={12} style={{ color: C.muted }} />{f.name} ({items.length})</span>}
            right={
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Plus size={13} style={{ color: C.blue, cursor: 'pointer' }} onClick={() => pickFor(f.id)} />
                <Pencil size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => { setRenameId(f.id); setRenameVal(f.name) }} />
                <Trash2 size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => deleteFolder(f.id)} />
              </span>
            }
          >
            {renameId === f.id && (
              <div className="flex gap-2 mb-2">
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f.id) }} className="flex-1 rounded px-2 py-1 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
                <button onClick={() => commitRename(f.id)} className="rounded px-2 text-xs" style={{ background: C.blue, color: '#fff' }}>Save</button>
              </div>
            )}
            {items.length === 0
              ? <button onClick={() => pickFor(f.id)} className="w-full rounded-md py-3 text-[11px] flex items-center justify-center gap-1.5" style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}><ImageIcon size={14} />Add images</button>
              : renderGrid(items)}
          </Section>
        )
      })}
      {unassigned.length > 0 && (
        <Section id="if-unassigned" ctl={ctl} title={`Unassigned (${unassigned.length})`}>
          {renderGrid(unassigned)}
        </Section>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onFiles} />
    </div>
  )
}

/* ---- Dock ----------------------------------------------------------------- */
function Dock({ onClose }: { onClose: () => void }) {
  const { setGenSpacePromptInjection, setCurrentTab, setGenSpaceInputImagePath, clearGenSpacePrompt } = useProjects()

  const [gpmTab, setGpmTab] = useState<GpmTab>('performance')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600) }

  // Collapsible state shared across tabs + collapse-all.
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(true)
  const toggleAll = () => { setAllOpen((a) => !a); setSectionsOpen({}) }
  const ctl: SectionCtl = {
    isOpen: (id) => sectionsOpen[id] ?? allOpen,
    toggle: (id) => setSectionsOpen((s) => ({ ...s, [id]: !(s[id] ?? allOpen) })),
  }

  const [perf, setPerf] = useState<PerfState>({
    familyIndex: 0, intensity: 0.5, asymmetry: 0.25,
    dialogue: "I don't know how to do this without you.", delivery: 'natural',
  })
  const perfText = useMemo(() => assemblePerformance(perf).text, [perf])

  const [shot, setShot] = useState<ShotState>({
    rot: 35, tilt: -8, zoom: 9, preset: SHOT_PRESETS[1], anchors: { faces: true },
  })

  const [camCat, setCamCat] = useState<'All' | CameraCategory>('All')

  const [wf, setWf] = useState<WfState>({
    name: 'Untitled Workflow',
    slots: [
      { id: 's1', role: 'character', note: 'STORM', filled: true },
      { id: 's2', role: 'location', note: 'ruined town', filled: true },
      { id: 's3', role: 'general', note: '', filled: false },
    ],
    directive: 'STORM walks toward camera down the ruined main street, dust drifting.',
    aspectRatio: '16:9', motionHint: 'slow push-in',
    performance: { enabled: false },
  })

  const copyText = (txt: string) => { void navigator.clipboard?.writeText(txt); flash('Copied to clipboard') }
  const injectIntoPrompt = (txt: string) => {
    if (!txt.trim()) return
    setCurrentTab('gen-space')
    setGenSpacePromptInjection(txt)
    flash('Injected into prompt')
  }
  const sendImageToGenSpace = async (img: GpmImage) => {
    try {
      const path = await saveDataUrlToTempFile(img.dataUrl, img.name)
      setGenSpaceInputImagePath(path)
      setCurrentTab('gen-space')
      flash('Image sent to Gen Space')
    } catch (e) {
      flash('Send failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  const TABS: Array<[GpmTab, string]> = [
    ['prompts', 'Prompts'], ['images', 'Images'], ['camera', 'Camera'],
    ['shot', 'Shot Setup'], ['plates', 'Plates'], ['workflow', 'Workflow'],
  ]
  const ALL_TABS: Array<[GpmTab, string]> = [...TABS, ['performance', 'Performance Studio']]

  // Enlarge the active tab into a centered modal workspace (Esc to shrink).
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const activeLabel = ALL_TABS.find(([id]) => id === gpmTab)?.[1] ?? ''
  const activePanel = (
    <>
      {gpmTab === 'performance' && <PerformancePanel perf={perf} setPerf={setPerf} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} />}
      {gpmTab === 'shot' && <ShotPanel shot={shot} setShot={setShot} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} onUseImage={sendImageToGenSpace} flash={flash} />}
      {gpmTab === 'camera' && <CameraPanel search={search} setSearch={setSearch} camCat={camCat} setCamCat={setCamCat} onInject={injectIntoPrompt} flash={flash} />}
      {gpmTab === 'workflow' && <WorkflowPanel wf={wf} setWf={setWf} perfText={perfText} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} onUseImage={sendImageToGenSpace} flash={flash} />}
      {gpmTab === 'prompts' && <PromptsPanel ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} flash={flash} />}
      {gpmTab === 'images' && <ImagesPanel ctl={ctl} onCopy={copyText} onUse={sendImageToGenSpace} flash={flash} />}
      {gpmTab === 'plates' && <Stub title="Plates" desc="Panorama → plate workflow. Re-platforms onto the LTX canvas." />}
    </>
  )

  return (
    <div
      className="fixed top-0 right-0 z-[55] h-screen w-[396px] flex flex-col"
      style={{ background: C.panel, borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 24px rgba(0,0,0,0.4)' }}
    >
      {/* Side tab on the left edge (centered) to collapse the panel. */}
      <button
        onClick={onClose}
        title="Close Prompt Manager Pro"
        className="absolute top-1/2 -translate-y-1/2 -left-6 flex items-center justify-center"
        style={{ width: 24, height: 84, background: C.blue, color: '#fff', borderRadius: '8px 0 0 8px', boxShadow: '-3px 0 10px rgba(0,0,0,0.35)' }}
      >
        <ChevronRight size={18} />
      </button>

      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
          <Wand2 size={15} style={{ color: C.blue }} />Prompt Manager Pro
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { clearGenSpacePrompt(); flash('Prompt box cleared') }}
            title="Clear the LTX Gen Space prompt box"
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded"
            style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}
          >
            <Eraser size={12} />Clear
          </button>
          <button
            onClick={toggleAll} title="Collapse / expand all sections"
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded"
            style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}
          >
            {allOpen ? '⊟' : '⊞'}
          </button>
          <button
            onClick={() => setExpanded(true)} title="Enlarge panel (Esc to shrink)"
            className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}
          >
            <Maximize2 size={13} />
          </button>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-3 grid grid-cols-3 gap-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(([id, lbl]) => {
          const active = gpmTab === id
          return (
            <button
              key={id} onClick={() => setGpmTab(id)}
              className="rounded-md py-2 text-xs font-medium transition-colors"
              style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
            >
              {lbl}
            </button>
          )
        })}
        <button
          onClick={() => setGpmTab('performance')}
          className="col-span-3 rounded-md py-2 text-xs font-semibold transition-colors"
          style={{
            background: gpmTab === 'performance' ? C.blue : C.card,
            color: gpmTab === 'performance' ? '#fff' : C.text,
            border: `1px solid ${gpmTab === 'performance' ? C.blue : C.border}`,
          }}
        >
          Performance Studio
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activePanel}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-8"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setExpanded(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl overflow-hidden flex flex-col"
            style={{ maxHeight: '86vh', background: C.panel, border: `2px solid ${C.blue}`, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                <Wand2 size={15} style={{ color: C.blue }} />{activeLabel}
              </span>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
                style={{ background: C.blue, color: '#fff' }}
              >
                <Minimize2 size={13} />Shrink
              </button>
            </div>
            <div className="px-4 py-2 flex flex-wrap gap-1.5 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
              {ALL_TABS.map(([id, lbl]) => {
                const active = gpmTab === id
                return (
                  <button
                    key={id} onClick={() => setGpmTab(id)}
                    className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
                  >
                    {lbl}
                  </button>
                )
              })}
            </div>
            <div className="overflow-y-auto p-5">
              {activePanel}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="absolute left-1/2 bottom-4 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium"
          style={{ background: C.elev, border: `1px solid ${C.borderLt}`, color: C.text, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

/* ---- Self-mounting launcher ---------------------------------------------- */
export function PromptManagerPro() {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)} title="Open Prompt Manager Pro"
        className="fixed bottom-4 right-4 z-[55] flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold shadow-lg"
        style={{ background: C.blue, color: '#fff' }}
      >
        <Wand2 size={14} />Prompt Manager Pro
      </button>
    )
  }
  return <Dock onClose={() => setOpen(false)} />
}
