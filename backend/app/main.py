import os
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.config import settings, BASE_DIR
from app.database import engine, Base, get_db
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
from app.services.message_service import MessageService
from app.schemas.message import MessageCreate

from app.models.session import UserSession

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


def run_schema_migrations():
    """Ensure database schema is up-to-date with new auth columns."""
    try:
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
            conn.commit()
    except Exception as e:
        logger.warning(f"Schema migration warning: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure tables created and migrated
    logger.info("Initializing database tables and migrations...")
    run_schema_migrations()
    Base.metadata.create_all(bind=engine)
    logger.info("Database initialized.")
    yield
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

    await manager.connect(websocket, user.id, db)

    try:
        while True:
            text_data = await websocket.receive_text()
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
                if conversation_id:
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
                if conversation_id:
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
                    conv_id = payload_data.get("conversation_id")
                    content = payload_data.get("content")
                    message_type = payload_data.get("message_type", "TEXT")
                    reply_to_id = payload_data.get("reply_to_id")
                    attachments = payload_data.get("attachments")

                    if conv_id and content:
                        msg_create = MessageCreate(
                            conversation_id=conv_id,
                            content=content,
                            message_type=message_type,
                            reply_to_id=reply_to_id,
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


# Mount frontend directory for easy full-stack hosting
frontend_dir = BASE_DIR.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
