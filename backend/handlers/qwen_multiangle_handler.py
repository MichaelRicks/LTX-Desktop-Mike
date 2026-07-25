"""Qwen multi-angle API orchestration handler."""

from __future__ import annotations

import base64
import io
import math
import time
import uuid
from threading import RLock

from PIL import Image
from PIL.Image import Resampling

from _routes._errors import HTTPError
from api_types import QwenMultiAngleGenerateRequest, QwenMultiAngleGenerateResponse
from handlers.base import StateHandlerBase
from handlers.generation_handler import GenerationHandler
from handlers.pipelines_handler import PipelinesHandler
from runtime_config.runtime_config import RuntimeConfig
from services.qwen_multiangle_pipeline.angle_mapping import snap_pose
from state.app_state_types import AppState

# The pipeline internally rescales condition images to ~1MP snapped to /32.
# Resizing here first keeps memory/latency predictable regardless of what the
# user dropped in (a raw camera photo, a screenshot, a prior GPM asset).
TARGET_AREA = 1024 * 1024


class QwenMultiAngleHandler(StateHandlerBase):
    def __init__(
        self,
        state: AppState,
        lock: RLock,
        config: RuntimeConfig,
        generation_handler: GenerationHandler,
        pipelines_handler: PipelinesHandler,
    ) -> None:
        super().__init__(state, lock, config)
        self._generation = generation_handler
        self._pipelines = pipelines_handler

    def generate(self, req: QwenMultiAngleGenerateRequest) -> QwenMultiAngleGenerateResponse:
        if self._generation.is_generation_running():
            raise HTTPError(409, "Generation already in progress")

        source_image = _decode_data_url(req.image_data_url)
        source_image = _model_resize(source_image)
        extra_images = [_model_resize(_decode_data_url(u)) for u in req.extra_image_data_urls]

        seed = req.seed
        if req.randomize_seed:
            seed = int(time.time() * 1000) % 2147483647

        pose = snap_pose(req.azimuth_deg, req.elevation_deg, req.zoom)
        extra = req.extra_prompt.strip()
        prompt = f"{pose.prompt}, {extra}" if extra else pose.prompt

        generation_id = uuid.uuid4().hex[:8]

        try:
            pipeline_state = self._pipelines.load_qwen_multiangle_pipeline()
            self._generation.start_generation(generation_id)
            self._generation.update_progress("loading_model", 5, 0, 1)

            def _on_step(step: int, total_steps: int) -> None:
                progress = 10 + int((step / total_steps) * 85)
                self._generation.update_progress("inference", progress, step, total_steps)

            result_image = pipeline_state.pipeline.generate(
                image=source_image,
                extra_images=extra_images,
                azimuth_deg=req.azimuth_deg,
                elevation_deg=req.elevation_deg,
                zoom=req.zoom,
                seed=seed,
                extra_prompt=req.extra_prompt,
                use_lightning=req.use_lightning,
                on_step=_on_step,
            )

            if self._generation.is_generation_cancelled():
                raise RuntimeError("Generation was cancelled")

            self._generation.update_progress("complete", 100, 1, 1)
            result_data_url = _encode_png_data_url(result_image)
            self._generation.complete_generation(result_data_url)

            return QwenMultiAngleGenerateResponse(
                status="complete",
                image_data_url=result_data_url,
                prompt=prompt,
                seed=seed,
            )
        except HTTPError:
            self._generation.fail_generation("Multi-angle generation failed")
            raise
        except Exception as exc:
            self._generation.fail_generation(str(exc))
            raise HTTPError(500, f"Generation error: {exc}") from exc


def _decode_data_url(data_url: str) -> Image.Image:
    _, _, encoded = data_url.partition(",")
    if not encoded:
        raise HTTPError(400, "image_data_url must be a data: URL")
    try:
        raw = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPError(400, f"Not a readable image: {exc}") from exc
    return image.convert("RGB")


def _encode_png_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{encoded}"


def _model_resize(image: Image.Image) -> Image.Image:
    """Preserve aspect, area-normalize to ~1MP, snap dimensions to /32."""
    width, height = image.size
    scale = math.sqrt(TARGET_AREA / (width * height))
    new_width = max(32, round(width * scale / 32) * 32)
    new_height = max(32, round(height * scale / 32) * 32)
    if (new_width, new_height) == (width, height):
        return image
    return image.resize((new_width, new_height), Resampling.LANCZOS)
