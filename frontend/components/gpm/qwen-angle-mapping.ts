/* Camera-pose vocabulary for the fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA,
   ported from the standalone app's angle_mapping.py. Kept in lockstep with
   that file — this is a client-side mirror for live UI preview only; the
   backend remains the source of truth for what actually gets sent to the
   model once generation is wired up.

   Degrees are viewer-relative screen space (0 = front, 90 = viewer's right).
   Phrases are the LoRA's own vocabulary, which is ALSO viewer-relative —
   verified empirically 2026-07-10 (see reference/ in the standalone repo).
   No mirroring anywhere in this stack. */

export const TRIGGER = '<sks>'

export interface AzimuthBucket { deg: number; phrase: string; label: string }
export interface ElevationBucket { deg: number; phrase: string }
export interface DistanceBucket { zoom: number; phrase: string }

export const AZIMUTH_BUCKETS: AzimuthBucket[] = [
  { deg: 0, phrase: 'front view', label: 'front' },
  { deg: 45, phrase: 'front-right quarter view', label: 'front-right' },
  { deg: 90, phrase: 'right side view', label: 'right side' },
  { deg: 135, phrase: 'back-right quarter view', label: 'back-right' },
  { deg: 180, phrase: 'back view', label: 'back' },
  { deg: 225, phrase: 'back-left quarter view', label: 'back-left' },
  { deg: 270, phrase: 'left side view', label: 'left side' },
  { deg: 315, phrase: 'front-left quarter view', label: 'front-left' },
]

export const ELEVATION_BUCKETS: ElevationBucket[] = [
  { deg: -30, phrase: 'low-angle shot' },
  { deg: 0, phrase: 'eye-level shot' },
  { deg: 30, phrase: 'elevated shot' },
  { deg: 60, phrase: 'high-angle shot' },
]

export const DISTANCE_BUCKETS: DistanceBucket[] = [
  { zoom: 0.6, phrase: 'close-up' },
  { zoom: 1.0, phrase: 'medium shot' },
  { zoom: 1.8, phrase: 'wide shot' },
]

export function snapAzimuth(azimuthDeg: number): number {
  const norm = ((azimuthDeg % 360) + 360) % 360
  return Math.round(norm / 45) % AZIMUTH_BUCKETS.length
}

export function snapElevation(elevationDeg: number): number {
  let best = 0
  let bestDist = Infinity
  ELEVATION_BUCKETS.forEach((b, i) => {
    const d = Math.abs(b.deg - elevationDeg)
    if (d < bestDist) { bestDist = d; best = i }
  })
  return best
}

export function snapDistance(zoom: number): number {
  // Snap in log space so the perceptual midpoints fall correctly.
  const z = Math.log(Math.max(zoom, 1e-6))
  let best = 0
  let bestDist = Infinity
  DISTANCE_BUCKETS.forEach((b, i) => {
    const d = Math.abs(Math.log(b.zoom) - z)
    if (d < bestDist) { bestDist = d; best = i }
  })
  return best
}

export interface SnappedPose {
  azimuthIndex: number
  elevationIndex: number
  distanceIndex: number
}

export function snapPose(azimuthDeg: number, elevationDeg: number, zoom: number): SnappedPose {
  return {
    azimuthIndex: snapAzimuth(azimuthDeg),
    elevationIndex: snapElevation(elevationDeg),
    distanceIndex: snapDistance(zoom),
  }
}

export function poseToPrompt(pose: SnappedPose): string {
  return `${TRIGGER} ${AZIMUTH_BUCKETS[pose.azimuthIndex].phrase} ${ELEVATION_BUCKETS[pose.elevationIndex].phrase} ${DISTANCE_BUCKETS[pose.distanceIndex].phrase}`
}
