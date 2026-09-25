"""WebSocket event types and payload helpers."""

# Message events
EVENT_MESSAGE = "message"
EVENT_MESSAGE_EDIT = "message_edit"
EVENT_MESSAGE_DELETE = "message_delete"

# Typing events
EVENT_TYPING_START = "typing_start"
EVENT_TYPING_STOP = "typing_stop"

# User presence events
EVENT_ONLINE = "online"
EVENT_OFFLINE = "offline"

# Status & receipt events
EVENT_DELIVERED = "delivered"
EVENT_READ = "read"
EVENT_REACTION = "reaction"

# Conversation events
EVENT_CONVERSATION_NEW = "conversation_new"
EVENT_CONVERSATION_UPDATE = "conversation_update"
EVENT_MEMBER_JOINED = "member_joined"
EVENT_MEMBER_LEFT = "member_left"
EVENT_USER_BLOCKED = "user_blocked"
EVENT_USER_UNBLOCKED = "user_unblocked"


def create_event(event_type: str, data: dict) -> dict:
    """Format a standard event message envelope."""
    return {
        "event": event_type,
        "data": data
    }
