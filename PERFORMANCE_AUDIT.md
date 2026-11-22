# Relaydot performance and reliability audit

## Initial evidence (local development, 22 November 2026)

The implementation is React/Vite + FastAPI/SQLAlchemy. Existing query batching,
message indexes, cursor history, memoized message rows, SQLite WAL/busy timeout,
lazy routes and bounded WebSocket fanout already exist and are preserved.

The initial synthetic in-memory SQLite benchmark (2 users, 20 conversations,
1,000 messages in one conversation) measured:

| Operation | Queries | Single-run milliseconds |
| --- | ---: | ---: |
| 50 messages | 11 | 9.37 |
| 100 messages | 11 | 5.22 |
| 1,000 messages | 11 | 28.63 |
| 20 conversations | 4 | 6.73 |

EXPLAIN QUERY PLAN used covering indexes for message pages, latest message,
membership and read lookups. There is no measured justification for another
index or a database migration on these paths. Times are illustrative local
samples, not percentile measurements or production guarantees.

Audit evidence before changes:
- CSRF fetch runs before the main request timeout and has no deadline.
- Main request deadline is cleared before response JSON finishes reading.
- Authentication boot refreshes on every error, including offline/network errors;
  StrictMode can invoke it twice, with no deduplication or stale-result guard.
- There is no render error boundary or failed dynamic-import recovery; empty
  index.html root depends entirely on successful module execution.
- Socket effect depends on the complete user object, so profile updates recreate
  the connection; offline reconnect attempts and heartbeat responses are unchecked.
- SettingsEffects fetches outside QueryClient, duplicating settings page queries.
- Chat scroll-to-bottom runs on every recent-message count change, even while
  reading history. People search fires on each keystroke.

The existing localhost login rendered during baseline inspection. A white screen
was not reproduced under a healthy network. Failure-path tests will reproduce
identified initialization and resource errors deterministically. Browser tooling
does not expose Performance entries in its read-only evaluation environment, so
LCP/INP/CLS will not be claimed from this session.

## Root causes and fixes delivered

1. **Unbounded network initialization:** deadlines now cover CSRF, fetch and JSON
   response consumption. CSRF is limited to 8 seconds; ordinary requests to 15
   seconds; existing media uploads to 120 seconds. Abort listeners/timers are
   removed on settlement. Reads honor AbortSignal. Ambiguous writes never retry.
2. **Authentication storms and races:** boot is one deduplicated request and no
   longer refreshes after arbitrary errors. A version guard prevents a late boot
   response overwriting a newer login/logout. Network/server failures show a
   retryable state; actual 401 responses require sign-in. Query retries exclude
   permanent authorization/not-found/validation failures. Offline queries and
   mutations settle rather than staying paused indefinitely.
3. **Repeated CSRF round trips:** one in-memory five-minute token cache and shared
   in-flight lookup replace a fetch before every mutation. Login/rotation/logout
   invalidate it. Only the server's explicit pre-action CSRF rejection permits
   one retry, handling cookie rotation in another tab without bypassing CSRF.
4. **Missing lazy chunks during deployment:** rebuilding while an older browser
   page was open reproduced a missing Settings chunk. The old page could not load
   a file removed by the new build. Independent startup recovery and React render
   boundaries now provide reload actions. A follow-up reproduction also caught
   recovery replacing React-owned DOM; recovery now renders an independent
   overlay after React mounts. A regression test asserts the root is untouched.
5. **Storage denial:** call/settings preference reads previously ran directly
   during render. SecurityError from blocked localStorage could take down the
   authenticated application. Safe optional storage access now uses defaults.
6. **Socket churn and stale connections:** connection lifetime depends on user ID,
   not the mutable user object. Offline connects are suppressed; reconnect uses
   exponential backoff/jitter capped at 30 seconds. Heartbeat expiry closes stale
   sockets; foreground/online events resume safely. Policy rejection checks the
   session without initiating an authentication/reconnect loop. Reconnect still
   invalidates active history/conversations/notifications to recover missed data.
7. **Chat rendering:** initial history remains 100 messages with cursor pages of
   100. Older-message loading preserves scroll position; incoming messages follow
   only when the reader is near the bottom. Search is debounced 250ms. Uncorrelated
   optimistic bubbles were removed: the composer shows Sending until the server
   responds, and HTTP/WS results reconcile using the server message ID. Text stays
   available on error; submission is guarded while pending. Attachment videos use
   metadata preload. Existing lazy images and thumbnail sizing remain intact.
8. **Backend hot path:** cookie authentication reuses the session already resolved
   by its credential lookup, eliminating the second session SELECT. Synchronous
   CSRF database work runs in the worker pool instead of on the event loop. CSP
   inline-script hashes are cached by HTML modification timestamp. Server-Timing
   exposes overall application handling duration without request content.
9. **Build continuity:** Vite now retains existing hashed assets (`emptyOutDir: false`), so a local rebuild does not invalidate chunks referenced by open tabs. A test-only old-asset probe survived the final build and was removed afterward. Deployments still need atomic asset delivery and a retention policy.
10. **Rendering/background work:** dense chat/settings/cards no longer use backdrop
   blur; glass remains on navigation and focused surfaces. Settings requests share
   QueryClient deduplication. Per-account query state is cleared on account change.
   Development-only PerformanceObservers report numeric long-task/layout/paint
   entries without user data. Existing reduced-motion styles remain in place.

## Final measurements

| Check | Baseline | Final |
| --- | --- | --- |
| CSRF lookups for six concurrent ordinary mutations | 6 by prior code path | 1, automated test |
| Session SELECTs for cookie-authenticated /auth/me | 2 by prior code path | 1, SQL event regression test |
| Auth restoration attempts on unauthenticated boot | me + CSRF + refresh; duplicated under StrictMode | one deduplicated me request |
| Hung CSRF/body | no complete-operation deadline | bounded and tested |
| 50-message query sample | 11 queries / 9.37ms | 11 queries / 9.34ms |
| 100-message query sample | 11 queries / 5.22ms | 11 queries / 5.63ms |
| 1,000-message query sample | 11 queries / 28.63ms | 11 queries / 29.36ms |
| 20-conversation sample | 4 queries / 6.73ms | 4 queries / 7.27ms |
| Main JS chunk (gzip) | 107.19kB | 108.60kB |
| CSS (gzip) | 32.73kB | 32.96kB |

Database differences are normal single-run noise, not a speedup or measured
regression. No database/index migration or new dependency was introduced. The
small bundle increase pays for recovery and deadline handling; bundle shrinkage
is not claimed. LCP <2.5s, INP <200ms and CLS <0.1 remain deployment/device targets,
not verified results. DevTools-equivalent field timing is still required.

## Executed validation

Environment: macOS workspace, Python 3.10.12, Node v25.2.1, installed project
FastAPI/SQLAlchemy/React/Vite dependencies. Query benchmark uses isolated in-memory
SQLite. Browser testing used a separate /tmp SQLite database, test-only accounts
and a synthetic 1,000-message conversation, not real user content.

- `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=backend python3 -m pytest backend/tests -q`:
  **124 passed**, including security, chat, query-count/fanout and new loading tests.
  Disabling plugin autoload avoids an unrelated installed web3 plugin failure.
- `npm --prefix client run build`: **passed** (TypeScript plus Vite production build).
- `npm --prefix client test`: **12 passed**, covering offline queue regressions,
  concurrent CSRF deduplication, safe rotation retry, hung response/CSRF deadlines,
  cancellation, expired sessions, boot deduplication, denied storage and startup
  recovery with and without an already-mounted React tree.
- SPA/resource regression checks cover 18 deep links, production script/CSS MIME
  types, immutable hashed assets, missing chunk 404s, CSP and initial recovery HTML.
- Browser: authenticated chat empty state, initial 100-message history, earlier
  history pagination, scroll compensation, confirmed single message bubble,
  settings/security and client-side Home navigation. Final fresh-tab checks
  returned no console warnings/errors. Chat geometry at 320/375/1440 widths had
  matching document/content widths. Small and desktop layouts were inspected.
- `git diff --check`: **passed**.

## Reproduction and future checks

- Slow initialization: delay /api/auth/csrf or withhold a JSON response body;
  requests must terminate with an actionable timeout, not remain pending forever.
- Deployment chunk failure: open a route, deploy a different build removing its
  still-unrequested lazy chunk, then navigate to that route. A reload action must
  remain visible; recovery must not remove React-owned nodes.
- Block localStorage: calls/settings must initialize with default devices.
- Long chat: load recent messages, scroll up, load another cursor page and verify
  position is preserved. Incoming messages must not jump the reader to the end.
- Disconnect/reconnect: no connection attempts while offline; on return, reconnect
  and refetch active data. Revoked/expired sessions must still fail authorization.

## Files changed for this task

New: client/public/startup.js, client/src/ErrorBoundary.tsx,
client/src/diagnostics.ts, client/src/storage.ts,
client/tests/performance.test.cjs, backend/tests/test_loading_reliability.py,
and PERFORMANCE_AUDIT.md.

Updated: client/index.html, client/src/main.tsx, App.tsx, api.ts, store.ts,
calls.tsx, offlineQueue.ts, pages/ChatsPage.tsx, pages/SettingsPage.tsx,
design/liquid-glass.css, client/tests/offlineQueue.test.cjs,
client/vite.config.ts, backend/app/main.py and backend/app/security/dependencies.py.
Other workspace changes predate this performance task.

## Deployment and remaining limits

- Deploy HTML and assets atomically and retain old hashed assets for active tabs
  through the deployment/cache lifetime. HTML and stable startup.js must revalidate;
  only fingerprinted assets should be immutable. Prune retained assets only after the supported active-tab/cache lifetime, rather than on every build. Never serve index.html for a
  missing .js/.css request. Recovery cannot reconstruct a chunk already deleted.
- Restart FastAPI to activate backend changes. A built client is present in dist.
  The isolated browser server is separate from the normal port-8000 process.
- Real production TLS/proxy/CDN behavior, throttled mobile CPU/network, long-running
  memory trends, camera/microphone calls between devices, and a running Vite dev
  server still need deployment-specific verification. No field performance score
  is asserted. Existing backend call/upload/security tests passed.
- Message history is paginated, not virtualized. Explicitly loading many older
  pages can still accumulate a large DOM; benchmark real devices before selecting
  a windowing strategy that preserves variable-height media and accessibility.
- There is no new offline message queue or automatic ambiguous-write replay.
  If a response is lost after server acceptance, users should check history before
  sending again; server-side client-ID message idempotency is a separate remaining
  improvement. Existing offline post idempotency is preserved.
- Existing synchronous database work in other async service routes and multi-worker
  socket infrastructure warrant load profiling before larger architectural changes.
  No database/infrastructure migration was justified by the recorded query plans.
