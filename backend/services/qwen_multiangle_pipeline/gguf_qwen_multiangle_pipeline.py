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

from services.qwen_multiangle_pipeline.angle_mapping import compose_prompt, snap_pose
from services.qwen_multiangle_pipeline.qwen_multiangle_pipeline import QwenMultiAnglePipeline

if TYPE_CHECKING:
    import torch
    from collections.abc import Callable, Sequence
    from PIL.Image import Image as PILImage

logger = logging.getLogger(__name__)

BASE_MODEL = "Qwen/Qwen-Image-Edit-2511"
GGUF_REPO = "unsloth/Qwen-Image-Edit-2511-GGUF"
GGUF_QUANT = "Q6_K"
ANGLES_LORA = "fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA"
LIGHTNING_LORA = "lightx2v/Qwen-Image-Edit-2511-Lightning"
LIGHTNING_4STEP_WEIGHT = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
LIGHTNING_8STEP_WEIGHT = "Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors"

# Optional skin-realism adapter (prithivMLmods, native 2511 — pore-level skin
# texture). Header-verified same rank 16 / dim 3072 as the angles LoRA, so it
# stacks cleanly; the only difference is a PEFT ".default." infix and a missing
# "transformer." prefix in its keys, normalized at load time. Off by default,
# weighted at generate time so it never overpowers the angles LoRA.
SKIN_LORA_REPO = "prithivMLmods/Qwen-Image-Edit-2511-Hyper-Realistic-Portrait"
SKIN_LORA_WEIGHT = "HRP_5.safetensors"

# Three sampling recipes selectable per generation (quality_mode). Both Lightning
# LoRAs are distillations at CFG 1.0; the 8-step ("balanced") keeps noticeably
# more high-frequency skin/texture detail than the 4-step ("fast") while staying
# ~2x faster than the un-distilled 28-step base ("quality").
FAST_STEPS, FAST_CFG = 4, 1.0
BALANCED_STEPS, BALANCED_CFG = 8, 1.0
QUALITY_STEPS, QUALITY_CFG = 28, 4.0


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
        pipe.load_lora_weights(LIGHTNING_LORA, weight_name=LIGHTNING_4STEP_WEIGHT, adapter_name="lightning4")
        pipe.load_lora_weights(LIGHTNING_LORA, weight_name=LIGHTNING_8STEP_WEIGHT, adapter_name="lightning8")

        # Skin-realism adapter: normalize its PEFT-style keys
        # (transformer_blocks.N…lora_A.default.weight) to the diffusers
        # convention the other adapters use (transformer.transformer_blocks.N…
        # lora_A.weight) so load_lora_weights maps every key.
        logger.info("Loading Qwen multi-angle skin-realism LoRA…")
        from safetensors.torch import load_file  # type: ignore[reportUnknownVariableType]  # local: heavy import

        skin_path = hf_hub_download(SKIN_LORA_REPO, SKIN_LORA_WEIGHT)
        skin_raw: dict[str, object] = load_file(skin_path)  # type: ignore[reportUnknownMemberType]
        skin_state: dict[str, object] = {}
        for key, tensor in skin_raw.items():
            norm = key.replace(".default.", ".")
            if not norm.startswith("transformer."):
                norm = f"transformer.{norm}"
            skin_state[norm] = tensor
        pipe.load_lora_weights(skin_state, adapter_name="skin")

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
        extra_images: "list[PILImage] | None" = None,
        extra_roles: "Sequence[str] | None" = None,
        azimuth_deg: float,
        elevation_deg: float,
        zoom: float,
        seed: int,
        extra_prompt: str = "",
        quality_mode: str = "fast",
        use_skin: bool = False,
        skin_weight: float = 1.0,
        on_step: "Callable[[int, int], None] | None" = None,
    ) -> "PILImage":
        import torch
        import torch.nn.functional as F

        pose = snap_pose(azimuth_deg, elevation_deg, zoom)
        prompt = compose_prompt(pose, extra_prompt, extra_roles or [])

        if quality_mode == "quality":
            adapters, weights = ["angles"], [1.0]
            steps, cfg = QUALITY_STEPS, QUALITY_CFG
        elif quality_mode == "balanced":
            adapters, weights = ["angles", "lightning8"], [1.0, 1.0]
            steps, cfg = BALANCED_STEPS, BALANCED_CFG
        else:  # "fast" (default)
            adapters, weights = ["angles", "lightning4"], [1.0, 1.0]
            steps, cfg = FAST_STEPS, FAST_CFG

        # Skin-realism stacks on top of whatever mode is active (most useful on
        # the softer Lightning modes). Weighted so it can't overpower angles.
        if use_skin and skin_weight > 0:
            adapters.append("skin")
            weights.append(skin_weight)
        self._pipe.set_adapters(adapters, adapter_weights=weights)

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
        # Plus pipeline (2511) accepts a list; subject first, then the extra
        # references (prop/location) it composes from.
        call_kwargs: dict[str, object] = {
            "image": [image, *extra_images] if extra_images else image,
            "prompt": prompt,
            "true_cfg_scale": cfg,
            "num_inference_steps": steps,
            "generator": generator,
            "callback_on_step_end": _on_step_end,
        }
        # A negative prompt only does anything when CFG is on (true_cfg_scale > 1);
        # the Lightning modes run at cfg 1.0, where diffusers ignores it and warns.
        # Only pass it when it will actually be used (Quality mode).
        if cfg > 1:
            call_kwargs["negative_prompt"] = " "

        patched_sdpa = F.scaled_dot_product_attention
        F.scaled_dot_product_attention = torch._C._nn.scaled_dot_product_attention  # type: ignore[assignment]
        try:
            result = self._pipe(**call_kwargs)  # type: ignore[reportCallIssue]
            return result.images[0]  # type: ignore[reportUnknownMemberType]
        finally:
            F.scaled_dot_product_attention = patched_sdpa
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
