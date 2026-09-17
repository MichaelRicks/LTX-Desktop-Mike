import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'
import { fileHasAudio } from './ffmpeg-utils'
import type { ExportClip } from './timeline'

const SAMPLE_RATE = 48000
const NUM_CHANNELS = 2
const BYTES_PER_SAMPLE = 2 // 16-bit signed LE
const BYTES_PER_FRAME = NUM_CHANNELS * BYTES_PER_SAMPLE // 4 bytes per stereo frame

/** Extract raw PCM from a file via ffmpeg stdout pipe */
function extractPcmBuffer(
  ffmpegPath: string,
  filePath: string, trimStart: number, trimEnd: number, speed: number, reversed: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Build audio filter chain: trim -> reset PTS -> speed -> reverse
    // Using atrim (not -ss/-t) for sample-accurate trimming
    const filters: string[] = [
      `atrim=start=${trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
    ]
    if (speed !== 1) {
      // atempo only supports 0.5-100, chain multiple for extreme values
      let remaining = speed
      while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0 }
      while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5 }
      filters.push(`atempo=${remaining.toFixed(6)}`)
    }
    if (reversed) filters.push('areverse')

    const args = [
      '-i', filePath,
      '-af', filters.join(','),
      '-f', 's16le', '-ac', String(NUM_CHANNELS), '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ]
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr?.on('data', () => {}) // drain stderr to prevent blocking
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`PCM extraction failed (code ${code}) for ${filePath}`))
    })
    proc.on('error', reject)
  })
}

interface AudioSource {
  filePath: string; trimStart: number; trimEnd: number;
  timelineStart: number; speed: number; reversed: boolean; volume: number;
  audioFadeIn: number; audioFadeOut: number;
  volumeKeyframes?: { t: number; value: number }[];
}

/** Sample a pre-sorted piecewise-linear volume envelope at time `t` (seconds
 *  from clip start); clamps to the first/last keyframe outside the range. */
function sampleVolumeEnvelope(ks: { t: number; value: number }[], t: number): number {
  if (t <= ks[0].t) return ks[0].value
  const last = ks[ks.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      return span <= 0 ? b.value : a.value + (b.value - a.value) * ((t - a.t) / span)
    }
  }
  return last.value
}

/**
 * Mix all audio from clips into a single PCM buffer.
 * Returns raw Int16LE PCM data with the sample rate and channel count.
 */
export async function mixAudioToPcm(
  clips: ExportClip[],
  totalDuration: number,
  ffmpegPath: string,
): Promise<{ pcmBuffer: Buffer; sampleRate: number; channels: number }> {
  // Collect audio sources from ORIGINAL clips
  const audioProbeCache = new Map<string, boolean>()
  const audioSources: AudioSource[] = []

  for (const c of clips) {
    const hasKeyframes = !!(c.volumeKeyframes && c.volumeKeyframes.length > 0)
    // A keyframed clip can be audible even if its flat volume is 0.
    if (c.muted || (c.volume <= 0 && !hasKeyframes)) continue
    const fp = c.path
    if (!fp || !fs.existsSync(fp)) continue

    if (c.type === 'audio') {
      audioSources.push({
        filePath: fp,
        trimStart: c.trimStart,
        trimEnd: c.trimStart + c.duration * c.speed,
        timelineStart: c.startTime,
        speed: c.speed,
        reversed: c.reversed,
        volume: c.volume,
        audioFadeIn: c.audioFadeIn ?? 0,
        audioFadeOut: c.audioFadeOut ?? 0,
        volumeKeyframes: c.volumeKeyframes,
      })
    } else if (c.type === 'video') {
      if (!audioProbeCache.has(fp)) {
        audioProbeCache.set(fp, fileHasAudio(ffmpegPath, fp))
      }
      if (!audioProbeCache.get(fp)) continue
      audioSources.push({
        filePath: fp,
        trimStart: c.trimStart,
        trimEnd: c.trimStart + c.duration * c.speed,
        timelineStart: c.startTime,
        speed: c.speed,
        reversed: c.reversed,
        volume: c.volume,
        audioFadeIn: c.audioFadeIn ?? 0,
        audioFadeOut: c.audioFadeOut ?? 0,
        volumeKeyframes: c.volumeKeyframes,
      })
    }
  }

  logger.info( `[Export] Audio: ${audioSources.length} source(s) from ${clips.length} clip(s)`)

  // Create master mix buffer (Float64 to accumulate without clipping)
  const totalFrames = Math.ceil(totalDuration * SAMPLE_RATE)
  const totalSamples = totalFrames * NUM_CHANNELS
  const mixBuffer = new Float64Array(totalSamples) // initialized to 0 (silence)

  // Extract each source and mix into the master buffer
  for (let i = 0; i < audioSources.length; i++) {
    const src = audioSources[i]
    logger.info( `[Export] Audio ${i + 1}/${audioSources.length}: ${path.basename(src.filePath)} trim=${src.trimStart.toFixed(2)}-${src.trimEnd.toFixed(2)} @${src.timelineStart.toFixed(2)}s vol=${src.volume}`)
    try {
      const pcm = await extractPcmBuffer(ffmpegPath, src.filePath, src.trimStart, src.trimEnd, src.speed, src.reversed)
      const startFrame = Math.round(src.timelineStart * SAMPLE_RATE)
      const startSample = startFrame * NUM_CHANNELS
      const numPcmSamples = Math.floor(pcm.length / BYTES_PER_SAMPLE)

      // Linear fade in/out envelope, in frames (a frame = NUM_CHANNELS samples).
      const clipFrames = Math.floor(numPcmSamples / NUM_CHANNELS)
      const fadeInFrames = Math.max(0, Math.round((src.audioFadeIn || 0) * SAMPLE_RATE))
      const fadeOutFrames = Math.max(0, Math.round((src.audioFadeOut || 0) * SAMPLE_RATE))
      const hasFade = fadeInFrames > 0 || fadeOutFrames > 0

      // Volume automation envelope (pre-sorted once); sampled per frame below.
      const kfs = (src.volumeKeyframes && src.volumeKeyframes.length > 0)
        ? [...src.volumeKeyframes].sort((a, b) => a.t - b.t)
        : null
      let baseGain = src.volume

      for (let s = 0; s < numPcmSamples; s++) {
        const destIdx = startSample + s
        if (destIdx < 0 || destIdx >= totalSamples) continue
        const frame = (s / NUM_CHANNELS) | 0
        // Recompute the automated base gain once per stereo frame (channel 0).
        if (kfs && (s % NUM_CHANNELS) === 0) {
          baseGain = sampleVolumeEnvelope(kfs, frame / SAMPLE_RATE)
        }
        const value = pcm.readInt16LE(s * BYTES_PER_SAMPLE)
        let gain = kfs ? baseGain : src.volume
        if (hasFade) {
          if (fadeInFrames > 0 && frame < fadeInFrames) {
            gain *= frame / fadeInFrames
          }
          if (fadeOutFrames > 0 && frame >= clipFrames - fadeOutFrames) {
            gain *= Math.max(0, (clipFrames - frame) / fadeOutFrames)
          }
        }
        mixBuffer[destIdx] += value * gain
      }
      logger.info( `[Export] Audio ${i + 1}: mixed ${numPcmSamples} samples (${(numPcmSamples / SAMPLE_RATE / NUM_CHANNELS).toFixed(2)}s) at offset frame ${startFrame}`)
    } catch (err: any) {
      logger.warn( `[Export] Failed to extract audio from ${src.filePath}: ${err.message}`)
    }
  }

  // Convert Float64 accumulator -> Int16 PCM buffer (with clamp)
  const outputPcm = Buffer.alloc(totalFrames * BYTES_PER_FRAME)
  for (let s = 0; s < totalSamples; s++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(mixBuffer[s])))
    outputPcm.writeInt16LE(clamped, s * BYTES_PER_SAMPLE)
  }

  return { pcmBuffer: outputPcm, sampleRate: SAMPLE_RATE, channels: NUM_CHANNELS }
}
