"""Monkey-patch (EXPERIMENTAL): fp8 sidecar disk cache for the streaming
transformer's cold build.

The once-per-session cold build of the 22B streaming transformer reads the
~43GB bf16 checkpoint and fp8-casts every covered tensor during load
(``StreamingModelBuilder._build_pinned_source`` -> ONE ``load_state_dict``
call at block_streaming/builder.py:327 with the chained
rename+FP8_CAST_PREQUANT_AWARE sd_ops). Measured on the RTX 3090 (E: SATA
SSD): ~90-95s per cold build. This patch persists the POST-downcast block
weights to a ~22GB sidecar safetensors file beside the checkpoint
(``<stem>.fp8-blocks-cache.safetensors`` -- same next-to-the-model placement
as Krea-2's ``_nf4_transformer_cache``); later cold builds identity-load the
sidecar (~23GB read, zero cast compute, mmap via safetensors_loader_fix):
target ~40s. The first-ever build pays a one-time synchronous write (~30-45s,
clearly logged) -- a background writer would pin ~23GB of tensor refs alive
alongside the 23GB pinned copy on a 64GB box, the exact RAM regime the fork's
free-not-park divergence (FORK.md B2) exists to avoid; synchronous streaming
from the mmap-backed StateDict costs near-zero extra RAM.

SEAM: ``StreamingModelBuilder._build_pinned_source`` is patched (not
``__init__``, not the loader class): it fires only on the CUDA pinned path
(MPS DISK streaming uses ``_build_disk_source`` and never enters), and it
sits beneath BOTH diffusion_stage_cache paths (the cache's miss-build and the
cache-off ``_streaming_model`` path both funnel into ``build()``). The patch
clones the builder (``copy.copy`` -- the builder's own ``with_*`` methods use
the same cloning) and swaps in a wrapping ``StateDictLoader`` that intercepts
only the ``...__blocks``-suffixed load; everything else (config metadata, key
scan, non-block weights, LoRA files) still reads the ORIGINAL checkpoint.

SIDECAR CONTENT CONTRACT:
- Keys are POST-rename (``transformer_blocks.N....``) because the tee capture
  happens on the loader's OUTPUT; the sidecar is therefore identity-loaded
  (``sd_ops=None``), never passed back through the rename/downcast chain.
- LoRA-FREE by construction: the capture point is the load_state_dict return
  value, BEFORE ``fuse_lora_weights`` runs -- LoRA fusion re-runs on every
  build against the sidecar tensors (cheap fp8 delta fuse), so LoRA changes
  never invalidate the sidecar.
- NEVER contains ``*_scale`` keys (asserted at write; the bf16 source has
  none, and the prequant scale-fold is the one non-idempotent sd_op).

INVALIDATION (all header-only reads -- 8-byte length + JSON header, the same
technique as safetensors_metadata_fix; that module is NOT imported because
its import has heavy side effects): stamp in the sidecar's ``__metadata__``
must match the original checkpoint's resolved path + size + mtime_ns +
``encrypted_wandb_properties``, the full sd_ops chain name, and the fp8
downcast suffix list (imported from ltx_core.quantization.fp8_cast -- an
upstream change to the cast set invalidates automatically). Additionally the
sidecar's tensor key set must EQUAL the load's ``allowed_keys`` (catches
config/layer-count drift and truncated files). Any validation or read
failure: warn, delete the sidecar, fall back to the original checkpoint and
rewrite. Any write failure (including disk-full): warn and continue -- the
generation is never at risk. Writes are atomic (tmp file + ``os.replace``)
with a free-space preflight, fixing the non-atomicity gap in the Krea-2
pattern this is modeled on.

Kill switch: env ``FP8_SIDECAR_CACHE=0``. Eligibility is structural
otherwise: single-file checkpoint path, fp8 policy present in the sd_ops
chain name (excludes Gemma's pinned streaming loads in local-encoding mode
and unquantized bf16 builds, where a sidecar would be a same-size copy),
CUDA available.

EXPERIMENTAL: depends on ``StreamingModelBuilder._build_pinned_source``'s
signature and its single ``load_state_dict(self.model_path, self.model_loader,
...)`` call, ``_filtered_sd_ops``'s ``__blocks`` name suffix, the private
``_model_loader`` attribute, and ``SDOps.name``/``allowed_keys`` -- re-verify
against ltx_core.block_streaming.builder on rev bumps.

Usage:
    import services.patches.fp8_sidecar_cache  # noqa: F401
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import struct
import time
from copy import copy
from pathlib import Path

import torch

from ltx_core.block_streaming.builder import StreamingModelBuilder
from ltx_core.loader.primitives import StateDict, StateDictLoader
from ltx_core.loader.sd_ops import SDOps
from ltx_core.quantization.fp8_cast import _FP8_CAST_LINEAR_SUFFIXES  # noqa: PLC2701

logger = logging.getLogger(__name__)

_SIDECAR_SUFFIX = ".fp8-blocks-cache.safetensors"
_SIDECAR_FORMAT = "1"
_ENABLED = os.environ.get("FP8_SIDECAR_CACHE", "1") != "0"


def _sidecar_path(checkpoint: str) -> Path:
    p = Path(checkpoint)
    return p.with_name(p.stem + _SIDECAR_SUFFIX)


def _read_header(path: Path) -> tuple[dict[str, str], set[str]]:
    """Header-only safetensors read: (__metadata__, tensor key set).

    Same 8-byte-length + JSON-header technique as safetensors_metadata_fix's
    ``_read_safetensors_metadata`` (duplicated on purpose -- importing that
    patch module pulls in heavy side effects).
    """
    with open(path, "rb") as f:
        (header_len,) = struct.unpack("<Q", f.read(8))
        header = json.loads(f.read(header_len))
    metadata = {str(k): str(v) for k, v in header.pop("__metadata__", {}).items()}
    return metadata, set(header.keys())


def _free_bytes(directory: Path) -> int:
    """Module-level for test patchability."""
    return shutil.disk_usage(directory).free


def _stamp(checkpoint: str, sd_ops_name: str) -> dict[str, str]:
    resolved = Path(checkpoint).resolve()
    st = os.stat(resolved)
    try:
        original_meta, _ = _read_header(resolved)
        model_id = original_meta.get("encrypted_wandb_properties", "")
    except Exception:
        model_id = ""
    return {
        "sidecar_format": _SIDECAR_FORMAT,
        "original_path": str(resolved),
        "original_size": str(st.st_size),
        "original_mtime_ns": str(st.st_mtime_ns),
        "original_model_id": model_id,
        "sd_ops_chain": sd_ops_name,
        "fp8_downcast_suffixes": json.dumps(list(_FP8_CAST_LINEAR_SUFFIXES)),
    }


def _valid(sidecar: Path, checkpoint: str, sd_ops: SDOps) -> bool:
    """Validate the sidecar against the original + current transform identity.

    Any failure deletes the sidecar (Krea-2 corrupted-cache precedent) so the
    fallback build rewrites a fresh one.
    """
    try:
        if not sidecar.exists():
            return False
        metadata, keys = _read_header(sidecar)
        expected = _stamp(checkpoint, sd_ops.name)
        for field, value in expected.items():
            if metadata.get(field) != value:
                logger.warning(
                    "[fp8-sidecar] %s: stamp mismatch on %r (checkpoint changed or "
                    "transform drifted) -- rebuilding from the original",
                    sidecar.name,
                    field,
                )
                raise ValueError(field)
        if sd_ops.allowed_keys is None or keys != set(sd_ops.allowed_keys):
            logger.warning(
                "[fp8-sidecar] %s: tensor key set does not match the expected block "
                "partition -- rebuilding from the original",
                sidecar.name,
            )
            raise ValueError("key set")
        if any(k.endswith("_scale") for k in keys):
            raise ValueError("unexpected *_scale keys")
        return True
    except Exception:
        try:
            sidecar.unlink(missing_ok=True)
            logger.warning("[fp8-sidecar] deleted invalid sidecar %s", sidecar)
        except OSError:
            logger.warning("[fp8-sidecar] could not delete invalid sidecar %s", sidecar, exc_info=True)
        return False


def _write_sidecar(sidecar: Path, checkpoint: str, sd_ops: SDOps, result: StateDict) -> None:
    """Best-effort atomic write; never raises out (the generation must proceed)."""
    tmp = sidecar.with_name(sidecar.name + f".tmp-{os.getpid()}")
    try:
        from safetensors.torch import save_file

        tensors = {
            key: (value if value.is_contiguous() else value.contiguous())
            for key, value in result.sd.items()
            if isinstance(value, torch.Tensor)
        }
        if len(tensors) != len(result.sd):
            logger.warning("[fp8-sidecar] state dict contains non-tensor entries; skipping write")
            return
        if any(key.endswith("_scale") for key in tensors):
            logger.warning("[fp8-sidecar] refusing to write *_scale keys (non-idempotent transform)")
            return
        estimated = sum(t.numel() * t.element_size() for t in tensors.values())
        if _free_bytes(sidecar.parent) < estimated * 1.1:
            logger.warning(
                "[fp8-sidecar] skipping write: less than %.1f GB free next to the checkpoint",
                estimated * 1.1 / 2**30,
            )
            return

        start = time.time()
        logger.info(
            "[fp8-sidecar] writing %s (%.1f GB, one-time per checkpoint) ...",
            sidecar.name,
            estimated / 2**30,
        )
        save_file(tensors, str(tmp), metadata=_stamp(checkpoint, sd_ops.name))
        os.replace(tmp, sidecar)
        logger.info("[fp8-sidecar] wrote %s (%.1f GB) in %.1fs", sidecar.name, estimated / 2**30, time.time() - start)
    except Exception:
        logger.warning("[fp8-sidecar] write failed; continuing without a sidecar", exc_info=True)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


class _SidecarLoader:
    """StateDictLoader wrapper: serve/capture the ``__blocks`` load via the sidecar."""

    def __init__(self, inner: StateDictLoader, checkpoint: str) -> None:
        self._inner = inner
        self._checkpoint = checkpoint

    def metadata(self, path: str) -> dict:
        return self._inner.metadata(path)

    def load(
        self,
        path: str | list[str],
        sd_ops: SDOps | None = None,
        device: torch.device | None = None,
    ) -> StateDict:
        if sd_ops is None or not sd_ops.name.endswith("__blocks") or sd_ops.allowed_keys is None:
            return self._inner.load(path, sd_ops=sd_ops, device=device)

        sidecar = _sidecar_path(self._checkpoint)
        if _valid(sidecar, self._checkpoint, sd_ops):
            logger.info(
                "[fp8-sidecar] loading pre-downcast block weights from %s (skips the "
                "43GB bf16 read + fp8 cast)",
                sidecar.name,
            )
            # Identity load: keys are already post-rename, dtypes post-downcast.
            return self._inner.load(str(sidecar), sd_ops=None, device=device)

        result = self._inner.load(path, sd_ops=sd_ops, device=device)
        _write_sidecar(sidecar, self._checkpoint, sd_ops, result)
        return result


def _eligible(builder: StreamingModelBuilder) -> bool:
    return (
        _ENABLED
        and isinstance(builder.model_path, str)
        and builder.model_sd_ops is not None
        and "FP8_CAST_PREQUANT_AWARE" in builder.model_sd_ops.name
        and torch.cuda.is_available()
    )


_orig_build_pinned_source = StreamingModelBuilder._build_pinned_source  # noqa: SLF001


def _patched_build_pinned_source(self: StreamingModelBuilder, *args: object, **kwargs: object) -> object:
    if not _eligible(self):
        return _orig_build_pinned_source(self, *args, **kwargs)  # type: ignore[arg-type]
    # copy.copy mirrors the builder's own with_* cloning; only the loader differs.
    clone = copy(self)
    clone._model_loader = _SidecarLoader(self.model_loader, str(self.model_path))  # noqa: SLF001
    return _orig_build_pinned_source(clone, *args, **kwargs)  # type: ignore[arg-type]


StreamingModelBuilder._build_pinned_source = _patched_build_pinned_source  # type: ignore[method-assign]  # noqa: SLF001
