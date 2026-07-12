"""Pure mapping from continuous camera-gizmo values to the LoRA's discrete pose vocabulary.

The fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA is trained on exactly
96 named poses: 8 azimuths x 4 elevations x 3 distances. Prompts must use
the trigger format:

    <sks> {azimuth} {elevation} {distance}

e.g. "<sks> back-right quarter view eye-level shot close-up"

This module is the single source of truth for that vocabulary. The frontend
fetches the table via /api/mapping and never hardcodes it.

Conventions:
- azimuth_deg: degrees clockwise from subject-front, viewed from above.
  0 = camera in front of subject, 90 = camera to subject's right side,
  180 = behind, 270 = left side. Any real value accepted (wraps mod 360).
- elevation_deg: camera height angle. Negative = below eye level looking up
  (low-angle), positive = above looking down. Clamped to [-30, 60].
- zoom: subject-distance multiplier. 0.6 = close-up, 1.0 = medium, 1.8 = wide.
  Snapped in log space so the perceptual midpoints fall correctly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

TRIGGER = "<sks>"

# (bucket center in degrees, prompt phrase, camera-position label).
# Degrees are viewer-relative screen space: 45 = camera orbits to the
# viewer's right. The LoRA's phrases name the CAMERA'S position in the same
# viewer-relative sense — verified empirically 2026-07-10 with two eye-level
# renders: "left side view" and "front-left quarter view" both put the
# camera at the VIEWER'S left (subject's right cheek visible). So degrees
# and phrases align 1:1 with no mirroring. Beware the perceptual trap that
# caused a false bug report and a wrong "fix": in a quarter view the camera
# position and the subject's apparent facing point OPPOSITE ways — a camera
# at viewer-right shows the subject turned toward frame-left. Labels name
# the camera position; judge renders by where the camera moved, not which
# way the subject faces.
AZIMUTH_BUCKETS: tuple[tuple[float, str, str], ...] = (
    (0.0, "front view", "front"),
    (45.0, "front-right quarter view", "front-right"),
    (90.0, "right side view", "right side"),
    (135.0, "back-right quarter view", "back-right"),
    (180.0, "back view", "back"),
    (225.0, "back-left quarter view", "back-left"),
    (270.0, "left side view", "left side"),
    (315.0, "front-left quarter view", "front-left"),
)

# (bucket center in degrees, prompt phrase)
ELEVATION_BUCKETS: tuple[tuple[float, str], ...] = (
    (-30.0, "low-angle shot"),
    (0.0, "eye-level shot"),
    (30.0, "elevated shot"),
    (60.0, "high-angle shot"),
)

# (distance multiplier, prompt phrase)
DISTANCE_BUCKETS: tuple[tuple[float, str], ...] = (
    (0.6, "close-up"),
    (1.0, "medium shot"),
    (1.8, "wide shot"),
)


@dataclass(frozen=True, slots=True)
class Pose:
    """A snapped camera pose: indices into the bucket tables plus the prompt."""

    azimuth_index: int
    elevation_index: int
    distance_index: int

    @property
    def azimuth_deg(self) -> float:
        return AZIMUTH_BUCKETS[self.azimuth_index][0]

    @property
    def elevation_deg(self) -> float:
        return ELEVATION_BUCKETS[self.elevation_index][0]

    @property
    def zoom(self) -> float:
        return DISTANCE_BUCKETS[self.distance_index][0]

    @property
    def prompt(self) -> str:
        return (
            f"{TRIGGER} {AZIMUTH_BUCKETS[self.azimuth_index][1]}"
            f" {ELEVATION_BUCKETS[self.elevation_index][1]}"
            f" {DISTANCE_BUCKETS[self.distance_index][1]}"
        )


def snap_azimuth(azimuth_deg: float) -> int:
    """Nearest 45°-spaced bucket, wrapping — e.g. 350° snaps to front (0°)."""
    return round((azimuth_deg % 360.0) / 45.0) % len(AZIMUTH_BUCKETS)


def snap_elevation(elevation_deg: float) -> int:
    return min(
        range(len(ELEVATION_BUCKETS)),
        key=lambda i: abs(ELEVATION_BUCKETS[i][0] - elevation_deg),
    )


def snap_distance(zoom: float) -> int:
    """Snap in log space: the boundary between two zooms is their geometric mean."""
    z = math.log(max(zoom, 1e-6))
    return min(
        range(len(DISTANCE_BUCKETS)),
        key=lambda i: abs(math.log(DISTANCE_BUCKETS[i][0]) - z),
    )


def snap_pose(azimuth_deg: float, elevation_deg: float, zoom: float) -> Pose:
    return Pose(
        azimuth_index=snap_azimuth(azimuth_deg),
        elevation_index=snap_elevation(elevation_deg),
        distance_index=snap_distance(zoom),
    )


def mapping_table() -> dict[str, object]:
    """The full vocabulary in one JSON-ready dict, for /api/mapping."""
    return {
        "trigger": TRIGGER,
        "prompt_format": f"{TRIGGER} {{azimuth}} {{elevation}} {{distance}}",
        "azimuths": [
            {"deg": deg, "phrase": phrase, "label": label}
            for deg, phrase, label in AZIMUTH_BUCKETS
        ],
        "elevations": [{"deg": deg, "phrase": phrase} for deg, phrase in ELEVATION_BUCKETS],
        "distances": [{"zoom": z, "phrase": phrase} for z, phrase in DISTANCE_BUCKETS],
    }
