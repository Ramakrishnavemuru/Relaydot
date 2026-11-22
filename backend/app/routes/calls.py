from typing import Dict, Any
from fastapi import APIRouter, Depends, Response
from app.models.user import User
from app.services.call_service import CallService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/calls", tags=["Calls"])


@router.get("/config")
def get_call_config(response: Response, current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Retrieve WebRTC ICE servers (STUN/TURN) configuration for call initialization."""
    response.headers["Cache-Control"] = "no-store, private"
    return CallService.get_config(current_user.id)
