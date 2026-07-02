"""Krea 2 Turbo image generation pipeline wrapper."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

import torch
from diffusers import Krea2Pipeline  # type: ignore[reportUnknownVariableType]
from PIL.Image import Image as PILImage

from services.services_utils import ImagePipelineOutputLike, PILImageType, get_device_type


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
        generator = torch.Generator(device=self._resolve_generator_device()).manual_seed(seed)
        pipeline = cast(Any, self.pipeline)
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
        return self._normalize_output(output)

    def to(self, device: str) -> None:
        runtime_device = get_device_type(device)
        if runtime_device in ("cuda", "mps"):
            self.pipeline.enable_model_cpu_offload()  # type: ignore[reportUnknownMemberType]
            self._cpu_offload_active = True
        else:
            self._cpu_offload_active = False
            self.pipeline.to(runtime_device)  # type: ignore[reportUnknownMemberType]
        self._device = runtime_device
