"""GGUF-quantized Qwen multi-angle pipeline.

Ported from the standalone qwen-multiangle-studio app's server.py, GGUF path
only — bf16 and NF4 paths are deliberately not ported. NF4 was proven to
corrupt this model's texture reconstruction (blockwise quantization noise in
the transformer's attention over condition latents); bf16 works but takes
~40 minutes per generation on this hardware. GGUF K-quant is the only
validated-good tradeoff (~30-130s per generation, quality matching bf16) —
see the qwen-multiangle-integration-plan project notes for the full
debugging history if this ever needs revisiting.

Loading takes several minutes cold (reads the ~54GB bf16 originals once to
locate/cache the GGUF file and text encoder); subsequent loads from a warm
HF cache on fast storage take ~30s. See PipelinesHandler.load_qwen_multiangle_pipeline
for why this pipeline is evicted-and-reloaded rather than parked on CPU.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from services.qwen_multiangle_pipeline.angle_mapping import snap_pose
from services.qwen_multiangle_pipeline.qwen_multiangle_pipeline import QwenMultiAnglePipeline

if TYPE_CHECKING:
    import torch
    from collections.abc import Callable
    from PIL.Image import Image as PILImage

logger = logging.getLogger(__name__)

BASE_MODEL = "Qwen/Qwen-Image-Edit-2511"
GGUF_REPO = "unsloth/Qwen-Image-Edit-2511-GGUF"
GGUF_QUANT = "Q6_K"
ANGLES_LORA = "fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA"
LIGHTNING_LORA = "lightx2v/Qwen-Image-Edit-2511-Lightning"
LIGHTNING_WEIGHT_NAME = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"

LIGHTNING_STEPS = 4
LIGHTNING_CFG = 1.0
BASE_STEPS = 28
BASE_CFG = 4.0


class GGUFQwenMultiAnglePipeline:
    @staticmethod
    def create(device: "torch.device") -> QwenMultiAnglePipeline:
        return GGUFQwenMultiAnglePipeline(device=device)

    def __init__(self, device: "torch.device") -> None:
        import torch
        from diffusers import DiffusionPipeline  # type: ignore[reportPrivateImportUsage]
        from diffusers import GGUFQuantizationConfig  # type: ignore[reportPrivateImportUsage]
        from diffusers import QwenImageTransformer2DModel  # type: ignore[reportPrivateImportUsage]
        from huggingface_hub import hf_hub_download  # type: ignore[reportUnknownVariableType]
        from transformers import Qwen2_5_VLForConditionalGeneration

        self._device = device

        logger.info("Loading Qwen multi-angle GGUF transformer (%s)…", GGUF_QUANT)
        gguf_path = hf_hub_download(
            GGUF_REPO,
            f"qwen-image-edit-2511-{GGUF_QUANT}.gguf",
            local_files_only=True,
        )
        transformer = QwenImageTransformer2DModel.from_single_file(  # type: ignore[reportUnknownMemberType]
            gguf_path,
            quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
            torch_dtype=torch.bfloat16,
            config=BASE_MODEL,
            subfolder="transformer",
        )

        logger.info("Loading Qwen multi-angle bf16 text encoder…")
        text_encoder = Qwen2_5_VLForConditionalGeneration.from_pretrained(  # type: ignore[reportUnknownMemberType]
            BASE_MODEL,
            subfolder="text_encoder",
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )

        logger.info("Assembling Qwen multi-angle pipeline…")
        pipe = DiffusionPipeline.from_pretrained(  # type: ignore[reportUnknownMemberType]
            BASE_MODEL,
            transformer=transformer,
            text_encoder=text_encoder,
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )

        logger.info("Loading Qwen multi-angle LoRAs…")
        pipe.load_lora_weights(ANGLES_LORA, adapter_name="angles")
        pipe.load_lora_weights(LIGHTNING_LORA, weight_name=LIGHTNING_WEIGHT_NAME, adapter_name="lightning")

        # Load-bearing, not an optimization: the GGUF transformer (~17GB) and
        # bf16 text encoder (~16GB) sum to more than 24GB VRAM. These hooks
        # are what keep the two from ever being GPU-resident simultaneously
        # (sequential per-forward-pass-stage swap). Never call `.to(device)`
        # on this pipeline once these hooks are installed — see the protocol
        # module's docstring for what breaks if something does.
        pipe.enable_model_cpu_offload()

        self._pipe = pipe

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
        on_step: "Callable[[int, int], None] | None" = None,
    ) -> "PILImage":
        import torch
        import torch.nn.functional as F

        pose = snap_pose(azimuth_deg, elevation_deg, zoom)
        prompt = f"{pose.prompt}, {extra_prompt.strip()}" if extra_prompt.strip() else pose.prompt

        if use_lightning:
            self._pipe.set_adapters(["angles", "lightning"], adapter_weights=[1.0, 1.0])
            steps, cfg = LIGHTNING_STEPS, LIGHTNING_CFG
        else:
            self._pipe.set_adapters(["angles"], adapter_weights=[1.0])
            steps, cfg = BASE_STEPS, BASE_CFG

        generator = torch.Generator(device="cpu").manual_seed(seed)

        def _on_step_end(pipeline: object, step: int, timestep: object, kwargs: dict[str, object]) -> dict[str, object]:
            del pipeline, timestep
            if on_step is not None:
                on_step(step + 1, steps)
            return kwargs

        # ltx2_server.py globally monkeypatches F.scaled_dot_product_attention
        # to route eligible shapes through SageAttention, tuned for LTX-2's
        # video attention. Confirmed via a live end-to-end smoke test that it
        # silently produces NaN output for this model (all-black generations)
        # — force PyTorch's native SDPA for this call regardless of what's
        # currently patched, then restore it so other pipelines in the same
        # process (LTX video) keep their SageAttention speedup.
        patched_sdpa = F.scaled_dot_product_attention
        F.scaled_dot_product_attention = torch._C._nn.scaled_dot_product_attention  # type: ignore[assignment]
        try:
            result = self._pipe(  # type: ignore[reportCallIssue]
                image=image,
                prompt=prompt,
                negative_prompt=" ",
                true_cfg_scale=cfg,
                num_inference_steps=steps,
                generator=generator,
                callback_on_step_end=_on_step_end,
            )
            return result.images[0]  # type: ignore[reportUnknownMemberType]
        finally:
            F.scaled_dot_product_attention = patched_sdpa
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
