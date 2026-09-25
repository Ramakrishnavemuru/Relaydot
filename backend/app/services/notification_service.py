from typing import Dict, Any, Optional
from app.models.user import User


class NotificationService:
    @staticmethod
    def create_message_notification(sender: User, conversation_name: str, content: str, conversation_id: int) -> Dict[str, Any]:
        """Format an in-app and browser push notification payload."""
        title = sender.display_name or sender.username
        if conversation_name and conversation_name != title:
            title = f"{title} in {conversation_name}"

        body = content if len(content) <= 100 else f"{content[:97]}..."

        return {
            "type": "new_message",
            "title": title,
            "body": body,
            "icon": sender.avatar_url,
            "data": {
                "conversation_id": conversation_id,
                "sender_id": sender.id
            }
        }
