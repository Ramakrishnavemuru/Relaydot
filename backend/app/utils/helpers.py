import html
from datetime import datetime, timezone
from typing import Optional


def sanitize_text(text: Optional[str]) -> str:
    """Strip and sanitize user text to prevent XSS."""
    if not text:
        return ""
    # Strip leading/trailing whitespaces
    cleaned = text.strip()
    return html.escape(cleaned)


def get_default_avatar(identifier: str) -> str:
    """Generate a clean default avatar URL based on username or initials."""
    seed = identifier.strip().lower()
    return f"https://api.dicebear.com/7.x/initials/svg?seed={seed}&backgroundColor=6366f1,4f46e5,3b82f6"


def format_last_seen(dt: Optional[datetime]) -> str:
    """Format datetime into a human readable last seen string."""
    if not dt:
        return "Offline"
    
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    diff = now - dt

    seconds = int(diff.total_seconds())
    if seconds < 60:
        return "Just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days}d ago"
    return dt.strftime("%b %d, %Y")
