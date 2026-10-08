"""Persisted message delivery and expiry using the existing message/WebSocket pipeline."""
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import HTTPException
from app.database import SessionLocal
from app.models.message import Message, ScheduledMessage
from app.models.attachment import Attachment
from app.schemas.message import MessageCreate
from app.services.message_service import MessageService
from app.websocket.manager import manager

logger = logging.getLogger("scheduled_messages")


async def process_due_messages():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        ids = [row[0] for row in db.query(ScheduledMessage.id).filter(
            ScheduledMessage.status == "PENDING", ScheduledMessage.send_at <= now)
            .order_by(ScheduledMessage.send_at).limit(50).all()]
    for scheduled_id in ids:
        with SessionLocal() as db:
            claimed = db.query(ScheduledMessage).filter_by(id=scheduled_id, status="PENDING")\
                .update({"status": "DISPATCHING"}, synchronize_session=False)
            db.commit()
            if not claimed:
                continue
            item = db.get(ScheduledMessage, scheduled_id)
            try:
                response = await MessageService.send_message(db, item.sender_id,
                    MessageCreate(conversation_id=item.conversation_id, content=item.content,
                        message_type=item.message_type, reply_to_id=item.reply_to_id,
                        thread_root_id=item.thread_root_id,
                        expires_in_seconds=item.expires_in_seconds), scheduled_message_id=item.id)
                item.status = "SENT"
                db.commit()
                await manager.send_to_user(item.sender_id, {"event":"message.scheduled.sent",
                    "data":{"id":item.id,"message_id":response["id"]}})
            except (HTTPException, ValueError) as error:
                db.rollback()
                item = db.get(ScheduledMessage, scheduled_id)
                item.status = "FAILED"
                item.error = str(getattr(error, "detail", error))[:255]
                db.commit()
                await manager.send_to_user(item.sender_id, {"event":"message.scheduled.failed",
                    "data":{"id":item.id,"error":item.error}})
            except Exception:
                db.rollback()
                logger.exception("Scheduled delivery failed for job %s", scheduled_id)
                # Retry after a transient failure. The message's unique job ID prevents duplication.
                db.query(ScheduledMessage).filter_by(id=scheduled_id).update({"status":"PENDING"})
                db.commit()


async def expire_messages():
    with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        rows = db.query(Message).filter(Message.expires_at <= now,
            Message.deleted_at.is_(None)).order_by(Message.expires_at).limit(100).all()
        events = []
        for message in rows:
            message.content = ""
            message.deleted_at = now
            message.pinned_at = None
            db.query(Attachment).filter_by(message_id=message.id).delete()
            events.append((message.conversation_id, message.id))
        db.commit()
        for conversation_id, message_id in events:
            await manager.broadcast_to_conversation(conversation_id, {"event":"message_delete",
                "data":{"id":message_id,"conversation_id":conversation_id,
                    "is_deleted":True,"content":"This message was deleted"}}, db=db)


async def run_message_jobs():
    with SessionLocal() as db:
        db.query(ScheduledMessage).filter_by(status="DISPATCHING").update(
            {"status":"PENDING"}, synchronize_session=False)
        db.commit()
    while True:
        try:
            await process_due_messages()
            await expire_messages()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Message job tick failed")
        await asyncio.sleep(2)
