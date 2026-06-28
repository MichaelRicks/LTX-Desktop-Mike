import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectContentEnd,
  selectIsPlaying,
  selectPlayingInOut,
  selectShuttleSpeed,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

const STATE_UPDATE_INTERVAL_MS = 250

export interface UsePlaybackEngineParams {
  playbackTimeRef: React.MutableRefObject<number>
}

export function usePlaybackEngine(params: UsePlaybackEngineParams) {
  const {
    playbackTimeRef,
  } = params
  const { setCurrentTime, setPlayingInOut, stopShuttle } = useEditorActions()
  const isPlaying = useEditorStore(selectIsPlaying)
  const shuttleSpeed = useEditorStore(selectShuttleSpeed)
  const playingInOut = useEditorStore(selectPlayingInOut)
  const inPoint = useEditorStore(selectActiveTimelineInPoint)
  const outPoint = useEditorStore(selectActiveTimelineOutPoint)
  const contentEnd = useEditorStore(selectContentEnd)

  const lastStateUpdateRef = useRef(0)
  const prevIsPlayingRef = useRef(isPlaying)

  // Flush transport time immediately when playback stops to avoid a one-frame
  // visual jump where paused UI reads stale currentTime before effect cleanup runs.
  useLayoutEffect(() => {
    const wasPlaying = prevIsPlayingRef.current
    prevIsPlayingRef.current = isPlaying
    if (wasPlaying && !isPlaying) {
      setCurrentTime(playbackTimeRef.current)
    }
  }, [isPlaying, playbackTimeRef, setCurrentTime])

  useEffect(() => {
    if (!isPlaying) return

    // If we're sitting at/past the active stop bound (OUT point or content
    // end) when Play is pressed, restart from the IN point (or 0) instead of
    // sitting motionless at the bound.
    if (!playingInOut) {
      const contentLimit = contentEnd > 0 ? contentEnd : 30
      const bound = outPoint !== null ? Math.min(outPoint, contentLimit) : contentLimit
      if (playbackTimeRef.current >= bound) {
        const restart = inPoint !== null ? inPoint : 0
        playbackTimeRef.current = restart
        setCurrentTime(restart)
      }
    }

    const effectiveSpeed = shuttleSpeed !== 0 ? shuttleSpeed : 1
    let lastTimestamp: number | null = null
    let animFrameId = 0

    lastStateUpdateRef.current = 0

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp
        lastStateUpdateRef.current = timestamp
      }

      const deltaMs = timestamp - lastTimestamp
      lastTimestamp = timestamp
      const deltaSec = (deltaMs / 1000) * effectiveSpeed

      let next = playbackTimeRef.current + deltaSec
      let stopped = false

      if (playingInOut && inPoint !== null && outPoint !== null) {
        const loopStart = Math.min(inPoint, outPoint)
        const loopEnd = Math.max(inPoint, outPoint)
        if (next >= loopEnd) next = loopStart
        else if (next <= loopStart) next = loopEnd
      } else {
        // Stop at the end of the last clip — don't keep running into the
        // padded-minimum ruler length, and don't rewind to 0 on reaching it.
        // If timeline in/out marks are set, ordinary playback is bounded by
        // them too (not just the dedicated "play in to out" loop button).
        const contentLimit = contentEnd > 0 ? contentEnd : 30
        const end = outPoint !== null ? Math.min(outPoint, contentLimit) : contentLimit
        if (next >= end) {
          next = end
          stopped = true
        } else if (next < 0) {
          next = 0
          stopped = true
        }
      }

      playbackTimeRef.current = next

      if (stopped) {
        stopShuttle()
        setCurrentTime(next)
        return
      }

      if (timestamp - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL_MS) {
        lastStateUpdateRef.current = timestamp
        setCurrentTime(next)
      }

      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
      setCurrentTime(playbackTimeRef.current)
    }
  }, [
    isPlaying,
    shuttleSpeed,
    playingInOut,
    inPoint,
    outPoint,
    contentEnd,
    playbackTimeRef,
    setCurrentTime,
    stopShuttle,
  ])

  useEffect(() => {
    if (!isPlaying && playingInOut) {
      setPlayingInOut(false)
    }
  }, [isPlaying, playingInOut, setPlayingInOut])
}
