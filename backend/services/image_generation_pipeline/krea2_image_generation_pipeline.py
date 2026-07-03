"""Krea 2 Turbo image generation pipeline wrapper."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import torch
from diffusers import BitsAndBytesConfig  # type: ignore[reportPrivateImportUsage]
from diffusers import Krea2Pipeline  # type: ignore[reportUnknownVariableType]
from diffusers import Krea2Transformer2DModel  # type: ignore[reportPrivateImportUsage]
from PIL.Image import Image as PILImage
from PIL.Image import Resampling

from services.services_utils import (
    ImagePipelineOutputLike,
    PILImageType,
    empty_device_cache,
    get_device_type,
    sync_device,
)

logger = logging.getLogger(__name__)

# Cached beside the model files themselves (never touches the originals) so
# subsequent loads read ~7 GB of already-quantized weights instead of the
# full ~24 GB bf16 transformer. Cuts cold-load time roughly 8x and makes the
# load far less likely to be hit by the original files getting evicted from
# the OS file cache under RAM pressure (e.g. from a large video model).
_NF4_CACHE_DIRNAME = "_nf4_transformer_cache"


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

    @staticmethod
    def _load_quantized_transformer(model_path: str) -> Krea2Transformer2DModel:
        cache_dir = Path(model_path) / _NF4_CACHE_DIRNAME
        if (cache_dir / "config.json").exists():
            try:
                return Krea2Transformer2DModel.from_pretrained(  # type: ignore[reportUnknownMemberType]
                    cache_dir, torch_dtype=torch.bfloat16
                )
            except Exception:
                logger.warning(
                    "Failed to load cached NF4 Krea 2 transformer from %s; re-quantizing from source.",
                    cache_dir,
                    exc_info=True,
                )

        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        transformer = Krea2Transformer2DModel.from_pretrained(  # type: ignore[reportUnknownMemberType]
            model_path,
            subfolder="transformer",
            quantization_config=quantization_config,
            torch_dtype=torch.bfloat16,
        )
        try:
            transformer.save_pretrained(cache_dir)  # type: ignore[reportUnknownMemberType]
        except OSError:
            logger.warning("Failed to cache NF4 Krea 2 transformer to %s", cache_dir, exc_info=True)
        return transformer

    def __init__(self, model_path: str, device: str | None = None) -> None:
        self._device: str | None = None
        self._cpu_offload_active = False

        # NF4 quantization only benefits CUDA: it shrinks the ~24 GB bf16
        # transformer to ~7 GB, small enough to fit on a consumer GPU as a
        # whole component (no block-level streaming needed), which is both
        # faster (no per-block copy overhead) and lighter to keep resident
        # when parked between generations. bitsandbytes has no MPS backend,
        # so other devices keep the plain bf16 transformer.
        if get_device_type(device) == "cuda":
            transformer = self._load_quantized_transformer(model_path)
            self.pipeline = Krea2Pipeline.from_pretrained(  # type: ignore[reportUnknownMemberType]
                model_path,
                transformer=transformer,
                torch_dtype=torch.bfloat16,
            )
        else:
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

    # Quantizing the transformer shrinks its *weights* (~24 GB -> ~7 GB), but
    # activation memory still scales with pixel count regardless of
    # quantization. Measured on a 24 GB card: 1344x768 reserves ~17 GB and
    # runs at full speed; 1536x896 reserves ~24 GB (no safety margin left for
    # other apps); 1728x992 reserves ~32 GB, overflowing into system RAM
    # (~40x slower). Keep the same conservative cap as the pre-quantization
    # implementation.
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
            )
        finally:
            # Leftover allocator cache would starve the next run.
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
        if runtime_device in ("cuda", "mps"):
            # The NF4-quantized transformer (~7 GB) fits on the accelerator as
            # a whole component, so simple whole-model offloading is enough -
            # no custom block-level streaming needed. enable_model_cpu_offload
            # removes any previously installed hooks first, so it's safe to
            # call again after a park-to-CPU cycle.
            self.pipeline.enable_model_cpu_offload()  # type: ignore[reportUnknownMemberType]
            self._cpu_offload_active = True
        else:
            self._cpu_offload_active = False
            self.pipeline.to(runtime_device)  # type: ignore[reportUnknownMemberType]
        self._device = runtime_device
