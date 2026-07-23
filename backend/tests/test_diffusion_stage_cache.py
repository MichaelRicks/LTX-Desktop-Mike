"""Tests for the diffusion_stage_cache patch (experiment/diffusion-stage-cache).

Uses the real (but cheap-to-construct, side-effect-free) SingleGPUModelBuilder /
StreamingModelBuilder classes from ltx_core as data holders, and a minimal fake
DiffusionStage duck-typing only the private surface diffusion_stage_cache.py reads
(_is_streaming, _prepared_builder, _build_transformer, _quantization,
_compilation_config, _dtype, _device) -- no mocking library, no real GPU, no real
checkpoint files. The cache's own internal functions are exercised directly rather
than through the real (monkeypatched) DiffusionStage._transformer_ctx, so these
tests do not depend on the patch actually being installed on the class.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from ltx_core.block_streaming import StreamingModelBuilder
from ltx_core.loader.single_gpu_model_builder import SingleGPUModelBuilder
from ltx_core.model.transformer.model import X0Model
from ltx_pipelines.utils.allocator_trim_strategy import AllocatorTrimStrategy
from services.patches import diffusion_stage_cache as dsc

# MPS disk streaming uses a small positive slot count (ltx_pipelines.utils.blocks
# passes DISK_CPU_SLOTS); any positive value exercises the same exclusion branch.
_DISK_SLOTS = 4


class _FakeModel:
    def __init__(self) -> None:
        self.freed_to: str | None = None

    def to(self, device: str) -> "_FakeModel":
        self.freed_to = device
        return self


class _FakeStage:
    """Duck-types the private DiffusionStage surface diffusion_stage_cache.py reads."""

    def __init__(
        self,
        builder: object,
        *,
        is_streaming: bool = False,
        quantization: object | None = None,
        compilation_config: object | None = None,
        dtype: str = "bf16",
        device: str = "cpu",
    ) -> None:
        self._builder = builder
        self._is_streaming = is_streaming
        self._quantization = quantization
        self._compilation_config = compilation_config
        self._dtype = dtype
        self._device = device
        self._alloc_trim_strategy = AllocatorTrimStrategy.TRIM
        self.build_count = 0

    def _prepared_builder(self) -> object:
        return self._builder

    def _build_transformer(self, **_kwargs: object) -> _FakeModel:
        self.build_count += 1
        return _FakeModel()


def _single_gpu_builder(model_path: str, loras: tuple[object, ...] = ()) -> SingleGPUModelBuilder:
    return SingleGPUModelBuilder(model_class_configurator=object, model_path=model_path, loras=loras)


class _FakeStreamingWrapper(torch.nn.Module):
    """Stands in for BlockStreamingWrapper: a real nn.Module (so X0Model accepts it)
    with recording teardown()/to()."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[str] = []

    def teardown(self) -> None:
        self.events.append("teardown")

    def to(self, device: str) -> "_FakeStreamingWrapper":  # type: ignore[override]
        self.events.append(f"to:{device}")
        return self


class _FakeStreamingBuilder(StreamingModelBuilder):
    """Real StreamingModelBuilder (so isinstance + the key's content properties work)
    whose build() returns a fake wrapper instead of touching disk/GPU."""

    def __init__(self, model_path: str, *, cpu_slots_count: int | None = None, loras: tuple[object, ...] = ()) -> None:
        super().__init__(
            model_class_configurator=object,  # type: ignore[arg-type]
            model_path=model_path,
            loras=loras,  # type: ignore[arg-type]
            cpu_slots_count=cpu_slots_count,
        )
        self.build_count = 0
        self.built: list[_FakeStreamingWrapper] = []

    def build(self, *args: object, **kwargs: object) -> _FakeStreamingWrapper:  # type: ignore[override]
        self.build_count += 1
        wrapper = _FakeStreamingWrapper()
        self.built.append(wrapper)
        return wrapper


def _streaming_stage(builder: _FakeStreamingBuilder) -> _FakeStage:
    return _FakeStage(builder, is_streaming=True)


@pytest.fixture(autouse=True)
def _reset_cache_state():
    dsc.set_enabled(True)
    dsc.set_streaming_enabled(False)
    dsc.evict()
    yield
    dsc.set_enabled(True)
    dsc.set_streaming_enabled(False)
    dsc.evict()


def test_cache_hit_reuses_model_without_rebuilding() -> None:
    stage_1 = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    stage_2 = _FakeStage(_single_gpu_builder("ckpt.safetensors"))  # separate instance, identical content

    with dsc._cached_transformer_ctx(stage_1) as model_1:
        pass
    with dsc._cached_transformer_ctx(stage_2) as model_2:
        pass

    assert stage_1.build_count == 1
    assert stage_2.build_count == 0, "stage_2 should reuse stage_1's cached build"
    assert model_1 is model_2


def test_cache_miss_on_different_checkpoint_evicts_old_model() -> None:
    stage_a = _FakeStage(_single_gpu_builder("a.safetensors"))
    stage_b = _FakeStage(_single_gpu_builder("b.safetensors"))

    with dsc._cached_transformer_ctx(stage_a) as model_a:
        pass
    with dsc._cached_transformer_ctx(stage_b) as model_b:
        pass

    assert stage_a.build_count == 1
    assert stage_b.build_count == 1
    assert model_a.freed_to == "meta", "old model must be freed before building the new one"
    assert model_b is not model_a


def test_different_loras_are_treated_as_a_different_config() -> None:
    stage_a = _FakeStage(_single_gpu_builder("ckpt.safetensors", loras=()))
    stage_b = _FakeStage(_single_gpu_builder("ckpt.safetensors", loras=(("lora.safetensors", 1.0),)))

    with dsc._cached_transformer_ctx(stage_a):
        pass
    with dsc._cached_transformer_ctx(stage_b):
        pass

    assert stage_a.build_count == 1
    assert stage_b.build_count == 1, "different LoRA set must miss the cache, not reuse stage_a's build"


def test_streaming_stage_not_cacheable_until_opted_in() -> None:
    """The streaming kind is gated on set_streaming_enabled (pushed by ltx2_server
    only in streaming_models_loading mode) -- load-bearing: IC-LoRA forces CPU-mode
    streaming stages even on full-loading cards, which must NOT session-cache."""
    stage = _streaming_stage(_FakeStreamingBuilder("ckpt.safetensors"))

    assert dsc._cacheable(stage) is False

    dsc.set_streaming_enabled(True)
    assert dsc._cacheable(stage) is True


def test_disk_mode_streaming_builder_is_not_cacheable() -> None:
    """Only CPU/RAM streaming (cpu_slots_count None, all blocks pinned) is cacheable;
    MPS disk streaming stays on the build-per-call path."""
    dsc.set_streaming_enabled(True)
    disk_stage = _streaming_stage(_FakeStreamingBuilder("ckpt.safetensors", cpu_slots_count=_DISK_SLOTS))

    assert dsc._cacheable(disk_stage) is False


class _OtherBuilder:
    """Stand-in for a non-SingleGPUModelBuilder, non-streaming builder (e.g. a multi-GPU tiled builder)."""

    model_path = "ckpt.safetensors"
    model_sd_ops = None
    module_ops: tuple[object, ...] = ()
    loras: tuple[object, ...] = ()


def test_non_single_gpu_builder_bypasses_cache_and_evicts_resident_model() -> None:
    cacheable_stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(cacheable_stage) as cached_model:
        pass
    assert dsc._cached_model is cached_model

    other_stage = _FakeStage(_OtherBuilder(), is_streaming=False)

    with dsc._cached_transformer_ctx(other_stage) as other_model:
        pass

    assert cached_model.freed_to == "meta", "resident cache must be freed before the non-cacheable build"
    assert dsc._cached_model is None
    assert other_stage.build_count == 1
    assert other_model is not cached_model


def test_disabled_bypasses_cache_and_evicts_immediately() -> None:
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage) as cached_model:
        pass
    assert dsc._cached_model is not None

    dsc.set_enabled(False)
    assert cached_model.freed_to == "meta"
    assert dsc._cached_model is None

    with dsc._cached_transformer_ctx(stage):
        pass
    with dsc._cached_transformer_ctx(stage):
        pass

    assert stage.build_count == 3, "every call rebuilds while disabled, none of them cache"
    assert dsc._cached_model is None


def test_evict_frees_and_clears_cache() -> None:
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage) as model:
        pass

    dsc.evict()

    assert model.freed_to == "meta"
    assert dsc._cached_model is None
    assert dsc._cached_key is None


def test_cache_key_self_check() -> None:
    """Mirrors the module's own __main__ self-check as a real test."""
    a = ("ckpt.safetensors", None, (), (), 1, None, "bf16", "cuda:0")
    b = ("ckpt.safetensors", None, (), (), 1, None, "bf16", "cuda:0")
    c = ("ckpt.safetensors", None, (), (), 2, None, "bf16", "cuda:0")
    assert a == b
    assert a != c


# --- hardening: dead-reference gc pass + in-use concurrency guard ------------ #


def test_evict_runs_gc_collect_before_meta_swap(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pre-free gc.collect() must run BEFORE .to('meta') (ComfyUI ordering)."""
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage) as model:
        pass

    events: list[str] = []
    monkeypatch.setattr(dsc.gc, "collect", lambda *a, **k: events.append("gc"))
    original_to = model.to

    def _record_to(device: str) -> "_FakeModel":
        events.append(f"to:{device}")
        return original_to(device)

    monkeypatch.setattr(model, "to", _record_to)

    dsc.evict()

    # cleanup_memory() runs its own gc.collect() AFTER the meta-swap, so a trailing
    # "gc" is expected; assert only that the pre-free gc precedes the meta-swap.
    assert events[:2] == ["gc", "to:meta"], f"pre-free gc must precede the meta-swap, got {events}"


def test_in_use_is_tracked_across_the_yield() -> None:
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    assert dsc._in_use == 0
    with dsc._cached_transformer_ctx(stage):
        assert dsc._in_use == 1, "model is checked out for the duration of the yield"
    assert dsc._in_use == 0, "in-use must return to zero once the caller is done"


def test_evict_while_in_use_raises_and_does_not_free() -> None:
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage) as model:
        # Simulate a concurrent evict() (e.g. an overlapping generation) while the
        # transformer is mid-denoise. It must fail loud rather than free the model.
        with pytest.raises(RuntimeError, match="in use"):
            dsc.evict()
        assert model.freed_to is None, "model must NOT be freed while in use"
        assert dsc._cached_model is model, "cache must remain intact after a rejected evict"

    # Once the caller is done, eviction works normally again.
    dsc.evict()
    assert model.freed_to == "meta"
    assert dsc._cached_model is None


def test_set_enabled_false_while_in_use_raises() -> None:
    """Toggling the cache off mid-denoise also routes through the in-use guard."""
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage):
        with pytest.raises(RuntimeError, match="in use"):
            dsc.set_enabled(False)
        # Evict runs before the flag flips, so a rejected toggle stays un-applied.
        assert dsc._enabled is True, "failed toggle-off must not half-apply"


# --- streaming (session-scoped) kind ------------------------------------------ #


def test_streaming_hit_builds_once_and_rewraps_fresh_x0model() -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    stage_1 = _streaming_stage(builder)
    stage_2 = _streaming_stage(builder)

    with dsc._cached_transformer_ctx(stage_1) as model_1:
        pass
    with dsc._cached_transformer_ctx(stage_2) as model_2:
        pass

    assert builder.build_count == 1, "stage_2 must reuse stage_1's cached streaming build"
    assert isinstance(model_1, X0Model)
    assert isinstance(model_2, X0Model)
    assert model_1 is not model_2, "each checkout gets a fresh stateless X0Model wrapper"
    assert model_1.velocity_model is model_2.velocity_model, "both wrap the SAME cached wrapper"
    assert dsc._cached_kind == "streaming"


def test_streaming_evict_tears_down_before_meta_swap() -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        pass
    wrapper = builder.built[0]

    dsc.evict()

    assert wrapper.events == ["teardown", "to:meta"], (
        "eviction must mirror _streaming_model's finally: teardown() (frees pins) "
        f"BEFORE the meta-swap, got {wrapper.events}"
    )
    assert dsc._cached_model is None
    assert dsc._cached_kind is None


def _fake_virtual_memory(available_gb: float) -> SimpleNamespace:
    return SimpleNamespace(available=int(available_gb * 2**30))


def test_generation_start_keeps_streaming_entry_when_ram_is_fine(monkeypatch: pytest.MonkeyPatch) -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        pass
    monkeypatch.setattr(dsc.psutil, "virtual_memory", lambda: _fake_virtual_memory(20.0))

    dsc.evict_for_generation_start()

    assert dsc._cached_model is not None, "session-scoped streaming entry must survive generation start"
    assert builder.built[0].events == []


def test_generation_start_evicts_streaming_entry_under_ram_pressure(monkeypatch: pytest.MonkeyPatch) -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        pass
    monkeypatch.setattr(dsc.psutil, "virtual_memory", lambda: _fake_virtual_memory(dsc._MIN_FREE_RAM_GB - 1))

    dsc.evict_for_generation_start()

    assert dsc._cached_model is None, "streaming entry must be evicted under external RAM pressure"
    assert builder.built[0].events == ["teardown", "to:meta"]


def test_generation_start_always_evicts_resident_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    """The 5090 VRAM-collision fix: a resident (VRAM) entry never survives into the
    next generation, regardless of RAM headroom."""
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage) as model:
        pass
    monkeypatch.setattr(dsc.psutil, "virtual_memory", lambda: _fake_virtual_memory(64.0))

    dsc.evict_for_generation_start()

    assert model.freed_to == "meta"
    assert dsc._cached_model is None


def test_resident_and_streaming_keys_never_collide() -> None:
    """Identical content must still miss across builder types (e.g. IC-LoRA's
    resident stage_1 vs forced-streaming stage_2 on a full-loading card)."""
    dsc.set_streaming_enabled(True)
    resident_stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    streaming_stage = _streaming_stage(_FakeStreamingBuilder("ckpt.safetensors"))

    assert dsc._cache_key(resident_stage) != dsc._cache_key(streaming_stage)


def test_streaming_checkout_tracks_in_use_and_rejects_evict() -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        assert dsc._in_use == 1
        with pytest.raises(RuntimeError, match="in use"):
            dsc.evict()
        assert builder.built[0].events == [], "wrapper must NOT be torn down while checked out"
    assert dsc._in_use == 0


def test_set_streaming_enabled_false_evicts_streaming_entry() -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        pass
    assert dsc._cached_kind == "streaming"

    dsc.set_streaming_enabled(False)

    assert dsc._cached_model is None
    assert builder.built[0].events == ["teardown", "to:meta"]
    # A resident entry is unaffected by the streaming gate.
    stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(stage):
        pass
    assert dsc._cached_kind == "resident"


def test_abnormal_exit_marks_dirty_and_next_checkout_rebuilds() -> None:
    """An exception unwinding through the denoise loop can leak BufferPool slots
    (observed live: 'BufferPool exhausted: all 2 buffers are in use' on every
    retry) -- the entry must be rebuilt, never reused."""
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with pytest.raises(RuntimeError, match="boom"):
        with dsc._cached_transformer_ctx(_streaming_stage(builder)):
            raise RuntimeError("boom")

    assert dsc._dirty is True
    assert dsc._in_use == 0, "abnormal exit must still release the checkout"
    assert builder.built[0].events == [], "dirty entry is kept (lazily evicted), not freed mid-unwind"

    with dsc._cached_transformer_ctx(_streaming_stage(builder)):
        pass

    assert builder.build_count == 2, "dirty entry must be rebuilt, not reused"
    assert builder.built[0].events == ["teardown", "to:meta"], "dirty wrapper torn down before rebuild"
    assert dsc._dirty is False, "rebuild clears the dirty flag"


def test_generation_start_evicts_dirty_streaming_entry_despite_free_ram(monkeypatch: pytest.MonkeyPatch) -> None:
    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    with pytest.raises(RuntimeError, match="boom"):
        with dsc._cached_transformer_ctx(_streaming_stage(builder)):
            raise RuntimeError("boom")
    monkeypatch.setattr(dsc.psutil, "virtual_memory", lambda: _fake_virtual_memory(64.0))

    dsc.evict_for_generation_start()

    assert dsc._cached_model is None, "dirty entry must never survive into a new generation"
    assert builder.built[0].events == ["teardown", "to:meta"]


def test_concurrent_checkout_bypasses_cache_with_isolated_build(monkeypatch: pytest.MonkeyPatch) -> None:
    """A zombie generation's checkout must not share the cached wrapper (2-slot
    BufferPool) with a new generation -- the second checkout gets an isolated
    one-shot build via the original ctx, mirroring pre-cache behavior."""
    from contextlib import contextmanager

    dsc.set_streaming_enabled(True)
    builder = _FakeStreamingBuilder("ckpt.safetensors")
    orig_calls: list[object] = []

    @contextmanager
    def _fake_orig(stage: object, **kwargs: object):
        orig_calls.append(stage)
        yield object()

    monkeypatch.setattr(dsc, "_orig_transformer_ctx", _fake_orig)

    outer_stage = _streaming_stage(builder)
    inner_stage = _streaming_stage(builder)
    with dsc._cached_transformer_ctx(outer_stage):
        assert dsc._in_use == 1
        with dsc._cached_transformer_ctx(inner_stage):
            pass
        assert orig_calls == [inner_stage], "concurrent checkout must delegate to the original ctx"
        assert builder.build_count == 1, "cached wrapper must not be rebuilt or shared"
        assert dsc._in_use == 1, "bypassed checkout must not touch the in-use counter"
    assert dsc._in_use == 0
    assert dsc._cached_model is not None, "cached entry survives a concurrent bypass"


def test_streaming_stage_bypasses_and_evicts_when_gate_is_off() -> None:
    """With the gate off (full-loading cards), a streaming stage takes the bypass
    branch and unconditionally evicts -- the original NON-CACHEABLE TRANSITIONS
    behavior (IC-LoRA repro) must be preserved."""
    cacheable_stage = _FakeStage(_single_gpu_builder("ckpt.safetensors"))
    with dsc._cached_transformer_ctx(cacheable_stage) as cached_model:
        pass
    assert dsc._cached_model is cached_model

    streaming_stage = _streaming_stage(_FakeStreamingBuilder("ckpt.safetensors"))
    orig_calls: list[object] = []

    from contextlib import contextmanager

    @contextmanager
    def _fake_orig(stage: object, **kwargs: object):
        orig_calls.append(stage)
        yield object()

    original = dsc._orig_transformer_ctx
    dsc._orig_transformer_ctx = _fake_orig  # type: ignore[assignment]
    try:
        with dsc._cached_transformer_ctx(streaming_stage):
            pass
    finally:
        dsc._orig_transformer_ctx = original  # type: ignore[assignment]

    assert cached_model.freed_to == "meta", "bypass must evict the resident entry first"
    assert dsc._cached_model is None
    assert orig_calls == [streaming_stage], "gate-off streaming must delegate to the original ctx"
