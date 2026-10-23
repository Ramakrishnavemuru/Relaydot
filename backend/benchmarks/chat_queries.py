"""Reproducible in-memory chat query benchmark: python benchmarks/chat_queries.py."""

import json
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.models  # noqa: F401 - register all mapped tables
from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message
from app.models.user import User
from app.services.conversation_service import ConversationService
from app.services.message_service import MessageService


def benchmark() -> dict:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        users = [User(username=f"bench_{i}", display_name=f"User {i}", is_verified=True) for i in range(2)]
        db.add_all(users)
        db.flush()
        conversations = [Conversation(type="DIRECT") for _ in range(20)]
        db.add_all(conversations)
        db.flush()
        for conversation in conversations:
            db.add_all([ConversationMember(conversation_id=conversation.id, user_id=user.id) for user in users])
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for i in range(1000):
            db.add(Message(conversation_id=conversations[0].id, sender_id=users[i % 2].id,
                           content=f"Message {i}", created_at=start + timedelta(seconds=i)))
        for conversation in conversations[1:]:
            db.add(Message(conversation_id=conversation.id, sender_id=users[1].id,
                           content="Recent message", created_at=start))
        db.commit()
        user_id, conversation_id = users[0].id, conversations[0].id
        counts = {"queries": 0}

        def count_query(*_args):
            counts["queries"] += 1

        event.listen(engine, "before_cursor_execute", count_query)
        results = {}
        for size in (50, 100, 1000):
            db.expire_all()
            counts["queries"] = 0
            started = time.perf_counter()
            rows = MessageService.get_messages(db, conversation_id, user_id, limit=size)
            results[f"messages_{size}"] = {
                "rows": len(rows), "queries": counts["queries"],
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        db.expire_all()
        counts["queries"] = 0
        started = time.perf_counter()
        rows = ConversationService.list_user_conversations(db, user_id)
        results["conversations_20"] = {
            "rows": len(rows), "queries": counts["queries"],
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
        }
        results["query_plans"] = {}
        for name, statement in {
            "message_page": "SELECT id FROM messages WHERE conversation_id = 1 AND thread_root_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 100",
            "read_lookup": "SELECT message_id FROM message_reads WHERE user_id = 1 AND message_id IN (1, 2, 3)",
            "membership_lookup": "SELECT id FROM conversation_members WHERE user_id = 1 ORDER BY conversation_id",
            "latest_message": "SELECT id FROM messages WHERE conversation_id = 1 ORDER BY created_at DESC, id DESC LIMIT 1",
        }.items():
            results["query_plans"][name] = [row[3] for row in db.connection().exec_driver_sql(
                "EXPLAIN QUERY PLAN " + statement).all()]
        event.remove(engine, "before_cursor_execute", count_query)
    engine.dispose()
    return results


if __name__ == "__main__":
    print(json.dumps(benchmark(), indent=2))
