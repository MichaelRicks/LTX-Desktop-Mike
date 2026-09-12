"""Monkey-patch (EXPERIMENTAL): cache the built transformer across DiffusionStage
calls when nothing about its config actually changed.

``DiffusionStage`` "builds on each call, frees on exit" (ltx_pipelines/utils/
blocks.py) unconditionally -- it rebuilds the transformer from the checkpoint
file (disk read + fp8 cast + H2D copy) on *every* call and tears it down
(or ``.to("meta")`` + reclaim) on exit, regardless of whether the checkpoint/
LoRAs/quantization are identical to the previous call. For a two-stage
distilled pipeline where stage_1 and stage_2 build from the SAME checkpoint
with the SAME LoRAs (the common "fast" t2v/i2v case), that means loading +
fp8-casting a ~22B-param transformer from disk TWICE per generation. Measured
on an RTX 5090 (32 GB): ~40s per rebuild, ~80s of a ~132s 540p/8s generation
spent rebuilding the identical transformer twice. Measured on an RTX 3090
(24 GB, streaming): ~90-100s per rebuild, ~190s of a ~226s generation.

Patches ``_transformer_ctx``, not the public ``model_context()`` wrapper:
``DiffusionStage.__call__`` invokes ``self._transformer_ctx(video_tools=...)``
directly (blocks.py:514), never ``model_context()`` -- an earlier version of
this patch wrapped the wrong method and silently never fired. ``model_context()``
itself just forwards to ``_transformer_ctx()``, so patching the latter covers
both call sites.

TWO CACHED KINDS with different scopes:

- "resident" (``full_models_loading``, 32GB+ cards): the standard
  ``SingleGPUModelBuilder`` build held resident in VRAM. GENERATION-SCOPED --
  see below.
- "streaming" (``streaming_models_loading``, 15-30GB CUDA cards): the
  ``StreamingModelBuilder`` build in CPU/RAM mode (``cpu_slots_count is
  None``, all blocks fp8-cast + pinned in host RAM, streamed to VRAM
  per-step). SESSION-SCOPED -- survives stage_1 -> stage_2 AND across
  generations, ComfyUI-style ("pay the cold build once, evict only under
  pressure"). Gated by :func:`set_streaming_enabled`, pushed once by
  ltx2_server after resolving ``LOCAL_GENERATIONS_MODE``. This gate is
  load-bearing, not cosmetic: IC-LoRA's ``use_lora_in_stage_2`` forces a
  CPU-mode streaming stage_2 even on full-loading (5090) cards
  (``LTXIcLoraPipeline._ensure_stage_2_streams_for_lora``); without the gate
  that stage_2 would silently session-cache ~23GB of pinned host RAM on
  hardware this feature is not for. Multi-GPU tiled builders and MPS disk
  streaming (``cpu_slots_count == DISK_CPU_SLOTS``) stay excluded.

GENERATION-SCOPED for the resident kind (found live on an RTX 5090): letting a
VRAM-resident cache survive PAST the generation that built it collides with
every other component that builds fresh per call too (text encoder, VAE,
upsampler, audio decoder/vocoder) -- the next generation's text-encoder build
then has to coexist in VRAM with the still-resident transformer from the
PREVIOUS generation. Observed: a second generation's peak VRAM was reported at
~41.8 GB on a 31.82 GB card (Windows CUDA fell back to slow shared memory,
backend liveness probe failed, total generation time regressed to 143s --
worse than no cache at all). Fix: ``handlers.generation_handler.
GenerationHandler.start_generation``/``start_api_generation`` call
:func:`evict_for_generation_start` before marking a new generation as running.

SESSION-SCOPED for the streaming kind: that VRAM rationale does not apply --
the weights live in *pinned host RAM* (~23GB for the fp8-cast 22B model), not
VRAM. The wrapper does still hold SOME VRAM while cached (non-block weights
resident on GPU + 2 GPU block slots in the BufferPool + a dedicated copy
stream, est. 2-4GB), which now coexists with the next generation's
text-encode/VAE phases -- watch peak VRAM there when validating on new
hardware. :func:`evict_for_generation_start` keeps a streaming entry unless
available system RAM has dropped below ``_MIN_FREE_RAM_GB`` (external memory
pressure; for a matching-key local generation, evicting a warm entry is
strictly worse than keeping it -- the rebuild's transient working set costs
more RAM than the pinned entry it replaces). Unconditional eviction sites for
the streaming kind: pipeline unload/swap (``PipelinesHandler``: video<->image
swaps need both the VRAM slice and the pinned RAM back), checkpoint/LoRA
changes (key mismatch), the Settings toggle, and the bypass branch below.
The streaming build is reusable across calls by construction: provider/pool/
copy-stream state is shape-independent (stage_1 half-res vs stage_2 full-res
is fine -- the wrapper already runs N full forward passes per denoise run),
and RoPE caches key on model config, not resolution. torch.compile + streaming
cache is UNTESTED (the fork skips compile under SageAttention);
``_compilation_config`` is in the key, so a config change misses rather than
corrupts.

NON-CACHEABLE TRANSITIONS also evict (found live on the same RTX 5090, IC-LoRA
this time): IC-LoRA's ``use_lora_in_stage_2`` forces stage_2 onto the streaming
path (a deliberate existing VRAM-safety mechanism -- streaming halves stage_2's
resident footprint since it conditions on the full-res reference video). On a
full-loading card that stage_2 call correctly skips the cache, but skipping the
cache branch also means the cache-key-mismatch eviction below never fires --
so stage_1's cached transformer stayed resident while stage_2 built its own
streaming transformer AND did its tiled conditioning VAE encode on top of it.
Observed: reserved VRAM climbed to 41.68 GB on the 31.82 GB card and hung
there for 150+ seconds with no progress (denoising loop never started).
Fix: the non-cacheable bypass branch (disabled setting, excluded builders)
evicts unconditionally before delegating to the original method, not just the
cache-hit/miss branch.

Single-slot cache: only the most recently built transformer stays resident.
Switching to a different checkpoint/LoRA/quantization config evicts the old
one (frees it, mirroring the upstream teardown for its kind: sync +
dead-reference ``gc.collect()`` + [``teardown()`` for streaming] +
``.to("meta")`` + ``cleanup_memory()``) before building the new one -- never
holds two builds resident at once. For streaming, ``teardown()`` releases the
forward hooks and drops the pinned-block references so their
``cudaHostUnregister`` finalizers fire (mirrors _streaming_model's finally,
blocks.py:154-158). The pre-free ``gc.collect()`` mirrors ComfyUI's mandatory
cleanup_models_gc: ``.to("meta")`` only frees storage once no live reference
(a compiled wrapper / cudagraph pool) remains, so collecting dead references
first is what turns a cumulative compile-path creep into a flat reserved floor.

CONCURRENCY: the single-slot module-global cache is only correct under strict
sequentiality. That is enforced upstream by
``GenerationHandler.start_generation``/``start_api_generation``, which raise
"Generation already in progress" (under the shared state lock) for both the
GPU and API slots. As defense-in-depth for any future path that bypasses that
serialization, an ``_in_use`` counter marks a transformer checked out for the
duration of its ``yield`` (the denoising loop); ``_evict_locked`` raises rather
than freeing a model that is still in use. Note ``_lock`` guards the cache dict,
not the in-use model: it is released before ``yield``, so this counter -- not
the lock -- is what protects a mid-denoise transformer from a concurrent evict.

Cache key is the *content* of the prepared builder (checkpoint path, sd_ops,
module_ops, LoRAs) plus builder type + cpu_slots_count, quantization identity,
compilation config, dtype, and device -- not object identity -- so two
independently-constructed DiffusionStage instances (e.g. a pipeline's stage_1
and stage_2) that happen to build the same thing correctly share the cache.
The builder type + cpu_slots_count discriminants are REQUIRED, not
belt-and-suspenders: an IC-LoRA resident stage_1 and its forced-streaming
stage_2 can otherwise share an identical content key, and a streaming stage
must never "hit" a cached resident X0Model (or vice versa).
``SDOps``/``ModuleOps`` are a frozen dataclass / NamedTuple respectively
(structural equality), so this is safe: a real config difference always
produces a different key (cache miss, falls back to a normal rebuild), never
a false hit.

Toggle: ``AppSettings.diffusion_stage_cache_enabled`` (default off, surfaced in
Settings next to Torch Compile). ``GenerationHandler.start_generation``/
``start_api_generation`` push the live setting into :func:`set_enabled` on
every generation, so flipping it in Settings takes effect on the next
generation without a restart. Also settable via env
``DIFFUSION_STAGE_CACHE_ENABLED`` (default "1") as the initial value before
any setting is pushed -- e.g. for headless/dev runs. The streaming session
scope additionally requires :func:`set_streaming_enabled` (pushed by
ltx2_server from the runtime mode) and can be killed independently via env
``DIFFUSION_STAGE_CACHE_STREAMING=0``. ``DIFFUSION_STAGE_CACHE_MIN_FREE_RAM_GB``
(default 4) tunes the generation-start RAM-pressure eviction threshold.

EXPERIMENTAL: depends on DiffusionStage's private ``_is_streaming``,
``_prepared_builder()``, ``_build_transformer()``, ``_quantization``,
``_compilation_config``, ``_dtype``, ``_device`` staying as-is, on
``__call__`` continuing to route through ``_transformer_ctx``, and on the
streaming contract of ``_streaming_model``/``BlockStreamingWrapper``
(``build(device, dtype)`` -> wrapper; ``teardown()`` frees pins + ``dispose()``
metas the storage on evict, mirroring ``_streaming_model``'s finally; a fresh
``X0Model(wrapper).eval()`` per checkout) -- re-verify against
ltx_pipelines.utils.blocks on rev bumps. (1.2.0: ``_streaming_model`` swaps its
finally from a bare ``.to("meta")`` to ``teardown()`` + ``dispose()``.)

Usage:
    import services.patches.diffusion_stage_cache  # noqa: F401
"""

from __future__ import annotations

import gc
import logging
import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Literal

import psutil

from ltx_core.block_streaming import StreamingModelBuilder
from ltx_core.devices import synchronize_device
from ltx_core.loader.single_gpu_model_builder import SingleGPUModelBuilder
from ltx_core.model.transformer.model import X0Model
from ltx_pipelines.utils.blocks import DiffusionStage
from ltx_pipelines.utils.helpers import cleanup_memory

logger = logging.getLogger(__name__)

_CacheKey = tuple[object, ...]
_CacheKind = Literal["resident", "streaming"]

_lock = threading.Lock()
_enabled = os.environ.get("DIFFUSION_STAGE_CACHE_ENABLED", "1") != "0"
# Opted in by ltx2_server once LOCAL_GENERATIONS_MODE is resolved -- see the
# module docstring's TWO CACHED KINDS section for why this gate is load-bearing.
_streaming_enabled = False
_cached_key: _CacheKey | None = None
_cached_model: object | None = None
_cached_kind: _CacheKind | None = None
# Set when a checkout exits abnormally (exception/cancel unwinding through the
# denoising loop). An abnormal unwind skips the streaming wrapper's forward
# post-hooks, which can leak GPU BufferPool slots ("BufferPool exhausted: all 2
# buffers are in use" observed live after a zombie generation) -- so a dirty
# entry must never be reused: it is evicted and rebuilt on the next checkout
# (and at generation start).
_dirty = False
# >0 while a cached transformer is checked out (yielded to a caller) and possibly
# mid-denoise. The single-slot cache is only safe under strict sequentiality; this
# counter lets _evict_locked() fail loud if something tries to free a model that is
# still in use, instead of ``.to("meta")``-ing tensors another generation is reading.
_in_use = 0

# Generation-start RAM-pressure threshold for keeping a session-scoped streaming
# entry. Deliberately low: for a matching-key generation, evicting a warm entry is
# strictly worse than keeping it (see module docstring's SESSION-SCOPED section).
_MIN_FREE_RAM_GB = float(os.environ.get("DIFFUSION_STAGE_CACHE_MIN_FREE_RAM_GB", "4"))


def set_enabled(value: bool) -> None:
    """Turn the cache on/off, checked on every ``_transformer_ctx`` call.

    Pushed from ``AppSettings.diffusion_stage_cache_enabled`` by
    ``GenerationHandler.start_generation``/``start_api_generation`` on every
    generation, so a Settings toggle takes effect on the next generation
    without a server restart. Turning off evicts immediately.
    """
    global _enabled
    with _lock:
        # Evict before flipping the flag: if _evict_locked raises (a transformer is
        # in use), the toggle stays un-applied rather than half-applied.
        if not value:
            _evict_locked()
        _enabled = value


def set_streaming_enabled(value: bool) -> None:
    """Opt the streaming (session-scoped) kind in or out.

    Called once by ltx2_server after resolving ``LOCAL_GENERATIONS_MODE``
    (True only for ``streaming_models_loading``). ``DIFFUSION_STAGE_CACHE_STREAMING=0``
    is an independent kill switch for the streaming kind (the resident kind is
    unaffected). Turning off with a streaming entry cached evicts it first --
    if that raises (in use), the flag stays un-applied.
    """
    global _streaming_enabled
    effective = value and os.environ.get("DIFFUSION_STAGE_CACHE_STREAMING", "1") != "0"
    with _lock:
        if not effective and _cached_kind == "streaming":
            _evict_locked()
        _streaming_enabled = effective
    logger.info(
        "[diffusion-stage-cache] streaming session cache %s",
        "enabled" if effective else "disabled",
    )


def _cacheable(stage: DiffusionStage) -> bool:
    builder = stage._prepared_builder()  # noqa: SLF001
    if stage._is_streaming:  # noqa: SLF001
        # Only the CPU/RAM streaming mode (all blocks pinned in host RAM) is
        # session-cacheable; MPS disk streaming (small cpu_slots_count) keeps a
        # different memory model and stays on the build-per-call path.
        return (
            _streaming_enabled
            and isinstance(builder, StreamingModelBuilder)
            and builder.cpu_slots_count is None
        )
    return isinstance(builder, SingleGPUModelBuilder)


def _cache_key(stage: DiffusionStage) -> _CacheKey:
    builder = stage._prepared_builder()  # noqa: SLF001
    return (
        builder.model_path,
        builder.model_sd_ops,
        builder.module_ops,
        builder.loras,
        # Builder type + slot count discriminate resident vs streaming builds of
        # otherwise identical content (e.g. IC-LoRA's forced-streaming stage_2 on a
        # full-loading card) -- a streaming stage must never hit a resident entry.
        type(builder).__name__,
        getattr(builder, "cpu_slots_count", None),
        # Policy objects aren't structurally comparable; identity is safe here
        # since pipelines construct one QuantizationPolicy and share it by
        # reference across stage_1/stage_2.
        id(stage._quantization),  # noqa: SLF001
        stage._compilation_config,  # noqa: SLF001
        stage._dtype,  # noqa: SLF001
        stage._device,  # noqa: SLF001
    )


def _evict_locked() -> None:
    global _cached_key, _cached_model, _cached_kind
    if _in_use > 0:
        # Overlapping/concurrent generation: someone is trying to free a transformer
        # that is currently checked out (mid-denoise). The single-slot module-global
        # cache requires strict sequentiality, which GenerationHandler.start_generation
        # /start_api_generation already enforce (they raise "Generation already in
        # progress" under the shared state lock). This is defense-in-depth for any
        # future path that bypasses that serialization: fail loud instead of doing a
        # ``.to("meta")`` on tensors another generation is still reading.
        raise RuntimeError(
            "[diffusion-stage-cache] evict requested while a cached transformer is "
            "in use (mid-denoise) -- overlapping generation detected; the cache "
            "requires strict sequentiality."
        )
    if _cached_model is not None:
        synchronize_device()
        # Dead-reference GC BEFORE the meta-swap: a compiled wrapper or cudagraph
        # pool can still hold the module's storage, and ``.to("meta")`` only frees
        # storage once no live reference remains. ComfyUI runs the same mandatory
        # pre-free GC (cleanup_models_gc). This is the mechanism that decides whether
        # the compile-on soak shows a flat reserved floor (reclaim) or a slow creep
        # (leak) -- see the module docstring's GENERATION-SCOPED repro.
        gc.collect()
        if _cached_kind == "streaming":
            # Mirror _streaming_model's finally (blocks.py): teardown() releases the
            # forward hooks / disk I/O worker thread / pinned-block references so their
            # cudaHostUnregister finalizers can fire, before the storage is disposed.
            _cached_model.teardown()  # type: ignore[attr-defined]
        # 1.2.0 frees model storage via ``Disposable.dispose()`` (both gpu_model and
        # _streaming_model use it, replacing the bare ``.to("meta")``): it metas the
        # parameter / persistent-buffer storage and is shell-safe so fused LoRA weights
        # do not linger on a cached module. X0Model and BlockStreamingWrapper are both
        # ``nn.Module, Disposable``. cleanup_memory() then returns cached blocks to the OS.
        _cached_model.dispose()  # type: ignore[attr-defined]
        cleanup_memory()
    globals()["_dirty"] = False
    _cached_key, _cached_model, _cached_kind = None, None, None


def evict() -> None:
    """Free and drop any resident cached transformer, regardless of kind.

    Unconditional eviction sites: the non-cacheable bypass branch, IC-LoRA's
    stage boundary, ``set_enabled(False)``/``set_streaming_enabled(False)``,
    and ``PipelinesHandler`` unload/swap paths (a video<->image swap needs both
    the cached build's VRAM slice and, for streaming, its pinned host RAM).
    Safe to call even when nothing is cached (no-op) or when the patch is
    disabled (module-level cache is simply always empty). Raises if a cached
    transformer is currently in use (see :func:`_evict_locked`).
    """
    with _lock:
        _evict_locked()


def evict_for_generation_start() -> None:
    """Generation-start eviction with kind-dependent scope.

    Resident (VRAM) entries are always evicted -- see the module docstring's
    GENERATION-SCOPED section for the RTX 5090 repro. Streaming (pinned host
    RAM) entries are session-scoped and kept, unless available system RAM has
    fallen below ``_MIN_FREE_RAM_GB`` (external memory pressure -- e.g. the
    user opened another model-hungry app between generations).
    """
    with _lock:
        if _cached_model is None:
            return
        if _dirty:
            # A previous checkout exited abnormally -- never carry a possibly
            # slot-leaked wrapper into a new generation. If a zombie checkout is
            # still live (_in_use > 0), leave it alone: evicting would raise, and
            # the checkout-time concurrency bypass isolates the new generation.
            if _in_use == 0:
                logger.warning(
                    "[diffusion-stage-cache] evicting dirty entry at generation start"
                )
                _evict_locked()
            return
        if _cached_kind != "streaming":
            _evict_locked()
            return
        available_gb = psutil.virtual_memory().available / 2**30
        if available_gb < _MIN_FREE_RAM_GB:
            logger.warning(
                "[diffusion-stage-cache] evicting streaming entry at generation start: "
                "%.1f GB RAM available < %.1f GB threshold",
                available_gb,
                _MIN_FREE_RAM_GB,
            )
            _evict_locked()
            return
        logger.info(
            "[diffusion-stage-cache] keeping session-scoped streaming entry (%.1f GB RAM available)",
            available_gb,
        )


def _mark_free() -> None:
    """Mark that a caller is done with a cached transformer it checked out."""
    global _in_use
    with _lock:
        _in_use = max(0, _in_use - 1)


_orig_transformer_ctx = DiffusionStage._transformer_ctx  # noqa: SLF001


@contextmanager
def _cached_transformer_ctx(self: DiffusionStage, **kwargs: object) -> Iterator[object]:
    if not _enabled or not _cacheable(self):
        # A non-cacheable build (e.g. IC-LoRA's use_lora_in_stage_2 forcing stage_2
        # onto the streaming path on a full-loading card -- see module docstring's
        # NON-CACHEABLE TRANSITIONS section) needs the VRAM a still-resident cached
        # transformer is holding. Evicting only on a cache-key mismatch (below)
        # never fires for this case, since this path never touches the cache-key
        # branch at all.
        evict()
        with _orig_transformer_ctx(self, **kwargs) as model:
            yield model
        return

    global _in_use
    key = _cache_key(self)
    with _lock:
        # Concurrency check and checkout must share ONE critical section: checking
        # _in_use in a separate lock acquisition would let two threads both observe
        # 0 and then serialize into a shared checkout anyway (TOCTOU).
        concurrent = _in_use > 0
        if not concurrent:
            if _cached_key == key and _cached_model is not None and not _dirty:
                model = _cached_model
                kind = _cached_kind
                hit = True
            else:
                if _dirty and _cached_model is not None:
                    logger.warning(
                        "[diffusion-stage-cache] cached transformer is dirty (previous "
                        "checkout exited abnormally, may have leaked BufferPool slots) "
                        "-- evicting and rebuilding"
                    )
                elif _cached_key is not None:
                    logger.info(
                        "[diffusion-stage-cache] key mismatch (config changed) -- evicting before rebuild"
                    )
                _evict_locked()
                if self._is_streaming:  # noqa: SLF001
                    # Build the streaming wrapper directly (mirror _streaming_model's
                    # build half, blocks.py:151). kwargs are deliberately dropped:
                    # upstream's _streaming_transformer_ctx ignores them too. Do NOT
                    # route through _build_transformer -- its .to(target) must not be
                    # applied to the meta-blocked streaming wrapper.
                    model = self._prepared_builder().build(device=self._device, dtype=self._dtype)  # noqa: SLF001
                    kind = "streaming"
                else:
                    model = self._build_transformer(**kwargs)  # noqa: SLF001
                    kind = "resident"
                globals()["_cached_key"] = key
                globals()["_cached_model"] = model
                globals()["_cached_kind"] = kind
                hit = False
            # Mark in use BEFORE releasing the lock (not after): _evict_locked runs only
            # under _lock, so bumping the counter here closes the window between resolving
            # the model and marking it -- otherwise a concurrent evict could see _in_use==0
            # and free the model we're about to yield. This counter (not the lock, which is
            # released before the yield) is what protects the model for the whole denoise.
            _in_use += 1

    if concurrent:
        # Another checkout is live (observed in the wild: a cancelled/failed
        # generation's denoise thread still running as a zombie while a new
        # generation starts). Sharing one wrapper between concurrent forward
        # passes exhausts its 2-slot GPU BufferPool ("BufferPool exhausted: all 2
        # buffers are in use") -- pre-cache, each call had its own private
        # wrapper, so concurrency was merely wasteful. Restore exactly that:
        # bypass the cache with an isolated one-shot build and leave the cached
        # entry alone.
        logger.warning(
            "[diffusion-stage-cache] checkout requested while cached transformer is "
            "in use (overlapping generation?) -- bypassing cache with an isolated build"
        )
        with _orig_transformer_ctx(self, **kwargs) as model:
            yield model
        return

    logger.info(
        "[diffusion-stage-cache] %s %s transformer",
        "reusing" if hit else "built + cached",
        kind,
    )
    try:
        if kind == "streaming":
            # A fresh stateless X0Model wrapper per checkout, exactly as upstream's
            # _streaming_transformer_ctx yields (blocks.py:402) -- the cached object
            # is the BlockStreamingWrapper underneath.
            yield X0Model(model).eval()  # type: ignore[arg-type]
        else:
            yield model
    except BaseException:
        # Abnormal unwind (exception or cancellation) mid-denoise skips the
        # wrapper's forward post-hooks, which can leak BufferPool slots. Mark the
        # entry dirty so it is rebuilt instead of reused -- reusing a leaked-slot
        # wrapper fails every subsequent generation until eviction.
        with _lock:
            globals()["_dirty"] = True
        raise
    finally:
        _mark_free()


DiffusionStage._transformer_ctx = _cached_transformer_ctx  # type: ignore[method-assign]  # noqa: SLF001


if __name__ == "__main__":
    a = ("ckpt.safetensors", None, (), (), "SingleGPUModelBuilder", None, 1, None, "bf16", "cuda:0")
    b = ("ckpt.safetensors", None, (), (), "SingleGPUModelBuilder", None, 1, None, "bf16", "cuda:0")
    c = ("ckpt.safetensors", None, (), (), "SingleGPUModelBuilder", None, 2, None, "bf16", "cuda:0")
    d = ("ckpt.safetensors", None, (), (), "StreamingModelBuilder", None, 1, None, "bf16", "cuda:0")
    assert a == b, "identical content must compare equal (cache hit path)"
    assert a != c, "different quantization identity must compare unequal (cache miss path)"
    assert a != d, "resident and streaming builds of identical content must never share a key"
    print("diffusion_stage_cache: key-equality self-check OK")
