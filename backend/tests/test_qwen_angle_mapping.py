"""Unit tests for the gizmo-to-prompt bucket mapping."""

import pytest

from services.qwen_multiangle_pipeline.angle_mapping import (
    AZIMUTH_BUCKETS,
    DISTANCE_BUCKETS,
    ELEVATION_BUCKETS,
    mapping_table,
    snap_azimuth,
    snap_distance,
    snap_elevation,
    snap_pose,
)


def test_vocabulary_is_96_poses():
    assert len(AZIMUTH_BUCKETS) * len(ELEVATION_BUCKETS) * len(DISTANCE_BUCKETS) == 96


# Degrees AND phrases are both viewer-relative camera positions (verified
# empirically 2026-07-10: "left side view" renders the camera at the
# viewer's left). 45 = camera to viewer's right = "front-right quarter view".
@pytest.mark.parametrize(
    ("deg", "expected_phrase"),
    [
        (0, "front view"),
        (45, "front-right quarter view"),
        (90, "right side view"),
        (131, "back-right quarter view"),
        (180, "back view"),
        (225, "back-left quarter view"),
        (270, "left side view"),
        (315, "front-left quarter view"),
        (350, "front view"),  # wraps to nearest
        (-45, "front-left quarter view"),  # negative wraps
        (360, "front view"),
        (22.4, "front view"),  # just inside front's half-sector
        (22.6, "front-right quarter view"),  # just past the boundary
    ],
)
def test_azimuth_snapping(deg, expected_phrase):
    assert AZIMUTH_BUCKETS[snap_azimuth(deg)][1] == expected_phrase


@pytest.mark.parametrize(
    ("deg", "expected_label"),
    [
        (0, "front"),
        (45, "front-right"),
        (90, "right side"),
        (135, "back-right"),
        (180, "back"),
        (225, "back-left"),
        (270, "left side"),
        (315, "front-left"),
    ],
)
def test_azimuth_labels_are_viewer_relative(deg, expected_label):
    assert AZIMUTH_BUCKETS[snap_azimuth(deg)][2] == expected_label


@pytest.mark.parametrize(
    ("deg", "expected_phrase"),
    [
        (-90, "low-angle shot"),  # clamped by nearest
        (-30, "low-angle shot"),
        (-5, "eye-level shot"),  # the ComfyUI screenshot's exact value
        (0, "eye-level shot"),
        (14, "eye-level shot"),
        (16, "elevated shot"),
        (44, "elevated shot"),
        (46, "high-angle shot"),
        (60, "high-angle shot"),
        (90, "high-angle shot"),
    ],
)
def test_elevation_snapping(deg, expected_phrase):
    assert ELEVATION_BUCKETS[snap_elevation(deg)][1] == expected_phrase


@pytest.mark.parametrize(
    ("zoom", "expected_phrase"),
    [
        (0.3, "close-up"),
        (0.6, "close-up"),
        (0.77, "close-up"),  # geometric mean of 0.6 and 1.0 is ~0.775
        (0.78, "medium shot"),
        (1.0, "medium shot"),
        (1.33, "medium shot"),  # geometric mean of 1.0 and 1.8 is ~1.342
        (1.35, "wide shot"),
        (1.8, "wide shot"),
        (8.0, "wide shot"),  # the ComfyUI screenshot's exact value
    ],
)
def test_distance_snapping(zoom, expected_phrase):
    assert DISTANCE_BUCKETS[snap_distance(zoom)][1] == expected_phrase


def test_screenshot_pose_roundtrip():
    """The exact pose from the reference ComfyUI screenshot reproduces its prompt
    (ComfyUI's H-angle convention matches ours: viewer-relative camera position)."""
    pose = snap_pose(azimuth_deg=131, elevation_deg=-5, zoom=0.6)
    assert pose.prompt == "<sks> back-right quarter view eye-level shot close-up"


def test_prompt_format():
    pose = snap_pose(0, 0, 1.0)
    assert pose.prompt == "<sks> front view eye-level shot medium shot"


def test_mapping_table_shape():
    table = mapping_table()
    assert table["trigger"] == "<sks>"
    assert len(table["azimuths"]) == 8
    assert len(table["elevations"]) == 4
    assert len(table["distances"]) == 3
    assert all("label" in a and "phrase" in a and "deg" in a for a in table["azimuths"])
