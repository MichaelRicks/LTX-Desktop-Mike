"""Integration-style tests for /api/suggest-gap-prompt, /api/retake, /api/qwen-multiangle."""

from __future__ import annotations

import base64
import uuid

from services.interfaces import HttpTimeoutError
from services.ltx_api_client.ltx_api_client import LTXAPIClientError, LTXRetakeResult
from tests.http_error_assertions import assert_http_error
from tests.fakes import FakeResponse


def _gemini_ok(text: str = "Enhanced prompt text") -> FakeResponse:
    return FakeResponse(
        status_code=200,
        json_payload={"candidates": [{"content": {"parts": [{"text": text}]}}]},
    )


def _gemini_error(status: int = 429, body: str = "rate limited") -> FakeResponse:
    return FakeResponse(status_code=status, text=body)


def _gemini_empty_candidates() -> FakeResponse:
    return FakeResponse(status_code=200, json_payload={"candidates": []})


class TestSuggestGapPrompt:
    def test_happy_path_with_prompts(self, client, test_state):
        test_state.state.app_settings.gemini_api_key = "key"
        test_state.http.queue("post", _gemini_ok("A smooth transition scene"))

        r = client.post(
            "/api/suggest-gap-prompt",
            json={"beforePrompt": "sunset on a beach", "afterPrompt": "sunrise over mountains", "gapDuration": 3},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "success"
        assert data["suggested_prompt"] == "A smooth transition scene"

    def test_happy_path_with_frames(self, client, test_state, make_test_image, tmp_path):
        test_state.state.app_settings.gemini_api_key = "key"
        test_state.http.queue("post", _gemini_ok("Transition clip"))

        before_path = tmp_path / "before.png"
        after_path = tmp_path / "after.png"
        before_path.write_bytes(make_test_image().getvalue())
        after_path.write_bytes(make_test_image().getvalue())

        r = client.post(
            "/api/suggest-gap-prompt",
            json={"beforeFrame": str(before_path), "afterFrame": str(after_path)},
        )
        assert r.status_code == 200

        user_parts = test_state.http.calls[-1].json_payload["contents"][0]["parts"]
        inline_parts = [part for part in user_parts if "inlineData" in part]
        assert len(inline_parts) == 2

    def test_no_context_400(self, client, test_state):
        test_state.state.app_settings.gemini_api_key = "key"
        r = client.post("/api/suggest-gap-prompt", json={})
        assert r.status_code == 400

    def test_missing_gemini_key_400(self, client):
        r = client.post("/api/suggest-gap-prompt", json={"beforePrompt": "test"})
        assert_http_error(r, status_code=400, code="GEMINI_API_KEY_MISSING")

    def test_timeout_504(self, client, test_state):
        test_state.state.app_settings.gemini_api_key = "key"
        test_state.http.queue("post", HttpTimeoutError("timeout"))

        r = client.post("/api/suggest-gap-prompt", json={"beforePrompt": "test"})
        assert r.status_code == 504


class TestRetake:
    def _make_video(self, test_state) -> str:
        video_file = test_state.config.outputs_dir / f"retake_input_{uuid.uuid4().hex[:6]}.mp4"
        video_file.write_bytes(b"\x00" * 2048)
        return str(video_file)

    def _make_valid_video(self, test_state, *, frames: int = 9, width: int = 64, height: int = 64, fps: int = 24) -> str:
        import numpy as np
        import imageio.v2 as imageio

        video_file = test_state.config.outputs_dir / f"retake_valid_{uuid.uuid4().hex[:6]}.mp4"
        writer = imageio.get_writer(str(video_file), fps=fps, codec="libx264", macro_block_size=None)
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        for _ in range(frames):
            writer.append_data(frame)
        writer.close()
        return str(video_file)

    def _force_api(self, test_state) -> None:
        test_state.config.local_generations_mode = "unsupported"

    def _base_payload(self, video_path: str) -> dict[str, object]:
        return {
            "video_path": video_path,
            "start_time": 1.0,
            "duration": 3.0,
            "prompt": "make it dramatic",
        }

    def test_happy_path_binary_response(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.retake_result = LTXRetakeResult(
            video_bytes=b"\x00\x00\x00\x1cftypisom" + b"\x00" * 500,
            result_payload=None,
        )

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"
        assert data["video_path"]

    def test_happy_path_json_video_url(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.retake_result = LTXRetakeResult(
            video_bytes=b"\x00\x00\x00\x1cftypisom" + b"\x00" * 500,
            result_payload=None,
        )

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 200
        assert r.json()["status"] == "complete"

    def test_duration_too_short(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)

        r = client.post("/api/retake", json={"video_path": video_path, "start_time": 0, "duration": 1})
        assert r.status_code == 400

    def test_video_not_found(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        r = client.post("/api/retake", json={"video_path": "/nonexistent/video.mp4", "start_time": 0, "duration": 3})
        assert r.status_code == 400

    def test_no_api_key(self, client, test_state):
        self._force_api(test_state)
        video_path = self._make_video(test_state)
        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 400

    def test_upload_url_failure(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.raise_on_retake = LTXAPIClientError(401, "Failed to get upload URL: Unauthorized")

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 401

    def test_video_upload_failure(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.raise_on_retake = LTXAPIClientError(500, "Video upload failed: Storage error")

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 500

    def test_retake_api_422_safety_filter(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.raise_on_retake = LTXAPIClientError(422, "Content rejected by safety filters")

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 422

    def test_prompt_and_mode_forwarded(self, client, test_state):
        self._force_api(test_state)
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.retake_result = LTXRetakeResult(
            video_bytes=b"\x00\x00\x00\x1cftypisom" + b"\x00" * 500,
            result_payload=None,
        )

        client.post(
            "/api/retake",
            json={
                "video_path": video_path,
                "start_time": 2.0,
                "duration": 4.0,
                "prompt": "epic explosion",
                "mode": "replace_video",
            },
        )

        retake_call = test_state.ltx_api_client.retake_calls[-1]
        assert retake_call["prompt"] == "epic explosion"
        assert retake_call["mode"] == "replace_video"

    def test_local_retake_happy_path(self, client, test_state, create_fake_model_files):
        create_fake_model_files(include_zit=False)
        test_state.state.app_settings.use_local_text_encoder = True
        test_state.config.local_generations_mode = "full_models_loading"

        video_path = self._make_valid_video(test_state)
        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"
        assert data["video_path"]

    def test_local_retake_mode_mapping(self, client, test_state, create_fake_model_files, fake_services):
        create_fake_model_files(include_zit=False)
        test_state.state.app_settings.use_local_text_encoder = True
        test_state.config.local_generations_mode = "full_models_loading"

        video_path = self._make_valid_video(test_state)
        client.post(
            "/api/retake",
            json={
                "video_path": video_path,
                "start_time": 2.0,
                "duration": 4.0,
                "prompt": "epic explosion",
                "mode": "replace_video",
            },
        )
        retake_call = fake_services.retake_pipeline.generate_calls[-1]
        assert retake_call["regenerate_video"] is True
        assert retake_call["regenerate_audio"] is False

    def test_prefers_api_video_routes_retake_to_api(self, client, test_state, fake_services):
        test_state.config.local_generations_mode = "full_models_loading"
        test_state.state.app_settings.user_prefers_ltx_api_video_generations = True
        test_state.state.app_settings.ltx_api_key = "test-key"
        video_path = self._make_video(test_state)
        test_state.ltx_api_client.retake_result = LTXRetakeResult(
            video_bytes=b"\x00\x00\x00\x1cftypisom" + b"\x00" * 500,
            result_payload=None,
        )

        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 200
        assert r.json()["status"] == "complete"
        assert len(test_state.ltx_api_client.retake_calls) == 1
        assert len(fake_services.retake_pipeline.generate_calls) == 0

    def test_prefers_api_video_without_key_falls_back_to_local_retake(
        self,
        client,
        test_state,
        create_fake_model_files,
        fake_services,
    ):
        create_fake_model_files(include_zit=False)
        test_state.config.local_generations_mode = "full_models_loading"
        test_state.state.app_settings.user_prefers_ltx_api_video_generations = True
        test_state.state.app_settings.ltx_api_key = ""
        test_state.state.app_settings.use_local_text_encoder = True

        video_path = self._make_valid_video(test_state)
        r = client.post("/api/retake", json=self._base_payload(video_path))
        assert r.status_code == 200
        assert r.json()["status"] == "complete"
        assert len(test_state.ltx_api_client.retake_calls) == 0
        assert len(fake_services.retake_pipeline.generate_calls) == 1


class TestQwenMultiAngle:
    def _data_url(self, make_test_image) -> str:
        png_bytes = make_test_image(64, 64, "red").getvalue()
        return "data:image/png;base64," + base64.b64encode(png_bytes).decode()

    def _base_payload(self, make_test_image) -> dict[str, object]:
        return {
            "image_data_url": self._data_url(make_test_image),
            "azimuth_deg": 135.0,
            "elevation_deg": 0.0,
            "zoom": 0.6,
        }

    def test_happy_path(self, client, test_state, make_test_image, fake_services):
        r = client.post("/api/qwen-multiangle/generate", json=self._base_payload(make_test_image))
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "complete"
        assert data["image_data_url"].startswith("data:image/png;base64,")
        assert data["prompt"] == "<sks> back-right quarter view eye-level shot close-up"
        assert data["seed"] == 42
        assert len(fake_services.qwen_multiangle_pipeline.generate_calls) == 1

    def test_extra_prompt_appended(self, client, test_state, make_test_image):
        payload = self._base_payload(make_test_image)
        payload["extra_prompt"] = "dramatic lighting"
        r = client.post("/api/qwen-multiangle/generate", json=payload)
        assert r.status_code == 200
        assert r.json()["prompt"].endswith("dramatic lighting")

    def test_randomize_seed_returns_int(self, client, test_state, make_test_image):
        payload = self._base_payload(make_test_image)
        payload["seed"] = 42
        payload["randomize_seed"] = True
        r = client.post("/api/qwen-multiangle/generate", json=payload)
        assert r.status_code == 200
        assert isinstance(r.json()["seed"], int)

    def test_invalid_data_url_400(self, client, test_state):
        payload = {
            "image_data_url": "not-a-data-url",
            "azimuth_deg": 0.0,
            "elevation_deg": 0.0,
            "zoom": 1.0,
        }
        r = client.post("/api/qwen-multiangle/generate", json=payload)
        assert r.status_code == 400

    def test_pipeline_failure_surfaces_500(self, client, test_state, make_test_image, fake_services):
        fake_services.qwen_multiangle_pipeline.raise_on_generate = RuntimeError("boom")
        r = client.post("/api/qwen-multiangle/generate", json=self._base_payload(make_test_image))
        assert r.status_code == 500
