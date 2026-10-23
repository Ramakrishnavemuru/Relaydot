"""Small per-process sliding-window guard for write-heavy endpoints."""
import time
from collections import defaultdict, deque
from fastapi import HTTPException

_hits = defaultdict(deque)


def throttle(user_id: int, action: str, limit: int, seconds: int = 60):
    bucket = _hits[(user_id, action)]
    now = time.monotonic()
    while bucket and bucket[0] < now - seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(429, "Too many requests. Please try again shortly.")
    bucket.append(now)
