import type { Project, Timeline } from '../../types/project-model'
import type { EditorModel, TimelineInOutRange } from './editor-state'
import { DEFAULT_TRACKS } from '../../types/project-model'
import { migrateClip, migrateTracks } from './video-editor-utils'

function normalizeTimeline(timeline: Timeline): Timeline {
  const sourceTracks = timeline.tracks.length > 0
    ? timeline.tracks
    : DEFAULT_TRACKS.map(track => ({ ...track }))

  return {
    ...timeline,
    tracks: migrateTracks(sourceTracks),
    clips: timeline.clips.map(migrateClip),
    subtitles: timeline.subtitles || [],
  }
}

export function getEditorModel(project: Project): EditorModel {
  const timelines = project.timelines.map(normalizeTimeline)
  return {
    assets: project.assets,
    bins: project.bins,
    timelines,
    activeTimelineId: project.activeTimelineId ?? timelines[0]?.id ?? null,
  }
}

export function updatedProject(
  fromProject: Project,
  editorModel: EditorModel,
  timelineInOutMap: Record<string, TimelineInOutRange> = {},
): Project {
  // The editor's asset list is a snapshot taken when it first mounted (or last
  // synced) — it doesn't know about assets added or deleted elsewhere since
  // then (e.g. a Gen Space generation completed, or an asset was deleted from
  // Gen Space, while the editor sat open in the background, kept alive by the
  // cross-tab "stay mounted" behavior). Merge in anything present on the live
  // project but missing from the editor's snapshot (externally added), and
  // drop anything in the editor's snapshot that's no longer on the live
  // project (externally deleted) — otherwise autosaving the editor's stale
  // snapshot would silently erase newer assets, or resurrect deleted ones.
  const editorAssetIds = new Set(editorModel.assets.map(asset => asset.id))
  const fromProjectAssetIds = new Set(fromProject.assets.map(asset => asset.id))
  const externallyAddedAssets = fromProject.assets.filter(asset => !editorAssetIds.has(asset.id))
  const survivingEditorAssets = editorModel.assets.filter(asset => fromProjectAssetIds.has(asset.id))

  // Same staleness risk applies to the bin/tag name map: Gen Space's tagging
  // UI can create folders while the editor sits mounted in the background, so
  // overwriting wholesale with the editor's snapshot would silently erase
  // those folder names. Union instead, with the editor's copy winning on a
  // shared id (it owns rename/delete for bins it created itself).
  const bins = { ...fromProject.bins, ...editorModel.bins }

  // In/out marks live in transient session state while editing (see
  // createInitialEditorState), not on editorModel.timelines — fold the
  // current values back onto each timeline so they persist with the project.
  const timelines = editorModel.timelines.map(timeline => ({
    ...timeline,
    inPoint: timelineInOutMap[timeline.id]?.inPoint ?? null,
    outPoint: timelineInOutMap[timeline.id]?.outPoint ?? null,
  }))

  return {
    ...fromProject,
    assets: [...externallyAddedAssets, ...survivingEditorAssets],
    bins,
    timelines,
    activeTimelineId: editorModel.activeTimelineId ?? editorModel.timelines[0]?.id,
    updatedAt: Date.now(),
  }
}
