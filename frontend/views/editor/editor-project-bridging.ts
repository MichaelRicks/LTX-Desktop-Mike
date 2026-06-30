import type { Project, Timeline } from '../../types/project-model'
import type { EditorModel } from './editor-state'
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

export function updatedProject(fromProject: Project, editorModel: EditorModel): Project {
  // The editor's asset list is a snapshot taken when it first mounted (or last
  // synced) — it doesn't know about assets added elsewhere since then (e.g. a
  // Gen Space generation completed while the editor sat open in the background,
  // kept alive by the cross-tab "stay mounted" behavior). Autosaving the editor's
  // stale snapshot as-is would silently erase those newer assets from the
  // project, so merge in anything present on the live project but missing from
  // the editor's snapshot rather than overwriting wholesale.
  const editorAssetIds = new Set(editorModel.assets.map(asset => asset.id))
  const externallyAddedAssets = fromProject.assets.filter(asset => !editorAssetIds.has(asset.id))

  // Same staleness risk applies to the bin/tag name map: Gen Space's tagging
  // UI can create folders while the editor sits mounted in the background, so
  // overwriting wholesale with the editor's snapshot would silently erase
  // those folder names. Union instead, with the editor's copy winning on a
  // shared id (it owns rename/delete for bins it created itself).
  const bins = { ...fromProject.bins, ...editorModel.bins }

  return {
    ...fromProject,
    assets: [...externallyAddedAssets, ...editorModel.assets],
    bins,
    timelines: editorModel.timelines,
    activeTimelineId: editorModel.activeTimelineId ?? editorModel.timelines[0]?.id,
    updatedAt: Date.now(),
  }
}
