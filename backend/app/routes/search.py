from typing import List, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.services.message_service import MessageService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("/messages", response_model=List[Dict[str, Any]])
def search_messages(
    q: str = Query(..., min_length=1, description="Message text search query"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search messages across all conversations the user is part of."""
    return MessageService.search_messages(db, current_user.id, q)
