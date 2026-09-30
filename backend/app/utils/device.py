import re
from typing import Optional


def parse_device_name(user_agent: Optional[str]) -> str:
    """Parse user agent string into human-readable device name (e.g. 'Chrome on macOS', 'Safari on iPhone')."""
    if not user_agent:
        return "Unknown Device"

    ua = user_agent

    # Detect OS
    os = "Unknown OS"
    if "iPhone" in ua:
        os = "iPhone"
    elif "iPad" in ua:
        os = "iPad"
    elif "Android" in ua:
        os = "Android"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        os = "macOS"
    elif "Windows NT 10.0" in ua or "Windows NT 11.0" in ua:
        os = "Windows 11/10"
    elif "Windows" in ua:
        os = "Windows"
    elif "Linux" in ua:
        os = "Linux"

    # Detect Browser
    browser = "Browser"
    if "Edg/" in ua or "Edge/" in ua:
        browser = "Microsoft Edge"
    elif "OPR/" in ua or "Opera/" in ua:
        browser = "Opera"
    elif "Chrome/" in ua and "Chromium" not in ua and "Edg/" not in ua:
        browser = "Chrome"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua and "Chrome" not in ua:
        browser = "Safari"

    return f"{browser} on {os}"


def get_client_ip(headers: dict, client_host: Optional[str]) -> str:
    """Extract real client IP address checking X-Forwarded-For if available."""
    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        # First IP in comma-separated list
        return forwarded.split(",")[0].strip()
    return client_host or "127.0.0.1"
