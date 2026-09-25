from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from app.models.user import User
from app.services.call_service import CallService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/calls", tags=["Calls"])


@router.get("/config")
def get_call_config(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """Retrieve WebRTC ICE servers (STUN/TURN) configuration for call initialization."""
    return {
        "ice_servers": CallService.get_ice_servers()
    }
