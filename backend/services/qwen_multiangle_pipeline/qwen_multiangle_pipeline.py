"""Qwen multi-angle pipeline protocol definition.

Deliberately NOT the `ImageGenerationPipeline` protocol (services/interfaces.py) —
that protocol's park-on-CPU-eviction contract (a plain `.to(device)` call)
fights this model's own `enable_model_cpu_offload()` accelerate hooks, which
are load-bearing here (the ~17GB GGUF transformer + ~16GB bf16 text encoder
sum to more than the 24GB card; the hooks are what keeps them from ever being
GPU-resident simultaneously). This pipeline is evicted-and-reloaded like the
video-family pipelines instead — see PipelinesHandler.load_qwen_multiangle_pipeline.

Also deliberately not `@runtime_checkable`, matching RetakePipeline — nothing
should ever isinstance-check against this; the state wrapper dataclass
(QwenMultiAngleState) is what pipelines_handler.py's eviction logic inspects,
never this protocol or a raw pipeline instance.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import torch
    from PIL.Image import Image as PILImage


class QwenMultiAnglePipeline(Protocol):
    @staticmethod
    def create(device: "torch.device") -> "QwenMultiAnglePipeline": ...

    def generate(
        self,
        *,
        image: "PILImage",
        azimuth_deg: float,
        elevation_deg: float,
        zoom: float,
        seed: int,
        extra_prompt: str = "",
        use_lightning: bool = True,
    ) -> "PILImage": ...
