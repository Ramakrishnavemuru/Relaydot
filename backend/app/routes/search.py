from typing import List, Dict, Any, Optional
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.services.message_service import MessageService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("/messages", response_model=List[Dict[str, Any]])
def search_messages(
    q: str = Query("", max_length=200, description="Message text search query"),
    conversation_id: Optional[int] = Query(None),
    sender: Optional[str] = Query(None, max_length=30),
    before: Optional[date] = Query(None),
    after: Optional[date] = Query(None),
    has: Optional[str] = Query(None, pattern="^(file|image)$"),
    limit: int = Query(30, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search messages across all conversations the user is part of."""
    return MessageService.search_messages(db, current_user.id, q, conversation_id=conversation_id,
        sender=sender, before=before, after=after, has=has, limit=limit, offset=offset)
