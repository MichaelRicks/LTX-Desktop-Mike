"""Shared base types for state handlers."""

from __future__ import annotations

import os
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from threading import RLock
from typing import TYPE_CHECKING, Concatenate, ParamSpec, TypeVar

from state.app_state_types import AppState

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig

_P = ParamSpec("_P")
_R = TypeVar("_R")
_S = TypeVar("_S", bound="StateHandlerBase")


class StateHandlerBase:
    """Base handler with shared state and lock references."""

    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig) -> None:
        self._state = state
        self._lock = lock
        self._config = config

    @property
    def state(self) -> AppState:
        return self._state

    @property
    def lock(self) -> RLock:
        return self._lock

    @property
    def config(self) -> RuntimeConfig:
        return self._config

    @property
    def models_dir(self) -> Path:
        """Effective models dir: env override, then custom from settings, then startup default.

        LTX_MODELS_DIR takes priority over the persisted setting because the
        settings.json round-trip (app boot -> frontend sync -> save-on-exit)
        has proven unreliable for this field in practice — an explicit env
        var set by the launcher is a hard guarantee that doesn't depend on
        that sync path working correctly.
        """
        env_override = os.environ.get("LTX_MODELS_DIR")
        if env_override:
            return Path(env_override)
        custom = self._state.app_settings.models_dir
        return Path(custom) if custom else self._config.default_models_dir


def with_state_lock(
    method: Callable[Concatenate[_S, _P], _R],
) -> Callable[Concatenate[_S, _P], _R]:
    @wraps(method)
    def wrapped(self: _S, *args: _P.args, **kwargs: _P.kwargs) -> _R:
        with self.lock:
            return method(self, *args, **kwargs)

    return wrapped
