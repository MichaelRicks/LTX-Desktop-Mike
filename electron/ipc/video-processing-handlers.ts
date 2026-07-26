import path from 'path'
import {
  extractVideoFrameToFile,
  extractLastFrameToFile,
  trimFirstFrameToFile,
  getVideoDimensions,
  getVideoFps,
  findFfmpegPath,
} from '../export/ffmpeg-utils'
import { ensureLibFolder } from './library-handlers'
import { handle } from './typed-handle'

const CONTINUATIONS_FOLDER = 'Continuations'

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function registerVideoProcessingHandlers(): void {
  handle('extractVideoFrame', async ({ videoPath, seekTime, width, quality, outputPath }) => {
    return {
      path: extractVideoFrameToFile({
        videoPath,
        seekTime,
        width,
        // When writing to a user-chosen file (Save frame), don't apply the
        // thumbnail JPEG quality knob — ffmpeg infers the format (e.g. PNG)
        // from the outputPath extension and -q:v would be meaningless.
        quality: outputPath ? undefined : quality ?? 2,
        outputPath,
        // A user-chosen outputPath means "Save frame" — grab the exact frame.
        accurate: Boolean(outputPath),
        timeoutMs: 10000,
      }),
    }
  })

  // "Continue as new shot" — extract the clip's last frame into Continuations to
  // seed an i2v continuation, and report the source dims/fps so the next gen matches.
  handle('continuationExtractLastFrame', async ({ videoPath, seekTime }) => {
    const dir = ensureLibFolder(CONTINUATIONS_FOLDER)
    const framePath = path.join(dir, `continuation_frame_${stamp()}.png`)
    if (seekTime != null) {
      // Scrubbed "Continue from this frame": grab the exact frame (accurate seek).
      extractVideoFrameToFile({ videoPath, seekTime, outputPath: framePath, accurate: true, timeoutMs: 15000 })
    } else {
      extractLastFrameToFile({ videoPath, outputPath: framePath })
    }
    const { width, height } = getVideoDimensions(videoPath)
    const ffmpegPath = findFfmpegPath()
    const fps = ffmpegPath ? getVideoFps(ffmpegPath, videoPath) : 24
    return { framePath, width, height, fps }
  })

  // Drop the duplicate lead frame from a freshly generated continuation and save
  // the clean clip into Continuations.
  handle('continuationSaveTrimmed', async ({ videoPath }) => {
    const dir = ensureLibFolder(CONTINUATIONS_FOLDER)
    const outPath = path.join(dir, `continuation_${stamp()}.mp4`)
    trimFirstFrameToFile({ videoPath, outputPath: outPath })
    return { path: outPath }
  })
}
