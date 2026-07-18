import { extractVideoFrameToFile } from '../export/ffmpeg-utils'
import { handle } from './typed-handle'

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
}
