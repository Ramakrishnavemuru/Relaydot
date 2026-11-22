# Relaydot staff administration

The staff console is at `/app/staff/login` (also redirected from `/staff/login`). The API never infers staff rights from a username, email, browser state, or JWT role claim. It reads the user's database role on each request and requires an active server session with authenticator MFA completed within the last 30 minutes. Owner actions that grant privileges or restore accounts require a session created within the last five minutes.

## First owner

Back up the database and verify the owner's email through an operator-controlled process. Configure the intended database URL, then run from the project root:

```sh
PYTHONPATH=backend python -m app.scripts.create_owner --email you@your-domain.example --username your_owner_name
```

The command refuses an existing account or second owner. It prompts for a password twice, writes a temporary MFA QR image with owner-only filesystem permissions, verifies a live authenticator code, removes the image, and then creates the owner. It does not print the password, seed, recovery code, session token, or access token. Keep a secured backup of the authenticator before relying on it for account recovery. No owner has been provisioned by the implementation itself.

To add a moderator, the owner invites an existing verified user who has enabled authenticator MFA in Settings → Security & devices. The console shows a one-time invitation token. Share it securely; the invitee signs in and enters it at `/app/staff/accept`, then signs in again with MFA. Removing a moderator revokes all of that account's sessions.

## Permissions

| Capability | USER | MODERATOR | OWNER |
| --- | --- | --- | --- |
| Submit/view own support cases, evidence, appeals | Yes | Yes | Yes |
| Review cases and explicitly submitted abuse reports | No | Yes, recent MFA | Yes, recent MFA |
| Reply to cases, add staff-only notes, triage reports | No | Yes | Yes |
| Warn or temporarily restrict ordinary accounts | No | Up to seven days | Up to 30 days |
| Permanently ban, restore, approve appeals | No | No | Yes, fresh MFA |
| Invite/remove moderators, read audit history | No | No | Yes |

Private chat bodies are not returned by staff APIs. A chat report includes only its reporter-supplied details. Support evidence is stored privately in `case_attachments`, limited to 5 MB and PNG, JPEG, WebP, or PDF signatures. The download route checks case ownership or current staff MFA and serves files as attachments with `nosniff` and `no-store` headers. Malware scanning is not configured.

Banned accounts retain access only to their account status, moderation actions, appeals, and logout. After signing in, they are directed to `/app/appeal` to request a review; consumer and staff APIs remain denied.

## Data changes

Startup migrations add `users.role`, `users.account_state`, `users.restricted_until`, `user_sessions.staff_verified_until`, and report-queue fields to `social_reports`. New tables include `auth_challenges`, `auth_attempts`, `support_cases`, `case_messages`, `case_attachments`, `staff_notifications`, `moderator_audit_logs`, `staff_invitations`, `moderation_actions`, and `moderation_appeals`. Existing `feedback` rows are copied idempotently into support cases; source rows stay intact. SQLite/PostgreSQL triggers reject routine UPDATE/DELETE of audit events. The database operator can still override these triggers, so restrict database administration and retain off-host backups.

## APIs

- Users: `POST/GET /api/support/cases`, `GET /api/support/cases/{id}`, `POST /api/support/cases/{id}/reply`, `POST /api/support/cases/{id}/attachments`, `GET /api/support/cases/{id}/attachments/{attachment_id}`, `POST/GET /api/support/appeals`, `GET /api/support/actions`, and `POST /api/social/reports`.
- Staff: `POST /api/staff/auth/login`, `POST /api/staff/auth/verify`, `GET /api/staff/me`, `GET /api/staff/dashboard`, `GET /api/staff/cases`, `GET/PATCH /api/staff/cases/{id}`, `POST /api/staff/cases/{id}/reply`, `GET /api/staff/reports`, `PATCH /api/staff/reports/{id}`, `GET /api/staff/users`, `GET /api/staff/users/{id}/history`, `POST /api/staff/users/{id}/actions`, `GET /api/staff/appeals`, `PATCH /api/staff/appeals/{id}`, `GET /api/staff/notifications`, and `POST /api/staff/notifications/{id}/read`.
- Owner: `GET /api/staff/audit-logs`, `POST /api/staff/moderators/invite`, `DELETE /api/staff/moderators/{id}`. BAN, RESTORE, and appeal approval are owner-only actions on shared staff endpoints.

## Production configuration and remaining work

Set `APP_ENV=production`, `DEBUG=false`, `SECRET_KEY` to a unique random value of at least 48 characters, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax` (or `strict`), HTTPS origin and WebAuthn RP settings, allowed CORS origins, and a backed-up production database. Startup rejects the default signing key, debug mode, or insecure cookies in production and Render environments. JWT and refresh tokens are returned in JSON only for local development; production uses HttpOnly cookies. Local demonstration codes are random and are exposed only under the local development RP.

Before a public launch, configure a real email/SMS OTP and password-reset delivery service. The current project has no provider, so production verification and recovery cannot reach users. Move WebAuthn challenge storage to a shared persistent store before running multiple workers. Add malware scanning for attachments, a dedicated CSRF token or strict trusted-origin policy for every browser mutation, and centralized audit export/monitoring. Review the policy for retention and irreversible account actions. SQLite is suitable for development; use a managed database with backups for production.

Run verification with:

```sh
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=backend python -m pytest backend/tests -q
cd client && npm run build
```
