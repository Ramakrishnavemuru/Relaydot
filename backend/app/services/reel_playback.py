"""Bounded, idempotent playback accounting for new Reel sessions."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.reel import Reel, ReelPlayback, ReelView
from app.services.creator_events import audience_kind

QUALIFIED_VIEW_MS = 3000
SKIP_FRACTION = .25
MAX_EVENT_MS = 10000
MAX_SESSION_MS = 600000


def capture(db: Session, reel: Reel, user_id: int, session_id: str,
            sequence: int, event: str, delta_ms: int, position_ms: int) -> dict:
    now = datetime.now(timezone.utc)
    row = db.query(ReelPlayback).filter_by(reel_id=reel.id, user_id=user_id,
                                          session_id=session_id).first()
    if event == "START":
        if sequence != 0 or delta_ms != 0:
            raise HTTPException(400, "Playback start is invalid")
        if row:
            return {"counted": False, "qualified": row.qualified}
        row = ReelPlayback(reel_id=reel.id, user_id=user_id, session_id=session_id,
                           started_at=now, last_event_at=now,
                           audience_kind=audience_kind(db, reel.creator_id, user_id))
        db.add(row)
        db.commit()
        return {"counted": True, "qualified": False}
    if not row:
        raise HTTPException(409, "Start playback before reporting progress")
    if sequence <= row.last_sequence:
        return {"counted": False, "qualified": row.qualified}
    if row.closed:
        raise HTTPException(409, "Playback session is closed")
    if event in {"PROGRESS", "PAUSE", "SKIP", "COMPLETE"}:
        if row.state != "PLAYING" and not (event == "SKIP" and row.state == "PAUSED" and delta_ms == 0):
            raise HTTPException(409, "Playback is paused")
        elapsed = max(0, int((now - row.last_event_at.replace(tzinfo=timezone.utc)).total_seconds() * 1000))
        if delta_ms > min(MAX_EVENT_MS, elapsed + 750):
            raise HTTPException(400, "Playback duration is invalid")
        row.watched_ms = min(MAX_SESSION_MS, row.watched_ms + delta_ms)
    elif delta_ms:
        raise HTTPException(400, "This playback event cannot include watch time")
    duration_ms = round((reel.duration or 0) * 1000)
    if duration_ms and position_ms > duration_ms + 1000:
        raise HTTPException(400, "Playback position is invalid")
    if event == "COMPLETE":
        if not duration_ms or position_ms < duration_ms * .95 or row.watched_ms < duration_ms * .8:
            raise HTTPException(400, "Completion requires watching the Reel")
        row.completed = True
    elif event == "SKIP":
        row.skipped = not row.completed and row.watched_ms < min(QUALIFIED_VIEW_MS, duration_ms * SKIP_FRACTION)
        row.closed = True
    elif event == "PAUSE":
        row.state = "PAUSED"
    elif event == "RESUME":
        if row.state != "PAUSED":
            raise HTTPException(409, "Playback is already active")
        row.state = "PLAYING"
    elif event == "REPLAY":
        if not row.completed or row.replay_count >= 20:
            raise HTTPException(400, "Replay is unavailable")
        row.replay_count += 1
    if not row.qualified and row.watched_ms >= QUALIFIED_VIEW_MS:
        row.qualified = True
        if user_id != reel.creator_id:
            view = db.query(ReelView).filter(ReelView.reel_id == reel.id,
                ReelView.user_id == user_id,
                ReelView.created_at >= now - timedelta(hours=24)).first()
            if not view:
                db.add(ReelView(reel_id=reel.id, user_id=user_id, session_id=session_id,
                                watched_ms=row.watched_ms, completed=row.completed,
                                audience_kind=row.audience_kind))
            else:
                view.watched_ms = max(view.watched_ms or 0, row.watched_ms)
                view.completed = bool(view.completed or row.completed)
    row.last_sequence = sequence
    row.last_event_at = now
    db.commit()
    return {"counted": True, "qualified": row.qualified}
