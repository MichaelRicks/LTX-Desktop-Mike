import type { components } from '../generated/backend-openapi'

export type VideoGenerationModelSpecsResponse = components['schemas']['GenerateVideoModelsSpecsResponse']
export type VideoGenerationModelSpecItem = components['schemas']['LTXVideoGenerationModelSpecItem']
export type VideoGenerationResolutionSpec = components['schemas']['LTXVideoGenerationResolutionSpec']
export type VideoGenerationPipeline = components['schemas']['GenerateVideoRequest']['model']
export type VideoGenerationResolution = components['schemas']['GenerateVideoRequest']['resolution']
export type VideoGenerationDuration = components['schemas']['GenerateVideoRequest']['duration']
export type VideoGenerationFps = components['schemas']['GenerateVideoRequest']['fps']
export type VideoGenerationAspectRatio = components['schemas']['GenerateVideoRequest']['aspectRatio']

export interface VideoGenerationSettingsShape {
  model: string
  duration: number
  videoResolution: string
  fps: number
  aspectRatio?: string
  audio?: boolean
}

export interface ResolvedVideoGenerationOptions {
  modelOptions: VideoGenerationModelSpecItem[]
  resolutionOptions: VideoGenerationResolution[]
  fpsOptions: VideoGenerationFps[]
  durationOptions: VideoGenerationDuration[]
  selectedModel: VideoGenerationPipeline | null
  selectedResolution: VideoGenerationResolution | null
  selectedFps: VideoGenerationFps | null
  selectedDuration: VideoGenerationDuration | null
  hasCompatibleOptions: boolean
}

type DurationSelectionMode = 'preserve' | 'smallest_valid'

interface ResolveVideoGenerationOptionsParams<T extends VideoGenerationSettingsShape> {
  settings: T
  modelSpecs: VideoGenerationModelSpecItem[]
  hasAudio?: boolean
  minimumDuration?: number
  durationSelection?: DurationSelectionMode
}

function getResolutionMap(
  item: VideoGenerationModelSpecItem,
  options: { hasAudio: boolean },
): Record<string, VideoGenerationResolutionSpec> {
  const { hasAudio } = options
  if (hasAudio && item.spec.a2v_supported_resolutions_durations) {
    return item.spec.a2v_supported_resolutions_durations
  }
  return item.spec.supported_resolutions_durations
}

function getResolutionEntries(
  item: VideoGenerationModelSpecItem,
  options: { hasAudio: boolean },
): Array<[VideoGenerationResolution, VideoGenerationResolutionSpec]> {
  return Object.entries(getResolutionMap(item, options)).map(([resolution, spec]) => [
    resolution as VideoGenerationResolution,
    spec,
  ])
}

function getDurationsForFps(
  resolutionSpec: VideoGenerationResolutionSpec,
  fps: VideoGenerationFps,
): VideoGenerationDuration[] {
  return (resolutionSpec.fps_to_durations[String(fps)] ?? []) as VideoGenerationDuration[]
}

function filterDurationsByMinimum(
  durations: VideoGenerationDuration[],
  minimumDuration: number | undefined,
): VideoGenerationDuration[] {
  if (minimumDuration === undefined) return durations
  return durations.filter((duration) => duration >= minimumDuration)
}

function getCompatibleFps(
  resolutionSpec: VideoGenerationResolutionSpec,
  options: { minimumDuration: number | undefined },
): VideoGenerationFps[] {
  const { minimumDuration } = options
  return Object.keys(resolutionSpec.fps_to_durations).map((fps) => Number(fps) as VideoGenerationFps).filter((fps) => (
    filterDurationsByMinimum(getDurationsForFps(resolutionSpec, fps), minimumDuration).length > 0
  ))
}

function getCompatibleResolutionEntries(
  item: VideoGenerationModelSpecItem,
  options: { hasAudio: boolean; minimumDuration: number | undefined },
): Array<[VideoGenerationResolution, VideoGenerationResolutionSpec]> {
  return getResolutionEntries(item, { hasAudio: options.hasAudio }).filter(([, resolutionSpec]) => (
    getCompatibleFps(resolutionSpec, { minimumDuration: options.minimumDuration }).length > 0
  ))
}

function getCompatibleModelOptions(
  modelSpecs: VideoGenerationModelSpecItem[],
  options: { hasAudio: boolean; minimumDuration: number | undefined },
): VideoGenerationModelSpecItem[] {
  const { hasAudio, minimumDuration } = options
  if (minimumDuration === undefined) return modelSpecs
  return modelSpecs.filter((item) => (
    getCompatibleResolutionEntries(item, { hasAudio, minimumDuration }).length > 0
  ))
}

function chooseOption<T>(current: string | number, options: T[]): T | null {
  return options.find((option) => option === current) ?? options[0] ?? null
}

export function getVideoGenerationModelSpecs(
  specs: VideoGenerationModelSpecsResponse | null | undefined,
  options: { useApiSpecs: boolean },
): VideoGenerationModelSpecItem[] {
  const { useApiSpecs } = options
  if (!specs) return []
  return useApiSpecs ? specs.api_models : specs.local_models
}

export function resolveVideoGenerationOptions<T extends VideoGenerationSettingsShape>({
  settings,
  modelSpecs,
  hasAudio = false,
  minimumDuration,
  durationSelection = 'preserve',
}: ResolveVideoGenerationOptionsParams<T>): ResolvedVideoGenerationOptions {
  const modelOptions = getCompatibleModelOptions(modelSpecs, { hasAudio, minimumDuration })
  const selectedModelItem = modelOptions.find((item) => item.pipeline === settings.model) ?? modelOptions[0] ?? null
  if (!selectedModelItem) {
    return {
      modelOptions,
      resolutionOptions: [],
      fpsOptions: [],
      durationOptions: [],
      selectedModel: null,
      selectedResolution: null,
      selectedFps: null,
      selectedDuration: null,
      hasCompatibleOptions: false,
    }
  }

  const resolutionEntries = getCompatibleResolutionEntries(selectedModelItem, { hasAudio, minimumDuration })
  const resolutionOptions = resolutionEntries.map(([resolution]) => resolution)
  const selectedResolution = chooseOption(settings.videoResolution, resolutionOptions)
  if (!selectedResolution) {
    return {
      modelOptions,
      resolutionOptions,
      fpsOptions: [],
      durationOptions: [],
      selectedModel: selectedModelItem.pipeline,
      selectedResolution: null,
      selectedFps: null,
      selectedDuration: null,
      hasCompatibleOptions: false,
    }
  }

  const selectedResolutionSpec = resolutionEntries.find(([resolution]) => resolution === selectedResolution)?.[1] ?? null
  if (!selectedResolutionSpec) {
    return {
      modelOptions,
      resolutionOptions,
      fpsOptions: [],
      durationOptions: [],
      selectedModel: selectedModelItem.pipeline,
      selectedResolution,
      selectedFps: null,
      selectedDuration: null,
      hasCompatibleOptions: false,
    }
  }

  const fpsOptions = getCompatibleFps(selectedResolutionSpec, { minimumDuration })
  const selectedFps = chooseOption(settings.fps, fpsOptions)
  if (!selectedFps) {
    return {
      modelOptions,
      resolutionOptions,
      fpsOptions,
      durationOptions: [],
      selectedModel: selectedModelItem.pipeline,
      selectedResolution,
      selectedFps: null,
      selectedDuration: null,
      hasCompatibleOptions: false,
    }
  }

  const durationOptions = filterDurationsByMinimum(
    getDurationsForFps(selectedResolutionSpec, selectedFps),
    minimumDuration,
  )
  const selectedDuration = durationSelection === 'smallest_valid'
    ? durationOptions[0] ?? null
    : chooseOption(settings.duration, durationOptions)

  return {
    modelOptions,
    resolutionOptions,
    fpsOptions,
    durationOptions,
    selectedModel: selectedModelItem.pipeline,
    selectedResolution,
    selectedFps,
    selectedDuration,
    hasCompatibleOptions: selectedDuration !== null,
  }
}

export function sanitizeVideoGenerationSettings<T extends VideoGenerationSettingsShape>(
  settings: T,
  modelSpecs: VideoGenerationModelSpecItem[],
  options: {
    hasAudio?: boolean
    minimumDuration?: number
    durationSelection?: DurationSelectionMode
    allowedAspectRatios?: readonly string[]
  } = {},
): T | null {
  const resolved = resolveVideoGenerationOptions({
    settings,
    modelSpecs,
    hasAudio: options.hasAudio,
    minimumDuration: options.minimumDuration,
    durationSelection: options.durationSelection,
  })
  if (
    !resolved.hasCompatibleOptions
    || !resolved.selectedModel
    || !resolved.selectedResolution
    || !resolved.selectedFps
    || !resolved.selectedDuration
  ) {
    return null
  }

  // Aspect ratio isn't part of model-spec compatibility, so clamp it to the
  // set the caller allows (defaults to the two universally-supported ratios;
  // callers on the local pipeline opt into '21:9' by widening this list).
  const allowedAspectRatios = options.allowedAspectRatios ?? ['16:9', '9:16']
  const aspectRatio = (
    settings.aspectRatio && allowedAspectRatios.includes(settings.aspectRatio)
      ? settings.aspectRatio
      : '16:9'
  ) as VideoGenerationAspectRatio

  return {
    ...settings,
    model: resolved.selectedModel,
    videoResolution: resolved.selectedResolution,
    fps: resolved.selectedFps,
    duration: resolved.selectedDuration,
    aspectRatio,
  }
}

export function areVideoGenerationSettingsEquivalent<T extends VideoGenerationSettingsShape>(
  left: T,
  right: T,
): boolean {
  return (
    left.model === right.model
    && left.duration === right.duration
    && left.videoResolution === right.videoResolution
    && left.fps === right.fps
    && (left.aspectRatio ?? '16:9') === (right.aspectRatio ?? '16:9')
    && (left.audio ?? false) === (right.audio ?? false)
  )
}
