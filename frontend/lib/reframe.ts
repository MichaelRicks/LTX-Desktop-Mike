import type { TimelineClip } from '../types/project-model'

// 9:16 "reframe" position math shared by the Reframe editor (Create lightbox) and
// the Video Editor's vertical guide. Mirrors electron/export/keyframe-expr.ts so
// the preview moves exactly like the exported crop.

export interface ReframePosKey { t: number; pos: number }

/** Two keys closer than this (seconds) are treated as the same key. */
export const REFRAME_KEY_EPSILON = 1 / 48

const smoothstep = (s: number) => s * s * (3 - 2 * s)

/** Position at time t: holds the end keys, eases between neighbours. */
export function interpolateReframe(keys: ReframePosKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].pos
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.pos
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < b.t) return a.pos + (b.pos - a.pos) * smoothstep((t - a.t) / (b.t - a.t))
  }
  return last.pos
}

/** Insert or replace the key at time t, keeping keys sorted. */
export function upsertReframeKey(keys: ReframePosKey[], t: number, pos: number): ReframePosKey[] {
  const next = keys.filter(k => Math.abs(k.t - t) >= REFRAME_KEY_EPSILON)
  next.push({ t, pos })
  return next.sort((a, b) => a.t - b.t)
}

/**
 * The clock a clip's reframe keys live on: SOURCE seconds for video (so trimming
 * the clip doesn't slide its keys), clip-local seconds for images.
 */
export function reframeKeyTime(clip: TimelineClip, timelineTime: number): number {
  const local = Math.max(0, Math.min(clip.duration, timelineTime - clip.startTime))
  return clip.type === 'video' ? clip.trimStart + local * (clip.speed || 1) : local
}

/** The clip's 9:16 window position (0..1) at a timeline time. Unset = centered. */
export function reframePosAt(clip: TimelineClip, timelineTime: number): number {
  const rf = clip.reframe
  if (!rf) return 0.5
  if (rf.keys && rf.keys.length > 0) {
    if (rf.keys.length === 1 || clip.reversed) return rf.keys[0].pos
    return interpolateReframe(rf.keys, reframeKeyTime(clip, timelineTime))
  }
  return rf.pos
}
