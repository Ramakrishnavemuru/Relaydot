import logging
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.models.user import User
from app.websocket.manager import manager
from app.websocket.events import create_event
from app.websocket.call_events import (
    EVENT_CALL_INVITE,
    EVENT_CALL_ACCEPT,
    EVENT_CALL_REJECT,
    EVENT_WEBRTC_OFFER,
    EVENT_WEBRTC_ANSWER,
    EVENT_ICE_CANDIDATE,
    EVENT_CALL_END
)

logger = logging.getLogger("signaling")


class CallSignalingHandler:
    @staticmethod
    async def handle_signaling_event(
        event_type: str,
        data: Dict[str, Any],
        sender: User,
        db: Session
    ) -> bool:
        """
        Routes WebRTC signaling events from sender to recipient.
        Returns True if handled, False otherwise.
        """
        target_user_id = data.get("target_user_id") or data.get("callee_id") or data.get("peer_user_id")
        if not target_user_id:
            logger.warning(f"[Signaling] Event {event_type} received without target_user_id from user {sender.id}")
            return False

        try:
            target_user_id = int(target_user_id)
        except (ValueError, TypeError):
            return False

        # Enrich event data with sender info
        enriched_data = data.copy()
        enriched_data["sender_id"] = sender.id
        enriched_data["caller_id"] = sender.id
        enriched_data["caller_name"] = sender.display_name or sender.username
        enriched_data["caller_avatar"] = sender.avatar_url

        if event_type == EVENT_CALL_INVITE:
            logger.info(f"[Call] Invite from {sender.id} to {target_user_id} ({data.get('call_type', 'audio')})")
            # If target user is not online, immediately notify caller that target is offline
            if not manager.is_user_online(target_user_id):
                reject_payload = create_event(EVENT_CALL_REJECT, {
                    "reason": "offline",
                    "target_user_id": target_user_id,
                    "message": "User is currently offline."
                })
                await manager.send_to_user(sender.id, reject_payload)
                return True

            payload = create_event(EVENT_CALL_INVITE, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_CALL_ACCEPT:
            logger.info(f"[Call] Accept from {sender.id} to {target_user_id}")
            payload = create_event(EVENT_CALL_ACCEPT, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_CALL_REJECT:
            logger.info(f"[Call] Reject from {sender.id} to {target_user_id}")
            payload = create_event(EVENT_CALL_REJECT, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_WEBRTC_OFFER:
            logger.info(f"[Call] WebRTC Offer from {sender.id} to {target_user_id}")
            payload = create_event(EVENT_WEBRTC_OFFER, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_WEBRTC_ANSWER:
            logger.info(f"[Call] WebRTC Answer from {sender.id} to {target_user_id}")
            payload = create_event(EVENT_WEBRTC_ANSWER, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_ICE_CANDIDATE:
            payload = create_event(EVENT_ICE_CANDIDATE, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        elif event_type == EVENT_CALL_END:
            logger.info(f"[Call] End call from {sender.id} to {target_user_id}")
            payload = create_event(EVENT_CALL_END, enriched_data)
            await manager.send_to_user(target_user_id, payload)
            return True

        return False
