"""Tests for the fp8_sidecar_cache patch.

Uses small real safetensors files (bf16 + float8_e4m3fn tensors) in tmp_path and
a recording fake inner loader implementing the StateDictLoader protocol -- no
GPU, no mock library. The patched StreamingModelBuilder._build_pinned_source is
not exercised end-to-end (it needs a real meta model); the loader wrapper and
the eligibility gate carry the behavior and are tested directly.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
import torch
from safetensors.torch import save_file

from ltx_core.loader.primitives import StateDict
from ltx_core.loader.sd_ops import SDOps
from services.patches import fp8_sidecar_cache as fsc


def _block_tensors() -> dict[str, torch.Tensor]:
    return {
        "transformer_blocks.0.attn1.to_q.weight": torch.zeros(4, 4, dtype=torch.float8_e4m3fn),
        "transformer_blocks.0.norm1.weight": torch.ones(4, dtype=torch.bfloat16),
        "transformer_blocks.1.attn1.to_q.weight": torch.zeros(4, 4, dtype=torch.float8_e4m3fn),
    }


def _blocks_sd_ops(keys: frozenset[str]) -> SDOps:
    return SDOps(name="sd_ops_chain_LTXV+FP8_CAST_PREQUANT_AWARE__blocks", allowed_keys=keys)


def _write_checkpoint(path: Path, model_id: str = "wandb-abc") -> None:
    # The "original" 43GB checkpoint stand-in: content irrelevant, only its
    # header metadata + stat identity are read by the sidecar machinery.
    save_file(
        {"model.diffusion_model.transformer_blocks.0.attn1.to_q.weight": torch.zeros(2, dtype=torch.bfloat16)},
        str(path),
        metadata={"encrypted_wandb_properties": model_id},
    )


class _FakeInnerLoader:
    """Records load calls; serves 'original' loads from a fixed tensor dict and
    sidecar identity-loads from the actual sidecar file."""

    def __init__(self, original_tensors: dict[str, torch.Tensor]) -> None:
        self._original = original_tensors
        self.calls: list[tuple[str, str | None]] = []  # (path, sd_ops name)

    def metadata(self, path: str) -> dict:
        return {}

    def load(self, path, sd_ops=None, device=None) -> StateDict:  # noqa: ANN001
        path_str = path if isinstance(path, str) else path[0]
        self.calls.append((path_str, sd_ops.name if sd_ops is not None else None))
        if sd_ops is None:
            # Identity load of the sidecar file itself.
            from safetensors.torch import load_file

            tensors = load_file(path_str)
        else:
            tensors = dict(self._original)
        return StateDict(
            sd=tensors,
            device=torch.device("cpu"),
            size=sum(t.numel() * t.element_size() for t in tensors.values()),
            dtype={t.dtype for t in tensors.values()},
        )


@pytest.fixture()
def setup(tmp_path: Path):
    checkpoint = tmp_path / "model-1.1.safetensors"
    _write_checkpoint(checkpoint)
    tensors = _block_tensors()
    inner = _FakeInnerLoader(tensors)
    loader = fsc._SidecarLoader(inner, str(checkpoint))
    sd_ops = _blocks_sd_ops(frozenset(tensors))
    return checkpoint, tensors, inner, loader, sd_ops


def test_miss_delegates_writes_sidecar_then_hits(setup) -> None:
    checkpoint, tensors, inner, loader, sd_ops = setup
    sidecar = fsc._sidecar_path(str(checkpoint))

    first = loader.load(str(checkpoint), sd_ops=sd_ops, device=torch.device("cpu"))

    assert inner.calls == [(str(checkpoint), sd_ops.name)], "miss must delegate with the ORIGINAL sd_ops"
    assert sidecar.exists(), "miss must write the sidecar"
    assert not list(sidecar.parent.glob("*.tmp-*")), "atomic write must leave no tmp residue"
    metadata, keys = fsc._read_header(sidecar)
    assert metadata["sidecar_format"] == fsc._SIDECAR_FORMAT
    assert metadata["original_model_id"] == "wandb-abc"
    assert metadata["sd_ops_chain"] == sd_ops.name
    assert keys == set(tensors)

    second = loader.load(str(checkpoint), sd_ops=sd_ops, device=torch.device("cpu"))

    assert inner.calls[-1] == (str(sidecar), None), "hit must identity-load the sidecar (sd_ops=None)"
    for key, tensor in first.sd.items():
        assert second.sd[key].dtype == tensor.dtype, f"dtype must round-trip for {key}"
        assert torch.equal(second.sd[key].view(torch.uint8), tensor.view(torch.uint8))


def test_non_blocks_and_none_sd_ops_pass_through(setup) -> None:
    checkpoint, tensors, inner, loader, _ = setup
    other = SDOps(name="sd_ops_chain_LTXV+FP8_CAST_PREQUANT_AWARE__non_block", allowed_keys=frozenset(tensors))

    loader.load(str(checkpoint), sd_ops=other)
    loader.load(str(checkpoint), sd_ops=None)

    assert not fsc._sidecar_path(str(checkpoint)).exists(), "only __blocks loads are intercepted"
    assert [name for _, name in inner.calls] == [other.name, None]


@pytest.mark.parametrize(
    "mutate",
    [
        # +1s, not +1ns: NTFS stores timestamps in 100ns ticks, a sub-tick bump rounds away.
        lambda cp: os.utime(cp, ns=(os.stat(cp).st_atime_ns, os.stat(cp).st_mtime_ns + 1_000_000_000)),
        lambda cp: _write_checkpoint(cp, model_id="wandb-DIFFERENT"),  # content/id + size/mtime change
    ],
    ids=["mtime", "model-id"],
)
def test_stamp_mismatch_invalidates_deletes_and_rebuilds(setup, mutate) -> None:
    checkpoint, _tensors, inner, loader, sd_ops = setup
    loader.load(str(checkpoint), sd_ops=sd_ops)
    sidecar = fsc._sidecar_path(str(checkpoint))
    assert sidecar.exists()

    mutate(checkpoint)
    loader.load(str(checkpoint), sd_ops=sd_ops)

    assert inner.calls[-1] == (str(checkpoint), sd_ops.name), "invalid sidecar must fall back to the original"
    assert sidecar.exists(), "fallback must rewrite a fresh sidecar"
    metadata, _ = fsc._read_header(sidecar)
    assert metadata["original_mtime_ns"] == str(os.stat(checkpoint).st_mtime_ns), "rewritten stamp must be current"


def test_key_set_mismatch_invalidates(setup) -> None:
    checkpoint, tensors, inner, loader, sd_ops = setup
    loader.load(str(checkpoint), sd_ops=sd_ops)

    # Same stamp, different expected partition (e.g. layer-count drift).
    smaller = _blocks_sd_ops(frozenset(list(tensors)[:1]))
    loader.load(str(checkpoint), sd_ops=smaller)

    assert inner.calls[-1] == (str(checkpoint), smaller.name), "key-set mismatch must fall back"


def test_corrupted_sidecar_deleted_and_rebuilt(setup) -> None:
    checkpoint, _tensors, inner, loader, sd_ops = setup
    loader.load(str(checkpoint), sd_ops=sd_ops)
    sidecar = fsc._sidecar_path(str(checkpoint))
    sidecar.write_bytes(b"\x00" * 16)  # garbage header

    loader.load(str(checkpoint), sd_ops=sd_ops)

    assert inner.calls[-1] == (str(checkpoint), sd_ops.name)
    metadata, _ = fsc._read_header(sidecar)
    assert metadata["sidecar_format"] == fsc._SIDECAR_FORMAT, "corrupt sidecar must be replaced by a valid one"


def test_write_skipped_when_disk_space_low(setup, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint, _tensors, inner, loader, sd_ops = setup
    monkeypatch.setattr(fsc, "_free_bytes", lambda _dir: 0)

    result = loader.load(str(checkpoint), sd_ops=sd_ops)

    assert result.sd, "the delegated load result must still be returned"
    assert not fsc._sidecar_path(str(checkpoint)).exists(), "preflight must skip the write"
    assert not list(checkpoint.parent.glob("*.tmp-*"))


def test_write_failure_is_swallowed(setup, monkeypatch: pytest.MonkeyPatch) -> None:
    checkpoint, _tensors, _inner, loader, sd_ops = setup

    def _boom(*_a: object, **_k: object) -> None:
        raise OSError("disk detached")

    monkeypatch.setattr(fsc, "_stamp", _boom)

    result = loader.load(str(checkpoint), sd_ops=sd_ops)

    assert result.sd, "write failure must never break the load"
    assert not fsc._sidecar_path(str(checkpoint)).exists()
    assert not list(checkpoint.parent.glob("*.tmp-*")), "failed write must clean up its tmp file"


def test_scale_keys_refused_on_write_and_read(setup) -> None:
    checkpoint, tensors, inner, loader, _ = setup
    scale_tensors = {**tensors, "transformer_blocks.0.attn1.to_q.weight_scale": torch.ones(1)}
    inner_with_scales = _FakeInnerLoader(scale_tensors)
    loader2 = fsc._SidecarLoader(inner_with_scales, str(checkpoint))
    sd_ops = _blocks_sd_ops(frozenset(scale_tensors))

    loader2.load(str(checkpoint), sd_ops=sd_ops)
    assert not fsc._sidecar_path(str(checkpoint)).exists(), "write must refuse *_scale keys"

    # Hand-built sidecar containing a scale key must be rejected on read.
    sidecar = fsc._sidecar_path(str(checkpoint))
    save_file(scale_tensors, str(sidecar), metadata=fsc._stamp(str(checkpoint), sd_ops.name))
    assert fsc._valid(sidecar, str(checkpoint), sd_ops) is False
    assert not sidecar.exists(), "invalid sidecar must be deleted"


def test_eligibility_gate() -> None:
    class _FakeBuilder:
        model_path: object = "ckpt.safetensors"
        model_sd_ops: SDOps | None = SDOps(name="LTXV+FP8_CAST_PREQUANT_AWARE")

    builder = _FakeBuilder()
    cuda = torch.cuda.is_available()

    assert fsc._eligible(builder) is cuda  # type: ignore[arg-type]

    builder.model_path = ("a.safetensors", "b.safetensors")
    assert fsc._eligible(builder) is False, "sharded checkpoints are not eligible"  # type: ignore[arg-type]

    builder.model_path = "ckpt.safetensors"
    builder.model_sd_ops = SDOps(name="GEMMA_LLM_KEY_OPS")
    assert fsc._eligible(builder) is False, "non-fp8 chains (e.g. Gemma) are not eligible"  # type: ignore[arg-type]

    builder.model_sd_ops = None
    assert fsc._eligible(builder) is False  # type: ignore[arg-type]


def test_sidecar_path_naming() -> None:
    p = fsc._sidecar_path(r"E:\models\ltx-2.3-22b-distilled-1.1.safetensors")
    assert p.name == "ltx-2.3-22b-distilled-1.1.fp8-blocks-cache.safetensors"
    assert str(p.parent).endswith("models")
