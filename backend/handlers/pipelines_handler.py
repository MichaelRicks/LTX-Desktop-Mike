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
    get_downloaded_ltx_model_id,
    get_existing_cp_path,
    get_ltx_model_spec,
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
        model_id = get_downloaded_ltx_model_id(self.models_dir)
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

        try:
            state.pipeline.compile_transformer()
            state.is_compiled = True
        except Exception as exc:
            logger.warning("Failed to compile transformer: %s", exc, exc_info=True)
        return state

    def _create_video_pipeline(self, model_type: VideoPipelineModelType) -> VideoPipelineState:
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
        )

        state = VideoPipelineState(
            pipeline=pipeline,
            is_compiled=False,
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
        should_park_image_generation_pipeline = False
        should_cleanup = False

        with self._lock:
            self._ensure_no_running_generation()
            if self.state.gpu_slot is None:
                return

            active = self.state.gpu_slot.active_pipeline
            if isinstance(active, ImageGenerationPipeline):
                should_park_image_generation_pipeline = True
            else:
                self.state.gpu_slot = None
                self._assert_invariants()
                should_cleanup = True

        if should_park_image_generation_pipeline:
            self.park_image_generation_pipeline_on_cpu()
        elif should_cleanup:
            self._gpu_cleaner.cleanup()

    def load_gpu_pipeline(self, model_type: VideoPipelineModelType) -> VideoPipelineState:
        self._install_text_patches_if_needed()

        state: VideoPipelineState | None = None
        with self._lock:
            if self._pipeline_matches_model_type(model_type):
                match self.state.gpu_slot:
                    case GpuSlot(active_pipeline=VideoPipelineState() as existing_state):
                        state = existing_state
                    case _:
                        pass

        if state is None:
            self._evict_gpu_pipeline_for_swap()
            state = self._create_video_pipeline(model_type)
            with self._lock:
                self.state.gpu_slot = GpuSlot(active_pipeline=state)
                self._assert_invariants()

        return state

    def load_ic_lora(
        self,
        lora_path: str,
        depth_model_path: str,
    ) -> ICLoraState:
        self._install_text_patches_if_needed()

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=ICLoraState(
                        lora_path=current_lora_path,
                        depth_model_path=current_depth_model_path,
                    ) as state
                ) if (
                    current_lora_path == lora_path
                    and current_depth_model_path == depth_model_path
                ):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()
        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)

        pipeline = self._ic_lora_pipeline_class.create(
            str(get_existing_cp_path(self.models_dir, model_spec.model_cp)),
            self._text_handler.resolve_gemma_root(),
            str(get_existing_cp_path(self.models_dir, model_spec.upscale_cp)),
            lora_path,
            self.config.device,
            streaming_prefetch_count_for_mode(self.config.local_generations_mode),
        )
        depth_pipeline = self._depth_processor_pipeline_class.create(depth_model_path, self.config.device)
        state = ICLoraState(
            pipeline=pipeline,
            lora_path=lora_path,
            depth_pipeline=depth_pipeline,
            depth_model_path=depth_model_path,
        )

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state

    def load_a2v_pipeline(self) -> A2VPipelineState:
        self._install_text_patches_if_needed()

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(active_pipeline=A2VPipelineState() as state):
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()
        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)

        pipeline = self._a2v_pipeline_class.create(
            str(get_existing_cp_path(self.models_dir, model_spec.model_cp)),
            self._text_handler.resolve_gemma_root(),
            str(get_existing_cp_path(self.models_dir, model_spec.upscale_cp)),
            self.config.device,
            streaming_prefetch_count_for_mode(self.config.local_generations_mode),
        )
        state = A2VPipelineState(pipeline=pipeline)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state

    def load_retake_pipeline(self, *, distilled: bool = True) -> RetakePipelineState:
        self._install_text_patches_if_needed()

        quantized = device_supports_fp8(self.config.device)

        with self._lock:
            match self.state.gpu_slot:
                case GpuSlot(
                    active_pipeline=RetakePipelineState(distilled=current_distilled, quantized=current_quantized) as state
                ) if current_distilled == distilled and current_quantized == quantized:
                    return state
                case _:
                    pass

        self._evict_gpu_pipeline_for_swap()

        from ltx_core.quantization import QuantizationPolicy

        quantization = QuantizationPolicy.fp8_cast() if quantized else None
        model_id = self._require_downloaded_ltx_model_id()
        model_spec = get_ltx_model_spec(model_id)
        pipeline = self._retake_pipeline_class.create(
            checkpoint_path=str(get_existing_cp_path(self.models_dir, model_spec.model_cp)),
            gemma_root=self._text_handler.resolve_gemma_root(),
            device=self.config.device,
            streaming_prefetch_count=streaming_prefetch_count_for_mode(self.config.local_generations_mode),
            loras=[],
            quantization=quantization,
        )
        state = RetakePipelineState(pipeline=pipeline, distilled=distilled, quantized=quantized)

        with self._lock:
            self.state.gpu_slot = GpuSlot(active_pipeline=state)
            self._assert_invariants()
        return state
