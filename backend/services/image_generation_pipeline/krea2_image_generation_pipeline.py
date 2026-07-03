"""Krea 2 Turbo image generation pipeline wrapper."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

import torch
from diffusers import Krea2Pipeline  # type: ignore[reportUnknownVariableType]
from diffusers.hooks import apply_group_offloading  # type: ignore[reportUnknownVariableType]
from PIL.Image import Image as PILImage
from PIL.Image import Resampling

from services.services_utils import (
    ImagePipelineOutputLike,
    PILImageType,
    empty_device_cache,
    get_device_type,
    sync_device,
)


@dataclass(slots=True)
class _Krea2Output:
    images: Sequence[PILImageType]


class Krea2ImageGenerationPipeline:
    @staticmethod
    def create(
        model_path: str,
        device: str | None = None,
    ) -> "Krea2ImageGenerationPipeline":
        return Krea2ImageGenerationPipeline(model_path=model_path, device=device)

    def __init__(self, model_path: str, device: str | None = None) -> None:
        self._device: str | None = None
        self._cpu_offload_active = False
        self.pipeline = Krea2Pipeline.from_pretrained(  # type: ignore[reportUnknownMemberType]
            model_path,
            torch_dtype=torch.bfloat16,
        )
        if device is not None:
            self.to(device)

    def _resolve_generator_device(self) -> str:
        if self._cpu_offload_active:
            return "cuda"
        if self._device is not None:
            return self._device

        execution_device = getattr(self.pipeline, "_execution_device", None)
        return get_device_type(execution_device)

    @staticmethod
    def _normalize_output(output: object) -> ImagePipelineOutputLike:
        images = getattr(output, "images", None)
        if not isinstance(images, Sequence):
            raise RuntimeError("Unexpected Krea 2 pipeline output format: missing images sequence")

        images_list = cast(Sequence[object], images)
        validated_images: list[PILImageType] = []
        for image in images_list:
            if not isinstance(image, PILImage):
                raise RuntimeError("Unexpected Krea 2 pipeline output format: images must be PIL.Image instances")
            validated_images.append(image)

        return _Krea2Output(images=validated_images)

    # ~1 MP is what a 24 GB card sustains with block offloading: the allocator's
    # reservation grows toward the full transformer size during a pass, and
    # larger canvases push it past VRAM, where Windows silently spills to
    # system RAM (~40x slower). Measured: 1344x768 peaks ~22 GB and runs at
    # full speed; 1920x1088 reserves 44 GB and takes minutes per step.
    _MAX_GENERATION_PIXELS = 1344 * 768

    @torch.inference_mode()
    def generate(
        self,
        prompt: str,
        height: int,
        width: int,
        guidance_scale: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        requested_width, requested_height = width, height
        if width * height > self._MAX_GENERATION_PIXELS:
            scale = (self._MAX_GENERATION_PIXELS / (width * height)) ** 0.5
            width = max(16, int(width * scale) // 16 * 16)
            height = max(16, int(height * scale) // 16 * 16)

        device = self._resolve_generator_device()
        generator = torch.Generator(device=device).manual_seed(seed)
        pipeline = cast(Any, self.pipeline)

        def flush_cache_on_step_end(
            _pipe: object, _step: int, _timestep: object, callback_kwargs: dict[str, Any]
        ) -> dict[str, Any]:
            # Return freed block buffers to the driver after every step so the
            # allocator's reservation cannot compound across steps.
            sync_device(device)
            empty_device_cache(device)
            return callback_kwargs

        try:
            output = pipeline(
                prompt=prompt,
                height=height,
                width=width,
                guidance_scale=guidance_scale,
                num_inference_steps=num_inference_steps,
                generator=generator,
                output_type="pil",
                return_dict=True,
                callback_on_step_end=flush_cache_on_step_end,
            )
        finally:
            # Leftover allocator cache would starve the next run the same way.
            sync_device(device)
            empty_device_cache(device)

        result = self._normalize_output(output)
        if (width, height) != (requested_width, requested_height):
            # Deliver the size the caller asked for; Lanczos upscale from the
            # model's native ~1 MP is visually clean and keeps VRAM bounded.
            result = _Krea2Output(
                images=[
                    img.resize((requested_width, requested_height), Resampling.LANCZOS) for img in result.images
                ]
            )
        return result

    def to(self, device: str) -> None:
        runtime_device = get_device_type(device)
        if runtime_device == "cuda":
            # The bf16 transformer (~24 GB) exceeds consumer VRAM, so whole-
            # component offloading (enable_model_cpu_offload) cannot work:
            # blocks are copied from system RAM per-use instead.
            # - use_stream=False: streamed (async) mode parks every block's GPU
            #   copy behind CUDA-stream lifetimes, so the allocator accumulates
            #   the entire transformer (~22 GB) instead of reusing one buffer;
            #   at >=1080p that saturates 24 GB cards and Windows silently
            #   spills to system RAM (~40x slower). Synchronous copies keep the
            #   watermark at a few GB at a cost of a couple seconds per step.
            # - low_cpu_mem_usage=True: skips host-memory pinning, which
            #   Windows refuses at this size (fails as a bogus CUDA OOM).
            onload = torch.device("cuda")
            offload = torch.device("cpu")
            pipeline = cast(Any, self.pipeline)
            pipeline.transformer.enable_group_offload(
                onload_device=onload,
                offload_device=offload,
                offload_type="block_level",
                num_blocks_per_group=1,
                use_stream=False,
                low_cpu_mem_usage=True,
            )
            apply_group_offloading(
                pipeline.text_encoder,
                onload_device=onload,
                offload_device=offload,
                offload_type="block_level",
                num_blocks_per_group=1,
                use_stream=False,
                low_cpu_mem_usage=True,
            )
            pipeline.vae.to(onload)
            self._cpu_offload_active = True
        elif runtime_device == "mps":
            self.pipeline.enable_model_cpu_offload()  # type: ignore[reportUnknownMemberType]
            self._cpu_offload_active = True
        else:
            self._cpu_offload_active = False
            self.pipeline.to(runtime_device)  # type: ignore[reportUnknownMemberType]
        self._device = runtime_device
