import os
import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, Request, status
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import inspect

from app.config import settings, BASE_DIR
from app.database import engine, Base, get_db, SessionLocal
from app.models.settings import Feedback
from app.models.staff import SupportCase
from app.models.auth_attempt import AuthAttempt
from app.models.auth_challenge import AuthChallenge
from app.routes import api_router
from app.websocket.manager import manager
from app.websocket.events import (
    create_event,
    EVENT_TYPING_START,
    EVENT_TYPING_STOP,
    EVENT_READ
)
from app.websocket.call_events import ALL_CALL_EVENTS
from app.websocket.signaling import CallSignalingHandler
from app.security.jwt import decode_token
from app.models.user import User
from app.models.conversation import ConversationMember
from app.services.message_service import MessageService
from app.services.chat_lock import is_chat_unlocked_token, lock_cookie_name
from app.services.scheduled_service import run_message_jobs
from app.services.reel_processor import run_reel_worker
from app.schemas.message import MessageCreate

from app.models.session import UserSession

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


def run_schema_migrations():
    """Add backward-compatible auth, story, and message columns to existing databases."""
    try:
        if engine.dialect.name == "postgresql":
            existing_tables = set(inspect(engine).get_table_names())
            with engine.begin() as conn:
                if "users" in existing_tables:
                    for column, definition in {
                        "phone_number": "VARCHAR(30)", "is_verified": "BOOLEAN DEFAULT TRUE",
                        "totp_secret": "VARCHAR(64)", "totp_enabled": "BOOLEAN DEFAULT FALSE",
                        "cover_url": "VARCHAR(500)", "website": "VARCHAR(500)",
                        "role": "VARCHAR(12) NOT NULL DEFAULT 'USER'", "account_state": "VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'",
                        "restricted_until": "TIMESTAMP", "is_private": "BOOLEAN NOT NULL DEFAULT FALSE"}.items():
                        conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {column} {definition}")
                if "user_sessions" in existing_tables:
                    conn.exec_driver_sql("ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS staff_verified_until TIMESTAMP")
                if "social_reports" in existing_tables:
                    for column, definition in {"status": "VARCHAR(20) NOT NULL DEFAULT 'NEW'", "priority": "VARCHAR(12) NOT NULL DEFAULT 'NORMAL'", "assigned_to_id": "INTEGER", "evidence": "TEXT", "resolution_reason": "VARCHAR(500)"}.items():
                        conn.exec_driver_sql(f"ALTER TABLE social_reports ADD COLUMN IF NOT EXISTS {column} {definition}")
                if "stories" in existing_tables:
                    conn.exec_driver_sql("ALTER TABLE stories ADD COLUMN IF NOT EXISTS visibility VARCHAR(12) DEFAULT 'EVERYONE'")
                if "messages" in existing_tables:
                    for column, definition in {"thread_root_id": "INTEGER", "expires_at": "TIMESTAMP",
                        "pinned_at": "TIMESTAMP", "pinned_by_id": "INTEGER",
                        "is_forwarded": "BOOLEAN DEFAULT FALSE", "scheduled_message_id": "INTEGER"}.items():
                        conn.exec_driver_sql(f"ALTER TABLE messages ADD COLUMN IF NOT EXISTS {column} {definition}")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_thread_root_id ON messages (thread_root_id)")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_expires_at ON messages (expires_at)")
                    conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_scheduled_message_id ON messages (scheduled_message_id)")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_conversation_thread_recent ON messages (conversation_id, thread_root_id, created_at, id)")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_conversation_recent ON messages (conversation_id, created_at, id)")
                if "message_reads" in existing_tables:
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_message_reads_user_message ON message_reads (user_id, message_id)")
                if "conversation_members" in existing_tables:
                    conn.exec_driver_sql("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP")
                    for column, definition in {"mute_calls": "BOOLEAN NOT NULL DEFAULT FALSE", "is_pinned": "BOOLEAN NOT NULL DEFAULT FALSE", "is_archived": "BOOLEAN NOT NULL DEFAULT FALSE", "is_favourite": "BOOLEAN NOT NULL DEFAULT FALSE", "is_hidden": "BOOLEAN NOT NULL DEFAULT FALSE", "cleared_before_message_id": "INTEGER NOT NULL DEFAULT 0", "lock_pin_hash": "VARCHAR(200)", "lock_version": "VARCHAR(40)"}.items():
                        conn.exec_driver_sql(f"ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS {column} {definition}")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_conversation_members_user_conversation ON conversation_members (user_id, conversation_id)")
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_conversation_members_conversation_user ON conversation_members (conversation_id, user_id)")
                if "scheduled_messages" in existing_tables:
                    conn.exec_driver_sql("ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS expires_in_seconds INTEGER")
                if "reel_comments" in existing_tables:
                    conn.exec_driver_sql("ALTER TABLE reel_comments ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP")
            return
        if engine.dialect.name != "sqlite":
            return
        with engine.connect() as conn:
            cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
            if cols:
                if "phone_number" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN phone_number VARCHAR(30)")
                if "is_verified" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT 1")
                if "totp_secret" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)")
                if "totp_enabled" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT 0")
                if "cover_url" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN cover_url VARCHAR(500)")
                if "website" not in cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN website VARCHAR(500)")
                for column, definition in {"role": "VARCHAR(12) NOT NULL DEFAULT 'USER'", "account_state": "VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'", "restricted_until": "DATETIME", "is_private": "BOOLEAN NOT NULL DEFAULT 0"}.items():
                    if column not in cols:
                        conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {column} {definition}")
            session_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user_sessions)").fetchall()}
            if session_cols and "staff_verified_until" not in session_cols:
                conn.exec_driver_sql("ALTER TABLE user_sessions ADD COLUMN staff_verified_until DATETIME")
            report_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(social_reports)").fetchall()}
            for column, definition in {"status": "VARCHAR(20) NOT NULL DEFAULT 'NEW'", "priority": "VARCHAR(12) NOT NULL DEFAULT 'NORMAL'", "assigned_to_id": "INTEGER", "evidence": "TEXT", "resolution_reason": "VARCHAR(500)"}.items():
                if report_cols and column not in report_cols:
                    conn.exec_driver_sql(f"ALTER TABLE social_reports ADD COLUMN {column} {definition}")
            story_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(stories)").fetchall()]
            member_cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(conversation_members)").fetchall()]
            if member_cols and "muted_until" not in member_cols:
                conn.exec_driver_sql("ALTER TABLE conversation_members ADD COLUMN muted_until DATETIME")
            for column, definition in {"mute_calls": "BOOLEAN NOT NULL DEFAULT 0", "is_pinned": "BOOLEAN NOT NULL DEFAULT 0", "is_archived": "BOOLEAN NOT NULL DEFAULT 0", "is_favourite": "BOOLEAN NOT NULL DEFAULT 0", "is_hidden": "BOOLEAN NOT NULL DEFAULT 0", "cleared_before_message_id": "INTEGER NOT NULL DEFAULT 0", "lock_pin_hash": "VARCHAR(200)", "lock_version": "VARCHAR(40)"}.items():
                if member_cols and column not in member_cols:
                    conn.exec_driver_sql(f"ALTER TABLE conversation_members ADD COLUMN {column} {definition}")
            if story_cols and "visibility" not in story_cols:
                conn.exec_driver_sql("ALTER TABLE stories ADD COLUMN visibility VARCHAR(12) DEFAULT 'EVERYONE'")
            message_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(messages)").fetchall()}
            for column, definition in {"thread_root_id": "INTEGER", "expires_at": "DATETIME",
                "pinned_at": "DATETIME", "pinned_by_id": "INTEGER",
                "is_forwarded": "BOOLEAN DEFAULT 0", "scheduled_message_id": "INTEGER"}.items():
                if message_cols and column not in message_cols:
                    conn.exec_driver_sql(f"ALTER TABLE messages ADD COLUMN {column} {definition}")
            if message_cols:
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_thread_root_id ON messages (thread_root_id)")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_expires_at ON messages (expires_at)")
                conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_scheduled_message_id ON messages (scheduled_message_id)")
                if {"conversation_id", "thread_root_id", "created_at", "id"} <= message_cols:
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_conversation_thread_recent ON messages (conversation_id, thread_root_id, created_at, id)")
                if {"conversation_id", "created_at", "id"} <= message_cols:
                    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_messages_conversation_recent ON messages (conversation_id, created_at, id)")
            if [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(message_reads)").fetchall()]:
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_message_reads_user_message ON message_reads (user_id, message_id)")
            if [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(conversation_members)").fetchall()]:
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_conversation_members_user_conversation ON conversation_members (user_id, conversation_id)")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_conversation_members_conversation_user ON conversation_members (conversation_id, user_id)")
            scheduled_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(scheduled_messages)").fetchall()}
            if scheduled_cols and "expires_in_seconds" not in scheduled_cols:
                conn.exec_driver_sql("ALTER TABLE scheduled_messages ADD COLUMN expires_in_seconds INTEGER")
            reel_comment_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(reel_comments)").fetchall()}
            if reel_comment_cols and "pinned_at" not in reel_comment_cols:
                conn.exec_driver_sql("ALTER TABLE reel_comments ADD COLUMN pinned_at DATETIME")
            conn.commit()
    except Exception as e:
        logger.warning(f"Schema migration warning: {e}")


def ensure_audit_guards():
    """Prevent routine SQL UPDATE/DELETE of privileged audit events."""
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            conn.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON moderator_audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END")
            conn.exec_driver_sql("CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON moderator_audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END")
        elif engine.dialect.name == "postgresql":
            conn.exec_driver_sql("CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit log is append-only'; END $$")
            conn.exec_driver_sql("DROP TRIGGER IF EXISTS audit_no_mutation ON moderator_audit_logs")
            conn.exec_driver_sql("CREATE TRIGGER audit_no_mutation BEFORE UPDATE OR DELETE ON moderator_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure tables created and migrated
    logger.info("Initializing database tables and migrations...")
    run_schema_migrations()
    Base.metadata.create_all(bind=engine)
    ensure_audit_guards()
    with SessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        db.query(AuthAttempt).filter(AuthAttempt.created_at < cutoff).delete()
        db.query(AuthChallenge).filter(AuthChallenge.expires_at < datetime.now(timezone.utc)).delete()
        for legacy in db.query(Feedback).all():
            if not db.query(SupportCase.id).filter_by(legacy_feedback_id=legacy.id).first():
                db.add(SupportCase(reporter_id=legacy.user_id, kind=legacy.kind,
                    category="General", title=f"{legacy.kind.title()} #{legacy.id}",
                    description=legacy.message, legacy_feedback_id=legacy.id,
                    created_at=legacy.created_at, updated_at=legacy.created_at))
        db.commit()
    logger.info("Database initialized.")
    message_jobs = asyncio.create_task(run_message_jobs())
    reel_jobs = asyncio.create_task(run_reel_worker())
    try:
        yield
    finally:
        message_jobs.cancel()
        reel_jobs.cancel()
        try:
            await message_jobs
        except asyncio.CancelledError:
            pass
        try:
            await reel_jobs
        except asyncio.CancelledError:
            pass
    # Shutdown logic if any
    logger.info("Shutting down application...")


app = FastAPI(
    title=settings.APP_NAME,
    lifespan=lifespan,
    debug=settings.DEBUG
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

@app.middleware("http")
async def protect_cookie_requests(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and (request.cookies.get("access_token") or request.cookies.get("refresh_token")):
        origin = request.headers.get("origin")
        trusted = {str(request.base_url).rstrip("/"), *[value.rstrip("/") for value in settings.ALLOWED_ORIGINS if value != "*"]}
        if (origin and origin.rstrip("/") not in trusted) or request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site request denied"}, status_code=403)
    return await call_next(request)

# Mount local uploads directory for file sharing
if os.path.exists(settings.UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# Include REST API routes
app.include_router(api_router)


# WebSocket connection endpoint
@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None),
    db: Session = Depends(get_db)
):
    origin = websocket.headers.get("origin")
    host = websocket.headers.get("host", "")
    allowed_origins = {f"http://{host}", f"https://{host}",
                       *[value.rstrip("/") for value in settings.ALLOWED_ORIGINS if value != "*"]}
    if origin and origin.rstrip("/") not in allowed_origins:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if not token:
        # Check authorization header
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        # Check cookie
        token = websocket.cookies.get("access_token")

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = decode_token(token)
    if not payload or payload.get("type") == "2fa_ticket":
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id_str = payload.get("sub")
    if not user_id_str:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        user_id = int(user_id_str)
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_verified:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        session_id = payload.get("session_id")
        if session_id:
            s = db.query(UserSession).filter(UserSession.session_id == session_id).first()
            if not s or s.revoked:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, user.id, db, session_id=session_id)

    try:
        while True:
            text_data = await websocket.receive_text()
            if session_id:
                active_session = db.query(UserSession).filter_by(session_id=session_id).first()
                db.refresh(active_session) if active_session else None
                if not active_session or active_session.revoked or active_session.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    break
            try:
                data = json.loads(text_data)
            except Exception:
                continue

            event_type = data.get("event")
            payload_data = data.get("data", {})

            # Heartbeat ping
            if event_type == "ping":
                await websocket.send_text(json.dumps({"event": "pong"}))
                continue

            # WebRTC Call Signaling (call_invite, call_accept, call_reject, webrtc_offer, webrtc_answer, ice_candidate, call_end)
            if event_type in ALL_CALL_EVENTS:
                await CallSignalingHandler.handle_signaling_event(event_type, payload_data, user, db)
                continue

            # Real-time typing indicators
            if event_type in (EVENT_TYPING_START, "typing"):
                conversation_id = payload_data.get("conversation_id")
                if isinstance(conversation_id, int) and db.query(ConversationMember.id).filter_by(
                    conversation_id=conversation_id, user_id=user.id).first():
                    broadcast_payload = create_event(EVENT_TYPING_START, {
                        "conversation_id": conversation_id,
                        "user_id": user.id,
                        "username": user.username,
                        "display_name": user.display_name or user.username
                    })
                    await manager.broadcast_to_conversation(
                        conversation_id, broadcast_payload, db=db, exclude_user_id=user.id
                    )

            elif event_type in (EVENT_TYPING_STOP, "stop_typing"):
                conversation_id = payload_data.get("conversation_id")
                if isinstance(conversation_id, int) and db.query(ConversationMember.id).filter_by(
                    conversation_id=conversation_id, user_id=user.id).first():
                    broadcast_payload = create_event(EVENT_TYPING_STOP, {
                        "conversation_id": conversation_id,
                        "user_id": user.id
                    })
                    await manager.broadcast_to_conversation(
                        conversation_id, broadcast_payload, db=db, exclude_user_id=user.id
                    )

            # Send message via WebSocket
            elif event_type == "message":
                try:
                    db.refresh(user)
                    if user.account_state in {"BANNED", "RESTRICTED"}:
                        await websocket.send_text(json.dumps({"event": "error", "data": {"detail": "Account cannot send messages"}}))
                        continue
                    conv_id = payload_data.get("conversation_id")
                    content = payload_data.get("content")
                    message_type = payload_data.get("message_type", "TEXT")
                    reply_to_id = payload_data.get("reply_to_id")
                    attachments = payload_data.get("attachments")

                    if conv_id and (content or attachments):
                        member = db.query(ConversationMember).filter_by(
                            conversation_id=conv_id, user_id=user.id).first()
                        if member and not is_chat_unlocked_token(
                            websocket.cookies.get(lock_cookie_name(conv_id)), member, session_id
                        ):
                            await websocket.send_text(json.dumps({
                                "event": "error", "data": {"detail": "Unlock this chat with its PIN"}
                            }))
                            continue
                        msg_create = MessageCreate(
                            conversation_id=conv_id,
                            content=content or "",
                            message_type=message_type,
                            reply_to_id=reply_to_id,
                            thread_root_id=payload_data.get("thread_root_id"),
                            expires_in_seconds=payload_data.get("expires_in_seconds"),
                            attachments=attachments
                        )
                        await MessageService.send_message(db, user.id, msg_create)
                except Exception as e:
                    logger.error(f"Error handling ws message: {e}")
                    await websocket.send_text(json.dumps({
                        "event": "error",
                        "data": {"detail": str(e)}
                    }))

            # Read receipt via WebSocket
            elif event_type == "read":
                conv_id = payload_data.get("conversation_id")
                if conv_id:
                    await MessageService.mark_as_read(db, user.id, conv_id)

    except WebSocketDisconnect:
        await manager.disconnect(websocket, user.id, db)
    except Exception as e:
        logger.error(f"WebSocket unexpected error for user {user.id}: {e}")
        await manager.disconnect(websocket, user.id, db)


# Serve the built React client. API and upload routes above take precedence.
class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404 and scope["method"] in {"GET", "HEAD"} and "." not in Path(path).name:
                response = await super().get_response("index.html", scope)
                response.headers["Cache-Control"] = "no-cache"
                return response
            raise
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return response


client_dist = BASE_DIR.parent / "client" / "dist"
if client_dist.exists():
    @app.get("/staff/login", include_in_schema=False)
    def staff_login_page():
        return RedirectResponse("/app/staff/login", status_code=307)

    @app.get("/staff/dashboard", include_in_schema=False)
    def staff_dashboard_page():
        return RedirectResponse("/app/staff/dashboard", status_code=307)

    @app.get("/", include_in_schema=False)
    def react_home():
        return RedirectResponse("/app/", status_code=307)

    @app.get("/{page}.html", include_in_schema=False)
    def old_entrypoints(page: str, request: Request):
        routes = {"social": "/app/", "chat": "/app/chats", "reels": "/app/reels",
                  "login": "/app/login", "register": "/app/register", "profile": "/app/profile",
                  "settings": "/app/settings", "index": "/app/"}
        target = routes.get(page, "/app/")
        view = request.query_params.get("view")
        identifier = request.query_params.get("id", "")
        if page == "social":
            target = {"post": f"/app/posts/{identifier}", "bookmarks": "/app/bookmarks",
                      "communities": "/app/communities", "community": f"/app/communities/{identifier}",
                      "hashtag": f"/app/topics/{identifier}", "notifications": "/app/notifications"}.get(view, "/app/")
        elif page == "chat" and request.query_params.get("conversation", "").isdigit():
            target = f"/app/chats?id={request.query_params['conversation']}"
        elif page == "reels" and identifier:
            target = f"/app/reels?id={identifier}"
        elif page == "profile" and identifier.isdigit():
            target = f"/app/profile/{identifier}"
        return RedirectResponse(target, status_code=307)

    app.mount("/app", SPAStaticFiles(directory=str(client_dist), html=True), name="react-client")
