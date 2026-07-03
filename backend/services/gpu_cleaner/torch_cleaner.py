"""GPU cleanup helper service."""

from __future__ import annotations

import gc

import torch

from services.services_utils import empty_device_cache


class TorchCleaner:
    """Wraps GPU memory cleanup operations."""

    def __init__(self, device: str | torch.device = "cpu") -> None:
        self._device = device

    def cleanup(self) -> None:
        # Collect first: dropped pipelines hold reference cycles, so their
        # tensors only return to the allocator during gc — emptying the cache
        # before that releases nothing.
        gc.collect()
        empty_device_cache(self._device)
