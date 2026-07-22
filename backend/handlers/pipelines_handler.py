"""Pipeline lifecycle handler."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from threading import RLock
from typing import TYPE_CHECKING

from _routes._errors import HTTPError
from api_types import ImageGenerationModelCheckpointID, LTXLocalModelId
from handlers.base import StateHandlerBase
from handlers.text_handler import TextHandler
from runtime_config.model_download_specs import (
    get_existing_cp_path,
    get_ltx_model_spec,
    resolve_active_ltx_model_id,
)
from runtime_config.runtime_policy import streaming_prefetch_count_for_mode
from services.interfaces import (
    A2VPipeline,
    DepthProcessorPipeline,
    FastVideoPipeline,
    ImageGenerationPipeline,
    GpuCleaner,
    IcLoraPipeline,
    PoseProcessorPipeline,
    QwenMultiAnglePipeline,
    RetakePipeline,
    VideoPipelineModelType,
)
from services.services_utils import device_supports_fp8, get_device_type
from state.app_state_types import (
    A2VPipelineState,
    AppState,
    CpuSlot,
    GpuGeneration,
    GenerationRunning,
    GpuSlot,
    ICLoraState,
    QwenMultiAngleState,
    RetakePipelineState,
    VideoPipelineState,
)

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

logger = logging.getLogger(__name__)


class PipelinesHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        text_handler: TextHandler,
        gpu_cleaner: GpuCleaner,
        fast_video_pipeline_class: type[FastVideoPipeline],
        image_generation_pipeline_classes: Mapping[ImageGenerationModelCheckpointID, type[ImageGenerationPipeline]],
        ic_lora_pipeline_class: type[IcLoraPipeline],
        depth_processor_pipeline_class: type[DepthProcessorPipeline],
        pose_processor_pipeline_class: type[PoseProcessorPipeline],
        a2v_pipeline_class: type[A2VPipeline],
        retake_pipeline_class: type[RetakePipeline],
        config: RuntimeConfig,
        qwen_multiangle_pipeline_class: type[QwenMultiAnglePipeline] | None = None,
    ) -> None:
        super().__init__(state, lock, config)
        self._text_handler = text_handler
        self._gpu_cleaner = gpu_cleaner
        self._fast_video_pipeline_class = fast_video_pipeline_class
        self._image_generation_pipeline_classes = image_generation_pipeline_classes
        self._active_image_generation_cp_id: ImageGenerationModelCheckpointID | None = None
        self._ic_lora_pipeline_class = ic_lora_pipeline_class
        self._depth_processor_pipeline_class = depth_processor_pipeline_class
        self._pose_processor_pipeline_class = pose_processor_pipeline_class
        self._a2v_pipeline_class = a2v_pipeline_class
        self._retake_pipeline_class = retake_pipeline_class
        self._qwen_multiangle_pipeline_class = qwen_multiangle_pipeline_class
        self._runtime_device = get_device_type(self.config.device)

    def _ensure_no_running_generation(self) -> None:
        match self.state.active_generation:
            case GpuGeneration(state=GenerationRunning()) if self.state.gpu_slot is not None:
                raise RuntimeError("Generation already running; cannot swap pipelines")
            case _:
                return

    def _pipeline_matches_model_type(self, model_type: VideoPipelineModelType) -> bool:
        match self.state.gpu_slot:
            case GpuSlot(active_pipeline=VideoPipelineState(pipeline=pipeline)):
                return pipeline.pipeline_kind == model_type
            case _:
                return False

    def _assert_invariants(self) -> None:
        match self.state.gpu_slot:
            case GpuSlot(active_pipeline=active_pipeline):
                gpu_has_image_generation_pipeline = isinstance(active_pipeline, ImageGenerationPipeline)
            case _:
                gpu_has_image_generation_pipeline = False

        if gpu_has_image_generation_pipeline and self.state.cpu_slot is not None:
            raise RuntimeError("Invariant violation: image generation pipeline cannot be in both GPU and CPU slots")

    def _install_text_patches_if_needed(self) -> None:
        te = self.state.text_encoder
        if te is None:
            return
        te.service.install_patches(lambda: self.state)

    def _require_downloaded_ltx_model_id(self) -> LTXLocalModelId:
        model_id = resolve_active_ltx_model_id(
            self.models_dir, self.state.app_settings.active_ltx_model_id
        )
        if model_id is None:
            raise HTTPError(409, "NO_DOWNLOADED_LTX_MODEL")
        return model_id

    def _compile_if_enabled(self, state: VideoPipelineState) -> VideoPipelineState:
        if not self.state.app_settings.use_torch_compile:
            return state
        if state.is_compiled:
            return state
        if self._runtime_device == "mps":
            logger.info("Skipping torch.compile() for %s - not supported on MPS", state.pipeline.pipeline_kind)
            return state
        if self.config.use_sage_attention:
            # SageAttention's Python-level kernel forces a Dynamo graph break at every
            # attention call. The resume graph Dynamo builds for the code after each
            # break doesn't inherit the video/audio tensors' pre-existing mark_dynamic
            # annotations, so it specializes their sequence-length dim to whatever
            # shape it first sees — then hard-fails (ConstraintViolationError) on any
            # later call with a different frame count or resolution. The two features
            # conflict; SageAttention already provides its own speedup, so skip
            # compilation rather than compiling a graph that can only serve one shape.
            logger.info(
                "Skipping torch.compile() for %s - conflicts with SageAttention's graph breaks",
                state.pipeline.pipeline_kind,
            )
            return state

        try:
            state.pipeline.compile_transformer()
            state.is_compiled = True
        except Exception as exc:
            logger.warning("Failed to compile transformer: %s", exc, exc_info=True)
        return state

    def _create_video_pipeline(
        self, model_type: VideoPipelineModelType, loras: list[tuple[str, float]] | None = None
    ) -> VideoPipelineState:
        gemma_root = self._text_handler.resolve_gemma_root()
        model_id = self._require_downloaded_ltx_model_id()
        spec = get_ltx_model_spec(model_id)
        checkpoint_path = str(get_existing_cp_path(self.models_dir, spec.model_cp))
        upsampler_path = str(get_existing_cp_path(self.models_dir, spec.upscale_cp))

        pipeline = self._fast_video_pipeline_class.create(
            checkpoint_path,
            gemma_root,
            upsampler_path,
            self.config.device,
            streaming_prefetch_count_for_mode(self.config.local_generations_mode),
            loras=loras or [],
        )

        state = VideoPipelineState(
            pipeline=pipeline,
            is_compiled=False,
            loras=tuple(loras) if loras else (),
            gemma_root=gemma_root,
        )
        return self._compile_if_enabled(state)

    def unload_gpu_pipeline(self) -> None:
        with self._lock:
            self._ensure_no_running_generation()
            self.state.gpu_slot = None
            self._assert_invariants()
        self._gpu_cleaner.cleanup()

    def park_image_generation_pipeline_on_cpu(self) -> None:
        image_generation_pipeline: ImageGenerationPipeline | None = None

        with self._lock:
            if self.state.gpu_slot is None:
                return

            active = self.state.gpu_slot.active_pipeline
            if not isinstance(active, ImageGenerationPipeline):
                return

            if isinstance(self.state.active_generation, GpuGeneration) and isinstance(
                self.state.active_generation.state, GenerationRunning
            ):
                raise RuntimeError("Cannot park image generation pipeline while generation is running")

            image_generation_pipeline = active
            self.state.gpu_slot = None

        assert image_generation_pipeline is not None
        image_generation_pipeline.to("cpu")
        self._gpu_cleaner.cleanup()

        with self._lock:
            self.state.cpu_slot = CpuSlot(active_pipeline=image_generation_pipeline)
            self._assert_invariants()

    def load_image_generation_pipeline_to_gpu(
        self, cp_id: ImageGenerationModelCheckpointID
    ) -> ImageGenerationPipeline:
        with self._lock:
            if self.state.gpu_slot is not None:
                active = self.state.gpu_slot.active_pipeline
                if isinstance(active, ImageGenerationPipeline):
                    if self._active_image_generation_cp_id == cp_id:
                        return active
                    self._ensure_no_running_generation()
                    # Wrong model loaded — drop it rather than reuse, so we never
                    # silently generate with a different checkpoint than requested.
                    self.state.gpu_slot = None
                else:
                    self._ensure_no_running_generation()
                    # A video-family pipeline holds the GPU — drop it too, so its
                    # weights don't occupy VRAM underneath the image pipeline.
                    self.state.gpu_slot = None
                    self._assert_invariants()

        image_generation_pipeline: ImageGenerationPipeline | None = None

        with self._lock:
            match self.state.cpu_slot:
                case CpuSlot(active_pipeline=stored) if self._active_image_generation_cp_id == cp_id:
                    image_generation_pipeline = stored
                    self.state.cpu_slot = None
                case CpuSlot():
                    # Parked pipeline is for a different model — discard it too.
                    self.state.cpu_slot = None
                case _:
                    pass

        # Release whatever was just dropped BEFORE loading the new model, so the
        # image pipeline never has to fit alongside evicted weights.
        self._gpu_cleaner.cleanup()

        if image_generation_pipeline is None:
            pipeline_class = self._image_generation_pipeline_classes[cp_id]
            model_path = get_existing_cp_path(self.models_dir, cp_id)
            image_generation_pipeline = pipeline_class.create(str(model_path), self._runtime_device)
        else:
            image_generation_pipeline.to(self._runtime_device)

        self._gpu_cleaner.cleanup()

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=image_generation_pipeline)
            self._active_image_generation_cp_id = cp_id
            self._assert_invariants()

        return image_generation_pipeline

    def _evict_gpu_pipeline_for_swap(self) -> None:
        # FORK CHANGE — diverges from upstream (see FORK.md "must survive").
        # Upstream parks an active image pipeline in host RAM here so a later
        # image<->image switch stays warm (via park_image_generation_pipeline_on_cpu,
        # now unused). But every caller of this method is loading a memory-hungry
        # video-class pipeline (video / IC-LoRA / a2v / retake), for which a parked
        # image model is pure dead weight: on a 64 GB box it pushes the video model's
        # bf16-read + fp8-pin working set past physical RAM and into pagefile
        # thrashing — and image->video (i2v) is the *common* workflow. So free the
        # image pipeline outright instead of parking it, and also drop any pipeline
        # parked by a previous swap. Returning to image gen reloads from its fast
        # NF4/disk cache, far cheaper than thrashing every video render.
        with self._lock:
            self._ensure_no_running_generation()
            if self.state.gpu_slot is None and self.state.cpu_slot is None:
                return
            self.state.gpu_slot = None
            self.state.cpu_slot = None
            self._active_image_generation_cp_id = None
            self._assert_invariants()

        self._gpu_cleaner.cleanup()

    def load_gpu_pipeline(
        self,
        model_type: VideoPipelineModelType,
        loras: list[tuple[str, float]] | None = None,
    ) -> VideoPipelineState:
        self._install_text_patches_if_needed()

        requested_loras = tuple(loras) if loras else ()
        requested_gemma_root = self._text_handler.resolve_gemma_root()
        state: VideoPipelineState | None = None
        with self._lock:
            if self._pipeline_matches_model_type(model_type):
                match self.state.gpu_slot:
                    case GpuSlot(
                        active_pipeline=VideoPipelineState() as existing_state
                    ) if (
                        existing_state.loras == requested_loras
                        and existing_state.gemma_root == requested_gemma_root
                    ):
                        state = existing_state
                    case _:
                        pass

        if state is None:
            self._evict_gpu_pipeline_for_swap()
            state = self._create_video_pipeline(model_type, loras=loras)
            with self._lock:
                self.state.gpu_slot = GpuSlot(active_pipeline=state)
                self._assert_invariants()

        return state

    def load_ic_lora(
        self,
        lora_path: str,
        depth_model_path: str | None = None,
        lora_strength: float = 1.0,
    ) -> ICLoraState:
        self._install_text_patches_if_needed()

        gemma_root = self._text_handler.resolve_gemma_root()
        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=ICLoraState(
                        lora_path=current_lora_path,
                        depth_model_path=current_depth_model_path,
                        lora_strength=current_lora_strength,
                        gemma_root=current_gemma_root,
                    ) as state
                ) if (
                    current_lora_path == lora_path
                    and current_depth_model_path == depth_model_path
                    and current_lora_strength == lora_strength
                    and current_gemma_root == gemma_root
                ):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()
        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)

        pipeline = self._ic_lora_pipeline_class.create(
            str(get_existing_cp_path(self.models_dir, model_spec.model_cp)),
            gemma_root,
            str(get_existing_cp_path(self.models_dir, model_spec.upscale_cp)),
            lora_path,
            self.config.device,
            streaming_prefetch_count_for_mode(self.config.local_generations_mode),
            lora_strength,
        )
        depth_pipeline = (
            self._depth_processor_pipeline_class.create(depth_model_path, self.config.device)
            if depth_model_path is not None
            else None
        )
        state = ICLoraState(
            pipeline=pipeline,
            lora_path=lora_path,
            depth_pipeline=depth_pipeline,
            depth_model_path=depth_model_path,
            lora_strength=lora_strength,
            gemma_root=gemma_root,
        )

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state

    def load_a2v_pipeline(self, loras: list[tuple[str, float]] | None = None) -> A2VPipelineState:
        self._install_text_patches_if_needed()

        requested_loras = tuple(loras) if loras else ()
        gemma_root = self._text_handler.resolve_gemma_root()
        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=A2VPipelineState() as state) if (
                    state.loras == requested_loras and state.gemma_root == gemma_root
                ):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()
        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)

        pipeline = self._a2v_pipeline_class.create(
            str(get_existing_cp_path(self.models_dir, model_spec.model_cp)),
            gemma_root,
            str(get_existing_cp_path(self.models_dir, model_spec.upscale_cp)),
            self.config.device,
            streaming_prefetch_count_for_mode(self.config.local_generations_mode),
            loras=loras or [],
        )
        state = A2VPipelineState(pipeline=pipeline, loras=requested_loras, gemma_root=gemma_root)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state

    def load_retake_pipeline(self, *, distilled: bool = True) -> RetakePipelineState:
        self._install_text_patches_if_needed()

        quantized = device_supports_fp8(self.config.device)
        gemma_root = self._text_handler.resolve_gemma_root()

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=RetakePipelineState(
                        distilled=current_distilled, quantized=current_quantized, gemma_root=current_gemma_root
                    ) as state
                ) if (
                    current_distilled == distilled
                    and current_quantized == quantized
                    and current_gemma_root == gemma_root
                ):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()

        from ltx_core.quantization.fp8_cast import build_policy as build_fp8_cast_policy

        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)
        checkpoint_path = str(get_existing_cp_path(self.models_dir, model_spec.model_cp))
        quantization = build_fp8_cast_policy(checkpoint_path) if quantized else None
        pipeline = self._retake_pipeline_class.create(
            checkpoint_path=checkpoint_path,
            gemma_root=gemma_root,
            device=self.config.device,
            streaming_prefetch_count=streaming_prefetch_count_for_mode(self.config.local_generations_mode),
            loras=[],
            quantization=quantization,
        )
        state = RetakePipelineState(
            pipeline=pipeline, distilled=distilled, quantized=quantized, gemma_root=gemma_root
        )

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state

    def load_qwen_multiangle_pipeline(self) -> QwenMultiAngleState:
        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=QwenMultiAngleState() as state):
                    return state
                case _:
                    pass

        if self._qwen_multiangle_pipeline_class is None:
            raise HTTPError(500, "Qwen multi-angle pipeline is not configured")

        self._evict_gpu_pipeline_for_swap()

        import torch

        device = torch.device(self._runtime_device)
        pipeline = self._qwen_multiangle_pipeline_class.create(device=device)
        state = QwenMultiAngleState(pipeline=pipeline)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state
