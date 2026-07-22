"""State action and invariant tests for AppState."""

from __future__ import annotations

import pytest

from runtime_config.model_download_specs import (
    DEPTH_PROCESSOR_CP_ID,
    get_latest_ltx_model_id,
    get_ltx_model_spec,
    resolve_model_path,
)
from state.app_settings import UpdateSettingsRequest
from state.app_state_types import CpuSlot, GpuSlot, ICLoraState, RetakePipelineState, VideoPipelineState


def _current_model_spec():
    return get_ltx_model_spec(get_latest_ltx_model_id())


def test_start_generation_requires_gpu(test_state):
    with pytest.raises(RuntimeError, match="No active GPU pipeline"):
        test_state.generation.start_generation("gen-1")


def test_generation_mutex_prevents_second_start(test_state, create_fake_model_files):
    create_fake_model_files()
    test_state.pipelines.load_gpu_pipeline("fast")
    test_state.generation.start_generation("gen-1")

    with pytest.raises(RuntimeError, match="Generation already in progress"):
        test_state.generation.start_generation("gen-2")


def test_download_terminal_state_is_sticky_until_next_session(test_state):
    session_id = test_state.downloads.start_download({"ltx-2.3-22b-distilled"})
    test_state.downloads.start_file("ltx-2.3-22b-distilled", "ltx-2.3-22b-distilled.safetensors")
    test_state.downloads.finish_download()

    progress = test_state.downloads.get_download_progress(session_id)
    assert progress.status == "complete"


def test_handler_attributes_are_wired(test_state):
    assert test_state.settings is not None
    assert test_state.models is not None
    assert test_state.downloads is not None
    assert test_state.text is not None
    assert test_state.pipelines is not None
    assert test_state.generation is not None
    assert test_state.video_generation is not None
    assert test_state.image_generation is not None
    assert test_state.health is not None
    assert test_state.suggest_gap_prompt is not None
    assert test_state.retake is not None
    assert test_state.ic_lora is not None


def test_rlock_allows_nested_handler_calls(test_state):
    test_state.settings.update_settings(UpdateSettingsRequest(useTorchCompile=True))
    assert test_state.state.app_settings.use_torch_compile is True


def test_mps_skips_torch_compile(test_state, fake_services, create_fake_model_files):
    create_fake_model_files()
    test_state.state.app_settings.use_torch_compile = True
    test_state.pipelines._runtime_device = "mps"  # noqa: SLF001 - explicit platform behavior assertion

    pipeline_state = test_state.pipelines.load_gpu_pipeline("fast")
    assert fake_services.fast_video_pipeline.compile_calls == 0
    assert pipeline_state.is_compiled is False


def test_retake_pipeline_eviction(test_state, create_fake_model_files):
    create_fake_model_files()
    test_state.pipelines.load_gpu_pipeline("fast")

    retake_state = test_state.pipelines.load_retake_pipeline(distilled=True)
    assert isinstance(test_state.state.gpu_slot, GpuSlot)
    assert isinstance(test_state.state.gpu_slot.active_pipeline, RetakePipelineState)
    assert test_state.state.gpu_slot.active_pipeline is retake_state

    test_state.pipelines.load_gpu_pipeline("fast")
    assert isinstance(test_state.state.gpu_slot.active_pipeline, VideoPipelineState)


def test_image_pipeline_freed_not_parked_when_loading_video(test_state, create_fake_model_files):
    """FORK behavior (see FORK.md): loading a video pipeline FREES a resident image
    pipeline outright rather than parking it in host RAM. Parking an image model
    through a video generation is dead weight that thrashes a 64 GB machine
    (bf16-read + fp8-pin working set exceeds RAM). A regression to upstream's
    parking would leave ``cpu_slot`` populated here instead of None.
    """
    create_fake_model_files(include_zit=True)
    image_pipeline = test_state.pipelines.load_image_generation_pipeline_to_gpu("z-image-turbo")
    assert isinstance(test_state.state.gpu_slot, GpuSlot)
    assert test_state.state.gpu_slot.active_pipeline is image_pipeline
    assert test_state.state.cpu_slot is None

    # Swapping to a video pipeline must free the image pipeline, not park it.
    test_state.pipelines.load_gpu_pipeline("fast")
    assert isinstance(test_state.state.gpu_slot.active_pipeline, VideoPipelineState)
    assert test_state.state.cpu_slot is None


def test_ic_lora_load_includes_depth_resources(test_state, fake_services, create_fake_model_files, create_fake_ic_lora_files):
    create_fake_model_files()
    create_fake_ic_lora_files()
    model_spec = _current_model_spec()
    lora_path = str(resolve_model_path(test_state.config.default_models_dir, model_spec.ic_loras_spec.canny_cp))
    depth_path = str(resolve_model_path(test_state.config.default_models_dir, DEPTH_PROCESSOR_CP_ID))

    ic_state = test_state.pipelines.load_ic_lora(lora_path, depth_path)

    assert isinstance(ic_state, ICLoraState)
    assert ic_state.pipeline is fake_services.ic_lora_pipeline
    assert ic_state.depth_pipeline is fake_services.depth_processor_pipeline
    assert ic_state.lora_path == lora_path
    assert ic_state.depth_model_path == depth_path


def test_ic_lora_unload_clears_preprocessing_resources(test_state, create_fake_model_files, create_fake_ic_lora_files):
    create_fake_model_files()
    create_fake_ic_lora_files()
    model_spec = _current_model_spec()
    lora_path = str(resolve_model_path(test_state.config.default_models_dir, model_spec.ic_loras_spec.canny_cp))
    depth_path = str(resolve_model_path(test_state.config.default_models_dir, DEPTH_PROCESSOR_CP_ID))
    test_state.pipelines.load_ic_lora(lora_path, depth_path)

    assert isinstance(test_state.state.gpu_slot, GpuSlot)
    assert isinstance(test_state.state.gpu_slot.active_pipeline, ICLoraState)

    test_state.pipelines.unload_gpu_pipeline()

    assert test_state.state.gpu_slot is None
