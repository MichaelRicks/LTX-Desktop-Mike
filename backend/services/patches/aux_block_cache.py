"""Monkey-patch (EXPERIMENTAL): session-scoped cache for the small aux models
rebuilt on every generation.

Each generation rebuilds five small models from the checkpoint on EVERY call
(ltx_pipelines/utils/blocks.py, "builds on call, frees on exit"): the VAE
encoder (built twice per i2v gen: ImageConditioner at gen start and again
inside VideoUpsampler between stages), the spatial upsampler, the video
decoder, and the audio decoder + vocoder. Measured on the RTX 3090 (warm
35.2s gen, session log 2026-07-22): ~3-4s of a warm generation is this build
churn. This patch caches the BUILT models across calls and generations, the
Phase B companion to diffusion_stage_cache's transformer cache.

Unlike the transformer cache this is a MULTI-SLOT dict keyed on builder
content: the entries are small bf16 modules held VRAM-RESIDENT (est. ~2-4GB
total; the 3090 shows 17-22GB free during denoise). ImageConditioner's and
VideoUpsampler's encoder builders are constructed from identical constants +
checkpoint, so they share ONE cache entry by content key.

Gated to streaming mode (``set_streaming_enabled`` pushed by ltx2_server,
``streaming_models_loading`` only) exactly like the transformer cache: the
gate structurally excludes full-loading (5090-class) cards, so the documented
5090 VRAM-collision incident (a 23GB VRAM-resident transformer surviving into
the next generation's builds) cannot recur here -- and the aux set is an
order of magnitude smaller besides. Aux entries do NOT participate in the
generation-start RAM check (they are VRAM, not pinned host RAM) and are kept
across generations unconditionally; eviction happens at the same
PipelinesHandler unload/swap/image-load sites as the transformer cache
(paired explicit calls -- no facade, greppable), on the shared Settings
toggle, and on the streaming-gate kill switch.

NO DIRTY TRACKING (divergence from diffusion_stage_cache): its dirty flag
exists because an abnormal unwind skips the streaming wrapper's forward
post-hooks and leaks BufferPool slots. Aux modules are plain stateless
nn.Modules -- no pools, no hooks, no cross-call state; an exception
mid-decode leaves them bit-identical.

THE BYPASS BRANCH DOES NOT EVICT (second divergence): the transformer
cache's bypass evicts because a non-cacheable build needs the 23GB the cache
holds; evicting five warm ~GB-scale models because one call was a zombie
bypass would thrash for no memory benefit.

CONCURRENCY: same in-use bypass as the transformer cache (zombie
generations observed live 2026-07-22): a checkout that finds the entry
checked out falls back to the original build-per-call path -- concurrent
sharing of one module across CUDA streams is unproven, and pre-cache each
call had a private model, so the bypass restores exactly that. Lookup and
in-use bump share ONE critical section (TOCTOU).

VideoDecoder specifics: upstream returns ``_cleanup_iter(decoder.decode_video
(...), decoder)`` whose gpu_model teardown meta-swaps the decoder when the
chunk iterator is exhausted OR abandoned (GeneratorExit). The cached path
must therefore ``yield from decode_video`` WITHOUT gpu_model; the checkout
happens at first ``next()`` (a never-iterated generator must not leak
in_use), and the ``finally`` releases + ``cleanup_memory()`` (allocator trim,
NO meta-swap) on both exhaustion and abandonment. A caller-supplied custom
``decoder_builder`` (the multi-GPU path) is excluded via the same
``isinstance(builder, SingleGPUModelBuilder)`` check the transformer cache
uses.

EXCLUDED: PromptEncoder -- in API-encoding mode the fork's text-encoder
patches return before any build, so caching buys nothing (future work for
local-Gemma users); AudioConditioner -- unused by the fast video pipeline.

EXPERIMENTAL: depends on the private surfaces ``ImageConditioner
._encoder_builder/_dtype/_device``, ``VideoUpsampler._encoder_builder/
_upsampler_builder``, ``VideoDecoder._decoder_builder``, ``AudioDecoder
._decoder_builder/_vocoder_builder`` (+ each ``__call__`` body, incl. the
vocoder's effective-dtype rule: fp32 on MPS, build dtype elsewhere) -- re-
verify against ltx_pipelines.utils.blocks on rev bumps.

Usage:
    import services.patches.aux_block_cache  # noqa: F401
"""

from __future__ import annotations

import gc
import logging
import os
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import TypeVar

import torch

from ltx_core.devices import synchronize_device
from ltx_core.loader.single_gpu_model_builder import SingleGPUModelBuilder
from ltx_pipelines.utils import blocks as _blocks
from ltx_pipelines.utils.blocks import (
    AudioDecoder,
    ImageConditioner,
    VideoDecoder,
    VideoUpsampler,
)
from ltx_pipelines.utils.helpers import cleanup_memory

logger = logging.getLogger(__name__)

_T = TypeVar("_T")
_CacheKey = tuple[object, ...]

_lock = threading.Lock()
_enabled = os.environ.get("AUX_BLOCK_CACHE_ENABLED", "1") != "0"
_streaming_enabled = False


@dataclass
class _Entry:
    model: torch.nn.Module
    in_use: int = field(default=0)


_cache: dict[_CacheKey, _Entry] = {}


def set_enabled(value: bool) -> None:
    """Pushed alongside diffusion_stage_cache.set_enabled from the shared
    Settings toggle at every generation start. Turning off evicts immediately."""
    global _enabled
    with _lock:
        if not value:
            _evict_locked()
        _enabled = value


def set_streaming_enabled(value: bool) -> None:
    """Opted in by ltx2_server for streaming_models_loading only (same
    load-bearing gate as the transformer cache). Env kill switch:
    AUX_BLOCK_CACHE_STREAMING=0."""
    global _streaming_enabled
    effective = value and os.environ.get("AUX_BLOCK_CACHE_STREAMING", "1") != "0"
    with _lock:
        if not effective:
            _evict_locked()
        _streaming_enabled = effective
    logger.info("[aux-block-cache] session cache %s", "enabled" if effective else "disabled")


def _evict_locked() -> None:
    busy = [key for key, entry in _cache.items() if entry.in_use > 0]
    if busy:
        raise RuntimeError(
            "[aux-block-cache] evict requested while cached models are in use "
            f"(mid-generation): {busy!r} -- overlapping generation detected."
        )
    if _cache:
        synchronize_device()
        gc.collect()
        for entry in _cache.values():
            entry.model.to("meta")
        cleanup_memory()
    _cache.clear()


def evict() -> None:
    """Free and drop all cached aux models.

    Called by PipelinesHandler at the same unload/swap/image-load sites as
    diffusion_stage_cache.evict(). Safe when empty; raises if any entry is
    checked out (see _evict_locked)."""
    with _lock:
        _evict_locked()


def _cacheable(builder: object, device: torch.device) -> bool:
    return (
        _enabled
        and _streaming_enabled
        and device.type == "cuda"  # MPS unified memory: resident aux competes with system RAM
        and isinstance(builder, SingleGPUModelBuilder)  # excludes multi-GPU custom decoder builders
    )


def _key(builder: SingleGPUModelBuilder, dtype: torch.dtype, device: torch.device) -> _CacheKey:
    # Content key in the transformer cache's style; dtype is the EFFECTIVE
    # build dtype (the vocoder is fp32 on MPS). registry deliberately excluded
    # (a caching layer, not content).
    return (
        builder.model_path,
        builder.model_sd_ops,
        builder.module_ops,
        builder.loras,
        type(builder).__name__,
        dtype,
        device,
    )


def _checkout(
    builder: SingleGPUModelBuilder, dtype: torch.dtype, device: torch.device, kind: str
) -> _Entry | None:
    """Resolve-or-build and mark in use in ONE critical section (TOCTOU).

    Returns None when the entry is already checked out (zombie/overlapping
    generation) -- the caller must fall back to the original build-per-call
    path rather than share a module across concurrent CUDA streams."""
    key = _key(builder, dtype, device)
    with _lock:
        entry = _cache.get(key)
        if entry is not None and entry.in_use > 0:
            return None
        if entry is None:
            model = builder.build(device=device, dtype=dtype).eval()
            entry = _Entry(model=model)
            _cache[key] = entry
            hit = False
        else:
            hit = True
        entry.in_use += 1
    logger.info("[aux-block-cache] %s %s", "reusing" if hit else "built + cached", kind)
    return entry


def _release(entry: _Entry) -> None:
    with _lock:
        entry.in_use = max(0, entry.in_use - 1)


_orig_image_conditioner_call = ImageConditioner.__call__
_orig_video_upsampler_call = VideoUpsampler.__call__
_orig_video_decoder_call = VideoDecoder.__call__
_orig_audio_decoder_call = AudioDecoder.__call__


def _cached_image_conditioner_call(self: ImageConditioner, fn: Callable[..., _T]) -> _T:
    if not _cacheable(self._encoder_builder, self._device):  # noqa: SLF001
        return _orig_image_conditioner_call(self, fn)
    entry = _checkout(self._encoder_builder, self._dtype, self._device, "vae_encoder")  # noqa: SLF001
    if entry is None:
        logger.warning("[aux-block-cache] vae_encoder in use (overlapping generation?) -- isolated build")
        return _orig_image_conditioner_call(self, fn)
    try:
        return fn(entry.model)
    finally:
        _release(entry)


def _cached_video_upsampler_call(self: VideoUpsampler, latent: torch.Tensor) -> torch.Tensor:
    # All-or-nothing: never mix a cached half with a gpu_model-managed half.
    if not (
        _cacheable(self._encoder_builder, self._device)  # noqa: SLF001
        and _cacheable(self._upsampler_builder, self._device)  # noqa: SLF001
    ):
        return _orig_video_upsampler_call(self, latent)
    encoder = _checkout(self._encoder_builder, self._dtype, self._device, "vae_encoder")  # noqa: SLF001
    if encoder is None:
        logger.warning("[aux-block-cache] vae_encoder in use (overlapping generation?) -- isolated build")
        return _orig_video_upsampler_call(self, latent)
    try:
        upsampler = _checkout(self._upsampler_builder, self._dtype, self._device, "upsampler")  # noqa: SLF001
        if upsampler is None:
            logger.warning("[aux-block-cache] upsampler in use (overlapping generation?) -- isolated build")
            return _orig_video_upsampler_call(self, latent)
        try:
            return _blocks.upsample_video(
                latent=latent, video_encoder=encoder.model, upsampler=upsampler.model
            )
        finally:
            _release(upsampler)
    finally:
        _release(encoder)


def _cached_video_decoder_call(
    self: VideoDecoder,
    latent: torch.Tensor,
    tiling_config: object = None,
    generator: torch.Generator | None = None,
) -> Iterator[torch.Tensor]:
    if not _cacheable(self._decoder_builder, self._device):  # noqa: SLF001
        return _orig_video_decoder_call(self, latent, tiling_config, generator)  # type: ignore[arg-type]

    def _decode() -> Iterator[torch.Tensor]:
        # Checkout at first next(): a never-iterated generator must not leak in_use.
        entry = _checkout(self._decoder_builder, self._dtype, self._device, "video_decoder")  # noqa: SLF001
        if entry is None:
            logger.warning("[aux-block-cache] video_decoder in use (overlapping generation?) -- isolated build")
            yield from _orig_video_decoder_call(self, latent, tiling_config, generator)  # type: ignore[arg-type]
            return
        try:
            # No gpu_model wrapper: its teardown would meta-swap the cached
            # decoder. The finally runs on exhaustion AND GeneratorExit
            # (cancel/abandon), mirroring upstream _cleanup_iter's semantics.
            yield from entry.model.decode_video(latent, tiling_config, generator)  # type: ignore[operator]
        finally:
            _release(entry)
            cleanup_memory()  # allocator trim only -- the model stays resident

    return _decode()


def _cached_audio_decoder_call(self: AudioDecoder, latent: torch.Tensor) -> object:
    vocoder_dtype = torch.float32 if self._device.type == "mps" else self._dtype  # noqa: SLF001
    if not (
        _cacheable(self._decoder_builder, self._device)  # noqa: SLF001
        and _cacheable(self._vocoder_builder, self._device)  # noqa: SLF001
    ):
        return _orig_audio_decoder_call(self, latent)
    decoder = _checkout(self._decoder_builder, self._dtype, self._device, "audio_decoder")  # noqa: SLF001
    if decoder is None:
        logger.warning("[aux-block-cache] audio_decoder in use (overlapping generation?) -- isolated build")
        return _orig_audio_decoder_call(self, latent)
    try:
        vocoder = _checkout(self._vocoder_builder, vocoder_dtype, self._device, "vocoder")  # noqa: SLF001
        if vocoder is None:
            logger.warning("[aux-block-cache] vocoder in use (overlapping generation?) -- isolated build")
            return _orig_audio_decoder_call(self, latent)
        try:
            return _blocks.vae_decode_audio(latent, decoder.model, vocoder.model)
        finally:
            _release(vocoder)
    finally:
        _release(decoder)


ImageConditioner.__call__ = _cached_image_conditioner_call  # type: ignore[method-assign]
VideoUpsampler.__call__ = _cached_video_upsampler_call  # type: ignore[method-assign]
VideoDecoder.__call__ = _cached_video_decoder_call  # type: ignore[method-assign]
AudioDecoder.__call__ = _cached_audio_decoder_call  # type: ignore[method-assign]
