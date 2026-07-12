"""Route handler for POST /api/qwen-multiangle/generate."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api_types import QwenMultiAngleGenerateRequest, QwenMultiAngleGenerateResponse
from state import get_state_service
from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["qwen-multiangle"])


@router.post("/qwen-multiangle/generate", response_model=QwenMultiAngleGenerateResponse)
def route_qwen_multiangle_generate(
    req: QwenMultiAngleGenerateRequest, handler: AppHandler = Depends(get_state_service)
) -> QwenMultiAngleGenerateResponse:
    return handler.qwen_multiangle.generate(req)
