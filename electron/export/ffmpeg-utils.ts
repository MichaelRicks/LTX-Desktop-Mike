import { spawn, spawnSync, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from '../config'
import { logger } from '../logger'
import { getPythonDir } from '../python-setup'

let activeExportProcess: ChildProcess | null = null

export function findFfmpegPath(): string | null {
  let binDir: string | null = null

  if (process.platform === 'win32') {
    const imageioRelPath = path.join('Lib', 'site-packages', 'imageio_ffmpeg', 'binaries')
    binDir = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv', imageioRelPath)
      : path.join(getPythonDir(), imageioRelPath)
  } else {
    // macOS/Linux: find lib/python3.X/site-packages dynamically
    const venvBase = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv')
      : getPythonDir()
    const libDir = path.join(venvBase, 'lib')
    if (fs.existsSync(libDir)) {
      const pythonDir = fs.readdirSync(libDir).find(e => e.startsWith('python3'))
      if (pythonDir) {
        binDir = path.join(libDir, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries')
      }
    }
  }

  if (binDir && fs.existsSync(binDir)) {
    const bin = fs.readdirSync(binDir).find(f => f.startsWith('ffmpeg'))
    if (bin) return path.join(binDir, bin)
  }

  return null
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const output = (result.stdout || '') + (result.stderr || '')
    return output.includes('Audio:')
  } catch {
    return false
  }
}


/** Run an ffmpeg command and return a promise. Logs stderr and sets activeExportProcess. */
export function runFfmpeg(ffmpegPath: string, args: string[]): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info( `[ffmpeg] spawn: ${args.join(' ').slice(0, 400)}`)
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    activeExportProcess = proc
    let stderrLog = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text
      const lines = text.trim().split('\n')
      for (const line of lines) {
        if (line.includes('frame=') || line.includes('Error') || line.includes('error')) {
          logger.info( `[ffmpeg] ${line.trim().slice(0, 200)}`)
        }
      }
    })
    proc.on('close', (code) => {
      activeExportProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        logger.error( `[ffmpeg] exited ${code}:\n${errLines}`)
        resolve({ success: false, error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}` })
      }
    })
    proc.on('error', (err) => {
      activeExportProcess = null
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}` })
    })
  })
}

function runFfmpegSyncOrThrow(ffmpegPath: string, args: string[], timeoutMs = 30000): void {
  logger.info(`[ffmpeg-sync] spawn: ${args.join(' ').slice(0, 400)}`)
  const result = spawnSync(ffmpegPath, args, { timeout: timeoutMs })
  if (result.status === 0) return
  const stderr = (result.stderr?.toString() || '').split('\n').filter(Boolean).slice(-5).join('\n')
  throw new Error(`FFmpeg failed (code ${result.status}): ${stderr.slice(0, 300)}`)
}

export function extractVideoFrameToFile({
  videoPath,
  seekTime,
  width,
  quality,
  outputPath,
  accurate = false,
  timeoutMs = 10000,
}: {
  videoPath: string
  seekTime: number
  width?: number
  quality?: number
  outputPath?: string
  /**
   * When true, seek *after* -i (frame-accurate but slower, decodes from 0 to
   * seekTime). Default false uses the fast keyframe seek before -i, which is
   * fine for thumbnails but can land a few frames off — not acceptable when the
   * user is saving the exact frame they paused on.
   */
  accurate?: boolean
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const resolvedOutputPath = outputPath
    ?? path.join(
      os.tmpdir(),
      `ltx_frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
    )

  const seekArgs = ['-ss', String(Math.max(0, seekTime))]
  const args: string[] = [
    ...(accurate ? ['-i', videoPath, ...seekArgs] : [...seekArgs, '-i', videoPath]),
    ...(width ? ['-vf', `scale=${width}:-2`] : []),
    '-frames:v', '1',
    ...(quality !== undefined ? ['-q:v', String(quality)] : []),
    '-y',
    resolvedOutputPath,
  ]

  logger.info(`[extract-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)

  if (!fs.existsSync(resolvedOutputPath)) {
    throw new Error('ffmpeg produced no output file')
  }

  return resolvedOutputPath
}

export function getVideoDimensions(videoPath: string): { width: number; height: number } {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', videoPath], {
    encoding: 'utf8',
    timeout: 10000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const videoStreamLine = output.split('\n').find(line => line.includes('Video:'))
  const match = videoStreamLine?.match(/(\d{2,5})x(\d{2,5})(?:[,\s\[]|$)/)

  if (!match) {
    throw new Error(`Could not determine video dimensions for ${videoPath}`)
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid video dimensions for ${videoPath}: ${match[1]}x${match[2]}`)
  }

  return { width, height }
}

/** Parse the video stream's fps from ffmpeg -i output; falls back to 24. */
export function getVideoFps(ffmpegPath: string, videoPath: string): number {
  try {
    const result = spawnSync(ffmpegPath, ['-i', videoPath, '-hide_banner'], { encoding: 'utf8', timeout: 5000 })
    const output = (result.stdout || '') + (result.stderr || '')
    const m = output.match(/(\d+(?:\.\d+)?)\s*fps/)
    const fps = m ? Number(m[1]) : NaN
    return Number.isFinite(fps) && fps > 0 ? fps : 24
  } catch {
    return 24
  }
}

/**
 * Extract the final frame of a video to a full-resolution PNG. Reads only the
 * last second (`-sseof -1`) and reverses it so `-frames:v 1` yields the true
 * last frame — robust across variable frame counts, no fps math needed.
 */
export function extractLastFrameToFile({ videoPath, outputPath, timeoutMs = 15000 }: {
  videoPath: string
  outputPath: string
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`)

  const args = ['-sseof', '-1', '-i', videoPath, '-vf', 'reverse', '-frames:v', '1', '-y', outputPath]
  logger.info(`[extract-last-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output file')
  return outputPath
}

/**
 * Average RGB of one frame, via a true box-average downscale to 1x1 read as raw
 * rgb24 (3 bytes). `vf` selects/prepares the frame(s) before the scale (e.g.
 * "trim=start_frame=1:end_frame=2" to grab a video's second frame). Returns null
 * if ffmpeg produces nothing usable — callers must treat that as "skip matching".
 */
function averageRgb(ffmpegPath: string, inputPath: string, vf: string): [number, number, number] | null {
  const result = spawnSync(
    ffmpegPath,
    ['-v', 'error', '-i', inputPath, '-vf', `${vf},scale=1:1:flags=area`, '-frames:v', '1',
     '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1024 * 1024, timeout: 15000 },
  )
  const buf = result.stdout
  if (!buf || buf.length < 3) return null
  return [buf[0], buf[1], buf[2]]
}

// Cap per-channel correction: the systematic VAE darkening is ~2-3/255, so a
// larger measured delta means the continuation legitimately changed grade (a
// light turned on, the camera moved to a brighter area) -- clamp so the match
// only cancels the bias and never fights real content.
const _MAX_COLOR_MATCH_OFFSET = 8

/**
 * Per-channel additive offset (as an ffmpeg lutrgb filter fragment) that nudges the
 * continuation's grade back to the source's, or null when no meaningful correction
 * applies. `referencePath` is the seed frame (the source clip's last frame); the
 * clip's second frame (index 1 -- the one that becomes the new lead after the trim)
 * is what we match, since it is the boundary the viewer sees against the source.
 */
function colorMatchLutFilter(ffmpegPath: string, videoPath: string, referencePath: string): string | null {
  const seed = averageRgb(ffmpegPath, referencePath, 'null')
  const clip = averageRgb(ffmpegPath, videoPath, 'trim=start_frame=1:end_frame=2,setpts=PTS-STARTPTS')
  if (!seed || !clip) return null
  const clamp = (v: number) => Math.max(-_MAX_COLOR_MATCH_OFFSET, Math.min(_MAX_COLOR_MATCH_OFFSET, v))
  const [dr, dg, db] = [clamp(seed[0] - clip[0]), clamp(seed[1] - clip[1]), clamp(seed[2] - clip[2])]
  // Sub-level offsets are below what encode rounding would preserve -- skip the
  // extra filter pass rather than apply a no-op.
  if (Math.abs(dr) < 0.5 && Math.abs(dg) < 0.5 && Math.abs(db) < 0.5) return null
  const r = dr.toFixed(1), g = dg.toFixed(1), b = db.toFixed(1)
  logger.info(`[trim-first-frame] color-match offset r=${r} g=${g} b=${b} (seed=${seed} clip1=${clip})`)
  // lutrgb clamps expression output to [0,255] itself, so no explicit clip() needed.
  return `lutrgb=r=val+(${r}):g=val+(${g}):b=val+(${b})`
}

/**
 * Re-encode a video with its first frame removed (and the matching audio slice
 * dropped so A/V stays in sync). Used by "Continue as new shot" to delete the
 * duplicate lead frame the i2v conditioning reproduces from the source's last
 * frame, so the continuation butt-joins the source with no stutter.
 *
 * `colorMatchReferencePath` (the seed frame) enables a subtle per-channel grade
 * match: the i2v VAE reproduces the conditioning frame ~2-3/255 darker, which
 * compounds across chained continuations; matching the clip's lead frame back to
 * the seed cancels that at the join. Measured/clamped, so it only removes the
 * systematic bias.
 */
export function trimFirstFrameToFile({ videoPath, outputPath, colorMatchReferencePath, timeoutMs = 120000 }: {
  videoPath: string
  outputPath: string
  colorMatchReferencePath?: string
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`)

  const hasAudio = fileHasAudio(ffmpegPath, videoPath)
  const fps = getVideoFps(ffmpegPath, videoPath)
  const colorMatchLut =
    colorMatchReferencePath && fs.existsSync(colorMatchReferencePath)
      ? colorMatchLutFilter(ffmpegPath, videoPath, colorMatchReferencePath)
      : null
  const videoFilter = ['trim=start_frame=1', 'setpts=PTS-STARTPTS', ...(colorMatchLut ? [colorMatchLut] : [])].join(',')
  const args: string[] = [
    '-i', videoPath,
    '-vf', videoFilter,
    ...(hasAudio
      ? ['-af', `atrim=start=${(1 / fps).toFixed(6)},asetpts=PTS-STARTPTS`, '-c:a', 'aac', '-b:a', '192k']
      : ['-an']),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-y', outputPath,
  ]
  logger.info(`[trim-first-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output file')
  return outputPath
}

export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info( 'Stopping active export process...')
    activeExportProcess.kill()
    activeExportProcess = null
  }
}
