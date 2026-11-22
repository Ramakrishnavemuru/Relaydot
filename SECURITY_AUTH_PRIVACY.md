# Relaydot authentication and privacy

## Audit and threat model

The actual application is React/Vite plus FastAPI and SQLAlchemy, not the older
vanilla client described in the request. The existing implementation already had
bcrypt passwords, revocable UserSession records, hashed rotating refresh tokens,
TOTP, hashed recovery codes, passkeys, device controls and conversation membership
checks. E2EE_SECURITY.md correctly identifies server-readable messaging.

The browser previously received both JWT access and refresh cookies. Unsafe
cookie requests lacked a session-bound CSRF check; WebSockets accepted query JWTs;
TOTP seeds were plaintext and accepted codes could be replayed. Device management
lacked a recent-authentication boundary and there was no unified security history.
These changes address stolen/replayed sessions, cross-site request forgery,
cross-origin sockets, database disclosure of enrolled MFA seeds, and account
security changes through an unattended session. They do not protect a compromised
browser, malicious extension, XSS running in the trusted origin or a compromised
server. User agents and IP addresses are contextual signals, not device identity.

## Browser authentication

New browser logins issue exactly one random 48-byte opaque credential. Only its
SHA-256 digest is stored in the existing refresh_token_hash column. The existing
session_id is a public record identifier, not an authentication credential.

| Environment | Cookie | Attributes |
| --- | --- | --- |
| HTTPS production | __Host-relaydot_session | Secure; HttpOnly; SameSite=Lax (or Strict); Path=/; no Domain |
| Local HTTP development | relaydot_session | HttpOnly; SameSite=Lax; Path=/; no Domain |

Legacy access/refresh cookies are read for migration and removed on new login or
rotation. Explicit bearer JWT clients remain compatible and are checked against
the same revocable session. Production login responses omit bearer/refresh
credentials; development demo mode retains existing API test compatibility.
The browser removes obsolete localStorage token keys and never persists new
credentials in JavaScript storage. Cookie Max-Age uses REFRESH_TOKEN_EXPIRE_DAYS;
server-side expiration is authoritative.

SESSION_IDLE_MINUTES defaults to 30; SESSION_ABSOLUTE_HOURS defaults to 720.
Activity updates are throttled to once per minute. Socket heartbeat pings do not
extend idle life. Renewal rotates the opaque token and cannot extend the original
absolute lifetime or revive an idle/revoked session. Logout revokes the current
session and removes cookies; a localStorage sign-out signal synchronizes tabs.
There is no separate Remember Me policy in this version.

## CSRF and headers

GET /api/auth/csrf delivers an authenticated no-store HMAC synchronizer token
bound to the session credential digest. Every unsafe cookie request requires
X-CSRF-Token. Rotation invalidates old CSRF tokens. Frontend JSON and multipart
requests fetch the token before mutations. Explicit bearer requests do not use
ambient cookie authorization. Origin must match ALLOWED_ORIGINS when supplied;
cross-site Fetch Metadata is rejected. Login creates a fresh credential. JSON
request validation, strict origin checks and same-site cookies protect initial
unauthenticated auth requests; expired cookies do not prevent starting a new login
or password recovery.

API responses are no-store. Responses include nosniff, no-referrer, DENY framing
and camera/microphone self permissions. SPA HTML has hash-based inline script
allowlisting, self-hosted scripts/connectivity, explicit Cloudinary media,
frame-ancestors none, object-src none and base-uri none. Existing inline CSS is
still permitted. HSTS_ENABLED defaults false until HTTPS has been verified.

## WebSockets

Browser sockets authenticate via the HttpOnly cookie and explicit origin list.
WS_ALLOW_QUERY_TOKENS defaults false and cannot be enabled in production. Bearer
headers remain available to non-browser clients. Existing per-action membership,
chat-lock, account-state and call participant checks remain in force. Revocation
closes sockets immediately in the same worker; all workers recheck the database
on inbound activity and at most every 60 seconds on idle sockets. Payloads over
120,000 characters close the connection. Per-user message throttles and a
database-backed connection-attempt throttle bound abuse. Deploy with WSS and a
transport-level frame-size limit as well.

## MFA, devices and alerts

TOTP uses pyotp with a ±1 time-step tolerance. A database conditional update claims
each accepted step, shared with staff recovery, preventing reuse across tickets.
Enrollment codes are consumed too; wait for a new code before the next operation.
Recovery codes have 80 bits of randomness, stored only as SHA-256 digests and
consumed atomically. Regeneration invalidates every previous code. Staff accounts
cannot disable MFA. Already-enrolled authenticators cannot be overwritten by setup.

Enrolled TOTP secrets use cryptography.Fernet authenticated encryption. Production
requires a separately managed MFA_ENCRYPTION_KEY; development derives a dedicated
key with HKDF from SECRET_KEY. Pending TOTP enrollment and WebAuthn challenges
still use existing process memory: use one worker or sticky routing for these
flows until their challenge store is moved to shared storage. Restarting a worker
requires restarting enrollment; enrolled MFA is durable.

Sensitive MFA, recovery, passkey and device revocation actions require an account
sign-in or reauthentication within 10 minutes. POST /api/auth/reauthenticate
requires the password and, when MFA is enabled, an unused authenticator/recovery
code. It rotates the opaque credential while preserving the absolute lifetime.
Passwordless accounts can sign out and complete their existing OTP/passkey login
again; this step-up form currently requires an account password.

Device controls list only the caller's valid sessions, current-device state,
creation/activity timestamps and stored browser labels/IP context. No location is
inferred. The owner can revoke one or all other sessions. Security events record
sign-ins, failed known-account passwords/MFA, new browser contexts, credential
changes and revocations. MFA/password/recovery changes and unfamiliar subsequent
browser contexts create persistent alerts in the existing Activity inbox. Alerts
contain no secrets. These alerts refresh with the inbox, rather than adding a new
real-time delivery channel. Email security alerts are not added; existing staff
password recovery retains its configured SMTP notifications.

Database AuthAttempt limits cover login, registration, OTP, MFA, step-up, device
changes, recovery and socket connections, with account/network dimensions and
Retry-After. Existing upload/search/write throttles remain per-process. Put a
shared reverse-proxy/distributed limiter in front of multi-worker deployments;
DB count-and-insert rate guards are best-effort under simultaneous requests,
not an atomic distributed quota. No permanent IP-based lockout is introduced.

## Settings and privacy

Settings → Security includes account verification, MFA enrollment, recovery-code
replacement, passkeys, active devices and chronological security history.
Settings → Data explains actual storage: essential auth cookies, localStorage UI
preferences and user-specific IndexedDB offline drafts. No advertising or optional
analytics cookies were introduced, so there is no misleading consent banner.
Message security continues to report that E2EE is not enabled. HTTPS and secure
cookies are not described as end-to-end encryption.

## Database upgrade and rollback

Startup follows the existing additive migration convention; no records are reset:

- security_events table, user foreign key and user/date indexes;
- nullable user_sessions.reauthenticated_at column on SQLite/PostgreSQL;
- users.totp_secret storage enlarged to VARCHAR(512) on PostgreSQL;
- existing plaintext seeds encrypted in place in a transaction; encrypted seeds
  are preserved on subsequent starts.

Back up the database and current secret configuration before deployment. Retain
the MFA key with encrypted backups. Never change the key without decrypting and
reencrypting data through an audited migration. A downgrade must retain the
AuthenticatorSecret reader; older plaintext-only code cannot read encrypted seeds.
Prefer a forward fix. Restoring a pre-upgrade backup also loses subsequent data;
perform it only as an explicitly authorized maintenance operation. Additive tables
and columns can remain unused on rollback. Do not drop accounts or sessions.

## Endpoint changes

- GET /api/auth/csrf
- GET /api/auth/security-events?limit=30&offset=0 (owner-only, bounded pagination)
- POST /api/auth/reauthenticate
- POST /api/auth/2fa/recovery-codes/regenerate
- Existing login/refresh/logout/MFA/passkey/session APIs keep their paths;
  cookie mutations now require CSRF and sensitive actions require recent auth.

## Production configuration

1. Set APP_ENV=production, DEBUG=false, a unique SECRET_KEY of at least 48
   characters, and a stable separately stored MFA_ENCRYPTION_KEY (a Fernet key).
   Generate keys using the installed cryptography.Fernet.generate_key() API in a
   secure administrator environment; do not commit or log them.
2. Set COOKIE_SECURE=true, COOKIE_SAMESITE=lax (or strict), explicit HTTPS
   ALLOWED_ORIGINS, correct RP_ID/RP_ORIGIN and trusted staff recovery origin.
3. Keep WS_ALLOW_QUERY_TOKENS=false. Terminate TLS with HTTPS/WSS, configure
   trusted proxy forwarding, request/frame size limits and shared abuse controls.
4. Back up before running startup migrations. Check database permissions, preserve
   encryption keys, and verify SMTP separately for existing recovery mail.
5. Check login, CSRF mutations, MFA, camera/microphone calls, Cloudinary delivery
   and WSS on the actual domain before enabling HSTS_ENABLED=true.
6. In a multi-worker deployment, provide shared challenge/throttle storage and
   cross-worker socket revocation broadcast for immediate global disconnection.

## Verification

Run backend tests with PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=backend
python3 -m pytest backend/tests -q. Autoload is disabled because an unrelated
system-installed web3 pytest plugin fails importing eth_typing.ContractName.
Regression browser clients now perform the same CSRF handshake as the app. Legacy
query-token regression cases opt in through the test fixture; new security cases
explicitly verify the default-off behavior. Run npm --prefix client run build and
npm --prefix client test. Final executed counts are reported with the delivery.

## Implementation files

New: backend/app/security/browser_session.py,
backend/app/security/secret_storage.py, backend/app/models/security_event.py,
backend/tests/test_browser_security.py and this document.

Extended: backend/app/config.py, main.py, models/user.py, models/session.py,
models/__init__.py, schemas/auth.py, security/dependencies.py,
services/auth_service.py, services/staff_recovery.py, routes/auth.py and
backend/requirements.txt. Frontend: api.ts, store.ts, components.tsx,
pages/SettingsPage.tsx, pages/NotificationsPage.tsx, pages/StaffPage.tsx and the
shared design stylesheet. Regression test clients and the MFA/WS-origin tests
were adapted to the new cookie/CSRF/replay policy. Other preexisting workspace
changes belong to earlier Relaydot feature work.

Browser verification used a separate /tmp SQLite database and a test-only account:
sign-in, cookie-authenticated socket connection, Security settings/history and
successful reauthentication were observed. No real account password was changed.
The final backend suite passed 105 tests; client build/typecheck passed and its
four existing tests passed. Full real-device call/media, reverse-proxy HTTPS,
SMTP delivery, PostgreSQL migration and multi-worker behavior still require
verification in the deployment environment.
