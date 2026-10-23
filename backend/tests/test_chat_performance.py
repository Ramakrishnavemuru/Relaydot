"""Guard the measured chat hot paths against query and fan-out regressions."""

import asyncio

from benchmarks.chat_queries import benchmark
from app.websocket.manager import ConnectionManager


def test_chat_pages_use_batched_queries():
    results = benchmark()
    assert results["messages_100"]["rows"] == 100
    assert results["messages_100"]["queries"] <= 15
    assert results["messages_1000"]["queries"] <= 15
    assert results["conversations_20"]["rows"] == 20
    assert results["conversations_20"]["queries"] <= 5


def test_websocket_fanout_is_bounded_and_delivers_once():
    manager = ConnectionManager()
    active = 0
    peak = 0

    class Socket:
        def __init__(self):
            self.received = []

        async def send_text(self, payload):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.002)
            self.received.append(payload)
            active -= 1

    sockets = {user_id: Socket() for user_id in range(40)}
    manager.active_connections = {user_id: {socket} for user_id, socket in sockets.items()}
    asyncio.run(manager.broadcast_to_users(list(sockets) + [0, 1], {"event": "test"}))
    assert 1 < peak <= 16
    assert all(len(socket.received) == 1 for socket in sockets.values())
