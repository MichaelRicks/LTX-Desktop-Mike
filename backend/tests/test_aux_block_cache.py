"""Tests for the aux_block_cache patch.

Mirrors test_diffusion_stage_cache.py conventions: real (cheap, side-effect-
free) SingleGPUModelBuilder instances as data holders, duck-typed fake blocks
exercising the module's internals and patched callables directly, no mock
library, no GPU. The patched class methods are exercised through fake `self`
objects duck-typing only the private surface the patch reads.
"""

from __future__ import annotations

import pytest
import torch

from ltx_core.loader.single_gpu_model_builder import SingleGPUModelBuilder
from services.patches import aux_block_cache as abc_


class _FakeModel(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[str] = []

    def to(self, device: str) -> "_FakeModel":  # type: ignore[override]
        self.events.append(f"to:{device}")
        return self

    def eval(self) -> "_FakeModel":
        return self

    def decode_video(self, latent: object, tiling_config: object, generator: object):
        yield "chunk-0"
        yield "chunk-1"


class _FakeBuilder(SingleGPUModelBuilder):
    def __init__(self, model_path: str, loras: tuple[object, ...] = ()) -> None:
        super().__init__(model_class_configurator=object, model_path=model_path, loras=loras)  # type: ignore[arg-type]
        self.build_count = 0
        self.built: list[_FakeModel] = []

    def build(self, *args: object, **kwargs: object) -> _FakeModel:  # type: ignore[override]
        self.build_count += 1
        model = _FakeModel()
        self.built.append(model)
        return model


_CUDA = torch.device("cuda:0")


class _FakeImageConditioner:
    __call__ = abc_._cached_image_conditioner_call

    def __init__(self, builder: _FakeBuilder, device: torch.device = _CUDA) -> None:
        self._encoder_builder = builder
        self._dtype = torch.bfloat16
        self._device = device


class _FakeVideoDecoder:
    __call__ = abc_._cached_video_decoder_call

    def __init__(self, builder: object, device: torch.device = _CUDA) -> None:
        self._decoder_builder = builder
        self._dtype = torch.bfloat16
        self._device = device
        self.orig_calls = 0


@pytest.fixture(autouse=True)
def _reset_cache_state():
    abc_.set_enabled(True)
    abc_.set_streaming_enabled(True)
    abc_.evict()
    yield
    abc_.set_enabled(True)
    abc_.set_streaming_enabled(False)
    abc_.evict()


def test_hit_reuses_model_across_block_instances() -> None:
    builder = _FakeBuilder("ckpt.safetensors")
    cond_1 = _FakeImageConditioner(builder)
    cond_2 = _FakeImageConditioner(builder)

    out_1 = cond_1(lambda m: m)
    out_2 = cond_2(lambda m: m)

    assert builder.build_count == 1, "second call must reuse the cached build"
    assert out_1 is out_2
    assert abc_._cache and next(iter(abc_._cache.values())).in_use == 0


def test_identical_content_shares_one_entry() -> None:
    """ImageConditioner's and VideoUpsampler's encoder builders have identical
    content -> one shared entry (modeled with two same-content builders)."""
    builder_a = _FakeBuilder("ckpt.safetensors")
    builder_b = _FakeBuilder("ckpt.safetensors")

    _FakeImageConditioner(builder_a)(lambda m: m)
    _FakeImageConditioner(builder_b)(lambda m: m)

    assert len(abc_._cache) == 1, "identical builder content must share one cache entry"
    assert builder_a.build_count + builder_b.build_count == 1


def test_multi_slot_two_checkpoints_coexist() -> None:
    builder_a = _FakeBuilder("a.safetensors")
    builder_b = _FakeBuilder("b.safetensors")

    _FakeImageConditioner(builder_a)(lambda m: m)
    _FakeImageConditioner(builder_b)(lambda m: m)

    assert len(abc_._cache) == 2
    assert builder_a.built[0].events == [], "multi-slot cache must not cross-evict"


@pytest.mark.parametrize(
    "setup_gate",
    [
        lambda: abc_.set_enabled(False),
        lambda: abc_.set_streaming_enabled(False),
    ],
    ids=["disabled", "streaming-off"],
)
def test_gates_delegate_to_original(monkeypatch: pytest.MonkeyPatch, setup_gate) -> None:
    orig_calls: list[object] = []
    monkeypatch.setattr(abc_, "_orig_image_conditioner_call", lambda self, fn: orig_calls.append(self))
    setup_gate()
    builder = _FakeBuilder("ckpt.safetensors")
    cond = _FakeImageConditioner(builder)

    cond(lambda m: m)

    assert orig_calls == [cond], "gated-off call must delegate to the original"
    assert builder.build_count == 0
    assert not abc_._cache


def test_non_cuda_device_and_non_single_gpu_builder_delegate(monkeypatch: pytest.MonkeyPatch) -> None:
    orig_calls: list[str] = []
    monkeypatch.setattr(abc_, "_orig_image_conditioner_call", lambda self, fn: orig_calls.append("ic"))
    monkeypatch.setattr(
        abc_, "_orig_video_decoder_call", lambda self, latent, tc, gen: iter(orig_calls.append("vd") or [])
    )

    _FakeImageConditioner(_FakeBuilder("ckpt.safetensors"), device=torch.device("mps"))(lambda m: m)

    class _CustomBuilder:  # multi-GPU style, not a SingleGPUModelBuilder
        pass

    list(_FakeVideoDecoder(_CustomBuilder())("latent"))

    assert orig_calls == ["ic", "vd"]
    assert not abc_._cache


def test_effective_dtype_keys_differ() -> None:
    builder = _FakeBuilder("ckpt.safetensors")
    key_bf16 = abc_._key(builder, torch.bfloat16, _CUDA)
    key_fp32 = abc_._key(builder, torch.float32, _CUDA)
    assert key_bf16 != key_fp32, "vocoder's effective dtype must produce a distinct key"


def test_evict_frees_all_and_clears() -> None:
    builder_a = _FakeBuilder("a.safetensors")
    builder_b = _FakeBuilder("b.safetensors")
    _FakeImageConditioner(builder_a)(lambda m: m)
    _FakeImageConditioner(builder_b)(lambda m: m)

    abc_.evict()

    assert builder_a.built[0].events == ["to:meta"]
    assert builder_b.built[0].events == ["to:meta"]
    assert not abc_._cache
    abc_.evict()  # safe when empty


def test_evict_raises_while_checked_out() -> None:
    builder = _FakeBuilder("ckpt.safetensors")
    cond = _FakeImageConditioner(builder)

    def _inside(model: object) -> object:
        with pytest.raises(RuntimeError, match="in use"):
            abc_.evict()
        assert builder.built[0].events == [], "model must NOT be freed while checked out"
        return model

    cond(_inside)
    abc_.evict()  # released -> eviction succeeds
    assert builder.built[0].events == ["to:meta"]


def test_in_use_bypass_delegates_and_preserves_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    orig_calls: list[object] = []
    monkeypatch.setattr(abc_, "_orig_image_conditioner_call", lambda self, fn: orig_calls.append(self))
    builder = _FakeBuilder("ckpt.safetensors")
    outer = _FakeImageConditioner(builder)
    inner = _FakeImageConditioner(builder)

    def _nested(model: object) -> object:
        inner(lambda m: m)  # same entry currently checked out -> must bypass
        return model

    outer(_nested)

    assert orig_calls == [inner], "concurrent checkout must delegate to the original"
    assert builder.build_count == 1, "cached model must not be rebuilt or shared"
    assert len(abc_._cache) == 1 and next(iter(abc_._cache.values())).in_use == 0


def test_video_decoder_iterator_lifecycle() -> None:
    builder = _FakeBuilder("ckpt.safetensors")
    decoder_block = _FakeVideoDecoder(builder)

    # (a) never-started iterator leaves no checkout
    _unused = decoder_block("latent")
    assert builder.build_count == 0, "checkout must happen at first next(), not at call"
    assert all(e.in_use == 0 for e in abc_._cache.values())

    # (b) full consumption releases
    chunks = list(decoder_block("latent"))
    assert chunks == ["chunk-0", "chunk-1"]
    assert builder.build_count == 1
    assert next(iter(abc_._cache.values())).in_use == 0

    # (c) close() after first next() releases (GeneratorExit path)
    it = decoder_block("latent")
    assert next(it) == "chunk-0"
    assert next(iter(abc_._cache.values())).in_use == 1
    it.close()
    assert next(iter(abc_._cache.values())).in_use == 0
    assert builder.build_count == 1, "reuse across iterators"
    assert builder.built[0].events == [], "cached decoder must never be meta-swapped by the iterator"


def test_set_enabled_false_evicts_and_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    builder = _FakeBuilder("ckpt.safetensors")
    _FakeImageConditioner(builder)(lambda m: m)
    assert abc_._cache

    abc_.set_enabled(False)

    assert not abc_._cache
    assert builder.built[0].events == ["to:meta"]
    orig_calls: list[object] = []
    monkeypatch.setattr(abc_, "_orig_image_conditioner_call", lambda self, fn: orig_calls.append(self))
    _FakeImageConditioner(builder)(lambda m: m)
    assert len(orig_calls) == 1


def test_key_self_check() -> None:
    a = ("ckpt", None, (), (), "SingleGPUModelBuilder", torch.bfloat16, _CUDA)
    b = ("ckpt", None, (), (), "SingleGPUModelBuilder", torch.bfloat16, _CUDA)
    c = ("ckpt", None, (), (), "SingleGPUModelBuilder", torch.float32, _CUDA)
    assert a == b
    assert a != c
