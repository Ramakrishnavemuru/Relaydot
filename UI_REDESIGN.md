# Relay UI redesign

The existing vanilla frontend and FastAPI application remain in place. All displayed conversations, contacts, messages, attachments, groups, stories and account state come from the existing backend. Review fixtures were created only through real APIs against `/private/tmp/relay-redesign-test.db`; no fixture users or messages are included in the application source.

## Design and implementation

- `frontend/css/global.css` defines separate light and dark tokens for surfaces, typography, borders, buttons, status and message bubbles. Theme choices are light, dark or system.
- `frontend/css/chat.css` owns the navigation rail, inbox, conversation, composer and details layouts. Details sit alongside the conversation from 1200px and become a separate dialog below that width. Chat navigation switches to one primary panel at 768px and below.
- `frontend/js/ui.js` shares Lucide icons, locally generated default avatars, safe highlighting/link rendering, dropdowns, confirmations, credential dialogs, keyboard focus and theme controls. Uploaded profile photos remain unchanged.
- Live message updates append individual rows; edits, reactions and receipts update individual bubbles. Inbox rows are reused. History loads in pages of 50, with scroll position retained when loading earlier messages.
- Sending uses the existing message POST acknowledgement and existing WebSocket broadcasts. Socket echoes and REST responses are deduplicated by server message ID. Unsent messages and conversation drafts survive reloads and offer manual retry.
- Conversation favorite, archive, pin and mute preferences are saved per account on the current browser. These are explicitly labeled as browser preferences because the backend provides no endpoints for them.
- Global search connects to existing user/message search. Older message results load their real history and provide a return-to-latest control. Shared media, files and links reflect the loaded history, as labeled in the panel.
- Groups expose existing creation, editing, member administration and leave actions. Calls, stories, uploads, notifications, OTP, passwords, TOTP, recovery codes, passkeys and session management retain their existing modules and APIs.

## Required compatibility correction

`backend/app/schemas/user.py` now permits a null email for existing phone-only accounts and returns `phone_number`, `totp_enabled` and `has_password`, which the user model already supplies. This fixes phone-only profile response validation and the missing 2FA status. It is an additive response correction; no routes, request payloads, authentication logic, database models or WebSocket contracts changed.

## Verification

Command:

```sh
DATABASE_URL=sqlite:////private/tmp/relay-contract-tests.db PYTHONPATH=backend backend/venv/bin/python -m pytest backend/tests -q
```

Result: **18 passed**, with one existing Starlette/httpx deprecation warning. The new integration tests cover REST acknowledgements with socket echoes, receiving, typing, read receipts, socket reconnects, edits/deletion/reactions/replies, pagination/search, image/file uploads, group authorization and membership, profile/privacy changes, refresh/session revocation, phone-only profiles and accurate TOTP state.

Browser verification against the isolated local server:

| Area | Verified |
| --- | --- |
| Authentication | Registration and OTP verification, password login, logout confirmation, session persistence after reload |
| Messaging | Chat creation, multiline/link/emoji content, sending/receiving, read receipts, reply, edit, reaction, forwarding |
| History/search | Real contact and message search, highlights, opening an older search result, return to latest, loading all 55 messages from two pages |
| Uploads/stories | Multiple file/image upload, previews, real attachment send, story upload and posting |
| Groups | Creation, description update, adding a member and updated member count/admin labels |
| Preferences/settings | Favorite/archive filters, profile save, privacy controls, real active sessions and corrected 2FA status, theme controls |
| Recovery | Server stop/start, failed bubble with Retry, successful resend without duplication, restored connection, failed message preserved across reload and then resent |
| Responsive | Chat, login, registration, profile and settings checked at 320, 375, 390, 430, 768, 1024, 1440 and 1920px; no horizontal page overflow. Details checked at mobile/tablet/desktop sizes; composer remains at viewport bottom |
| Accessibility | Labeled controls, dialog roles, focus restoration/trapping, keyboard activation, visible focus, tab navigation, reduced-motion styles; main message text exceeds 9:1 contrast in both themes and muted body text exceeds 4.5:1 |

The in-app browser viewport override was unreliable, so width checks used a temporary same-origin iframe harness with fixed CSS widths. That harness was removed after testing. Screenshots in `artifacts/ui-review` show actual backend data used during review.

## Verification limits

Call signaling and story APIs passed integration tests. Actual microphone/camera quality, OS notification delivery, physical on-screen keyboard behavior, and hardware biometric/passkey prompts need device testing with the relevant permissions. No deployment was performed. Existing WebRTC media fallback behavior was preserved.

The backend has no client idempotency key for message creation. A transport failure after server acceptance can leave acknowledgement uncertain; manual retries therefore retain the existing backend semantics.

## Local preview

The running review server uses an isolated database and upload directory, leaving the normal application database untouched:

```sh
DATABASE_URL=sqlite:////private/tmp/relay-redesign-test.db UPLOAD_DIR=/private/tmp/relay-redesign-uploads backend/venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The user's pre-existing Dockerfile, Procfile, backend configuration/database/dependency changes and `frontend/js/config.js` changes were preserved.
