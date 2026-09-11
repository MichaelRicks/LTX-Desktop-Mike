"""Krea 2 Turbo image generation pipeline wrapper."""

# Krea2Pipeline / Krea2Transformer2DModel are untyped in diffusers, so every value
# derived from them is "unknown" under pyright's strict mode. Suppress the unknown-type
# family for this file rather than scattering per-line ignores that can't fully resolve
# a third-party class with no stubs. (Fork-only file — see FORK.md section B.)
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false
# pyright: reportUnknownParameterType=false, reportUnknownArgumentType=false

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
from transformers import BitsAndBytesConfig as TransformersBitsAndBytesConfig
from transformers.models.qwen3_vl.modeling_qwen3_vl import Qwen3VLModel

from services.services_utils import (
    ImagePipelineOutputLike,
    PILImageType,
    empty_device_cache,
    get_device_type,
    sync_device,
)

logger = logging.getLogger(__name__)

# Cached beside the model files themselves (never touches the originals) so
# subsequent loads read the already-quantized weights instead of the full
# bf16 originals. Cuts cold-load time roughly 8x and makes the load far less
# likely to be hit by the original files getting evicted from the OS file
# cache under RAM pressure (e.g. from a large video model) - the text
# encoder is a single ~9 GB file with no shard-level progress reporting, so
# that eviction previously showed up as a multi-minute silent stall.
_NF4_TRANSFORMER_CACHE_DIRNAME = "_nf4_transformer_cache"
_NF4_TEXT_ENCODER_CACHE_DIRNAME = "_nf4_text_encoder_cache"


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
        cache_dir = Path(model_path) / _NF4_TRANSFORMER_CACHE_DIRNAME
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

    @staticmethod
    def _load_quantized_text_encoder(model_path: str) -> Qwen3VLModel:
        cache_dir = Path(model_path) / _NF4_TEXT_ENCODER_CACHE_DIRNAME
        if (cache_dir / "config.json").exists():
            try:
                return Qwen3VLModel.from_pretrained(cache_dir, torch_dtype=torch.bfloat16)  # type: ignore[reportUnknownMemberType]
            except Exception:
                logger.warning(
                    "Failed to load cached NF4 Krea 2 text encoder from %s; re-quantizing from source.",
                    cache_dir,
                    exc_info=True,
                )

        quantization_config = TransformersBitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
        text_encoder = Qwen3VLModel.from_pretrained(  # type: ignore[reportUnknownMemberType]
            model_path,
            subfolder="text_encoder",
            quantization_config=quantization_config,
            torch_dtype=torch.bfloat16,
        )
        try:
            text_encoder.save_pretrained(cache_dir)  # type: ignore[reportUnknownMemberType]
        except OSError:
            logger.warning("Failed to cache NF4 Krea 2 text encoder to %s", cache_dir, exc_info=True)
        return text_encoder

    def __init__(self, model_path: str, device: str | None = None) -> None:
        self._device: str | None = None
        self._cpu_offload_active = False

        # NF4 quantization only benefits CUDA: it shrinks the ~24 GB bf16
        # transformer to ~7 GB and the ~9 GB text encoder to ~3 GB, small
        # enough to fit on a consumer GPU as whole components (no
        # block-level streaming needed), which is both faster (no per-block
        # copy overhead) and lighter to keep resident when parked between
        # generations. bitsandbytes has no MPS backend, so other devices
        # keep the plain bf16 components.
        if get_device_type(device) == "cuda":
            transformer = self._load_quantized_transformer(model_path)
            text_encoder = self._load_quantized_text_encoder(model_path)
            self.pipeline = Krea2Pipeline.from_pretrained(  # type: ignore[reportUnknownMemberType]
                model_path,
                transformer=transformer,
                text_encoder=text_encoder,
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

    def edit(
        self,
        prompt: str,
        image: PILImageType,
        strength: float,
        num_inference_steps: int,
        seed: int,
    ) -> ImagePipelineOutputLike:
        # Krea 2 Turbo is text-to-image only. Image editing is routed to Z-Image by
        # ImageGenerationHandler._edit; this exists solely to satisfy the
        # ImageGenerationPipeline protocol and must never be called for Krea 2.
        raise NotImplementedError("Krea 2 Turbo does not support image editing")

    def to(self, device: str) -> None:
        runtime_device = get_device_type(device)
        if runtime_device in ("cuda", "mps"):
            # The NF4-quantized transformer (~7 GB) fits on the accelerator as
            # a whole component, so simple whole-model offloading is enough -
            # no custom block-level streaming needed.
            #
            # Only install the accelerate hooks once per move-to-accelerator. Calling
            # enable_model_cpu_offload() again while offload is already active leaves
            # modules with accelerate's wrapped forward but no _hf_hook attribute, which
            # fails at inference ("object has no attribute '_hf_hook'"). A park-to-CPU
            # cycle takes the else-branch and clears the flag, so coming back re-installs.
            if not (self._cpu_offload_active and self._device == runtime_device):
                self.pipeline.enable_model_cpu_offload()  # type: ignore[reportUnknownMemberType]
                self._cpu_offload_active = True
        else:
            self._cpu_offload_active = False
            self.pipeline.to(runtime_device)  # type: ignore[reportUnknownMemberType]
        self._device = runtime_device
