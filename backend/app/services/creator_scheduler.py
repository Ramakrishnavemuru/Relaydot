"""Database-backed scheduled post dispatcher; safe to restart or run on multiple workers."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import or_

from app.database import SessionLocal
from app.models.creator import ScheduledPost
from app.models.user import User
from app.schemas.social import PostCreate

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5


async def process_due_posts():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        # A crashed process can leave a claim behind. The stable client ID makes a retry idempotent.
        db.query(ScheduledPost).filter(ScheduledPost.status == "PUBLISHING",
            ScheduledPost.updated_at < now - timedelta(minutes=5)).update(
            {"status": "SCHEDULED", "next_attempt_at": now}, synchronize_session=False)
        db.commit()
        ids = [row[0] for row in db.query(ScheduledPost.id).filter(
            ScheduledPost.status == "SCHEDULED", ScheduledPost.scheduled_at <= now,
            ScheduledPost.next_attempt_at <= now).order_by(ScheduledPost.scheduled_at).limit(20)]
    for scheduled_id in ids:
        with SessionLocal() as db:
            claimed = db.query(ScheduledPost).filter_by(id=scheduled_id, status="SCHEDULED").update(
                {"status": "PUBLISHING", "updated_at": now}, synchronize_session=False)
            db.commit()
            if claimed != 1:
                continue
            row = db.get(ScheduledPost, scheduled_id)
            try:
                user = db.get(User, row.owner_id)
                if not user or user.account_state != "ACTIVE" or user.account_type != "CREATOR":
                    raise HTTPException(403, "Account cannot publish scheduled content")
                from app.routes.social import create_post
                data = PostCreate.model_validate({**row.payload, "client_id": row.client_id})
                published = await create_post(data, current=user, db=db)
                row = db.get(ScheduledPost, scheduled_id)
                row.status = "PUBLISHED"
                row.post_id = published["id"]
                row.error = None
                db.commit()
            except HTTPException as error:
                db.rollback()
                row = db.get(ScheduledPost, scheduled_id)
                row.attempts += 1
                permanent = error.status_code in {400, 401, 403, 404, 409, 422}
                row.status = "FAILED" if permanent or row.attempts >= MAX_ATTEMPTS else "SCHEDULED"
                row.error = str(error.detail)[:200]
                row.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(3600, 30 * 2 ** row.attempts))
                db.commit()
            except Exception:
                db.rollback()
                logger.error("Scheduled post delivery failed for job %s", scheduled_id)
                row = db.get(ScheduledPost, scheduled_id)
                row.attempts += 1
                row.status = "FAILED" if row.attempts >= MAX_ATTEMPTS else "SCHEDULED"
                row.error = "Publishing failed. Retry or edit this post."
                row.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(3600, 30 * 2 ** row.attempts))
                db.commit()


async def run_creator_scheduler():
    while True:
        try:
            await process_due_posts()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("Scheduled post worker cycle failed")
        await asyncio.sleep(15)
