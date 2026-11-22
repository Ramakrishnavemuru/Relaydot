# Performance audit and results

This audit targets the existing React/Vite client and FastAPI/SQLAlchemy backend. Measurements below are local synthetic results, not production latency or Core Web Vitals.

Changed files: `backend/app/database.py`, `backend/app/main.py`, `backend/app/models/message.py`, `backend/app/models/conversation.py`, `backend/app/services/message_service.py`, `backend/app/services/conversation_service.py`, `backend/app/services/cloudinary_service.py`, `backend/app/websocket/manager.py`, `backend/benchmarks/chat_queries.py`, `backend/tests/test_chat_performance.py`, `backend/tests/test_frontend_mount.py`, `client/src/App.tsx`, `client/src/api.ts`, `client/src/components.tsx`, `client/src/Stories.tsx`, `client/src/pages/ChatsPage.tsx`, `client/src/pages/FeedPage.tsx`, `client/src/styles.css`, `README.md`, and this report.

| Scenario | Before | After |
| --- | ---: | ---: |
| Serialize 50 chat messages | 402 SQL statements; 68.59 ms | 11 statements; 8.57 ms |
| Serialize 100 chat messages | 802 SQL statements; 126.46 ms | 11 statements; 4.68 ms |
| Serialize 1,000 chat messages | 8,002 SQL statements; 1,206.02 ms | 11 statements; 26.69 ms |
| List 20 conversations | 62 SQL statements; 19.65 ms | 4 statements; 5.66 ms |
| Vite entry JavaScript | 418.61 kB (126.02 kB gzip) | 316.76 kB (100.46 kB gzip) |

The SQL figures come from `backend/benchmarks/chat_queries.py` with an in-memory SQLite database, two users, 20 conversations and 1,019 seeded messages. Each scenario runs once in the same process; elapsed times include ORM serialization and are sensitive to local caches and machine load. SQL statement count is the more reliable comparison. Run it from `backend/` with `PYTHONPATH=. python3 benchmarks/chat_queries.py`. The 1,000-message case measures backend serialization; the chat UI requests 100 messages initially and loads older pages on demand.

The main bottleneck was per-message queries for sender, reply, attachments, reactions, reads, members, thread replies and bookmarks. Chat history now loads related rows in batches, and the conversation list batches its members, latest-message and unread-count work. Composite indexes cover message pages, latest-message lookup, read lookup and membership lookup. `EXPLAIN QUERY PLAN` now reports covering-index searches for those four paths, without temporary sorting. The regression tests cap the number of queries for 100 and 1,000 messages and 20 conversations.

The client now splits page modules by route, cancels obsolete queries, applies WebSocket events to the active message cache, resyncs after a reconnect, sends text optimistically, and loads chat history in pages. Chat bubbles are memoized to avoid rerendering the thread on every draft keystroke. Images use lazy decoding and width-limited Cloudinary previews where possible; the story viewer preloads only the next image. Videos avoid eager preload outside the active viewer. Cloudinary uploads stream from the spooled file and run off the event loop. WebSocket fan-out is capped at 16 concurrent sends and uses one send lock per connection. The app serves gzip responses, immutable hashed assets, and a non-cached SPA entry point.

To verify: run `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=. python3 -m pytest -q` in `backend/`, and `npm run build` in `client/`. The local suite passed 39 tests and the production build passed on 2026-10-21. The WebSocket fan-out test verifies a 40-recipient broadcast delivers once to each recipient with no more than 16 concurrent sends. The frontend mount test verifies asset cache headers and API gzip.

Deployment notes: the existing startup migration adds five composite index definitions to existing SQLite or PostgreSQL databases. Back up the database before deployment and schedule the first startup during a quiet period on large databases, since index creation can take time and lock writes. SQLite file databases enable WAL and a five-second busy timeout. No rows are intentionally rewritten. Rebuild `client/dist` with `npm run build` before starting FastAPI so route chunks and their hashed URLs match the served index.

Remaining measurements need a deployed or representative environment: browser LCP/INP, real API p50/p95/p99 latency, simultaneous-user capacity, slow-network media behavior and reconnect recovery under packet loss. The local SQLite timings and bundle sizes cannot establish those values. Route splitting reduces the entry download, but it adds a network request on the first visit to each route; hashed asset caching should make repeat visits cheaper.
