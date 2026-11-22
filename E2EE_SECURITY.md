# Relaydot communication security assessment

## Deployment status

E2EE is **not implemented**. New and historical messages and attachment bytes remain
readable by the backend. No cryptographic library, device keys, safety numbers,
ratchet sessions, encrypted upload pipeline, or MLS group state are installed.
The security dialog reports this limitation. It never shows an E2EE lock.

The changes delivered with this assessment are protocol-version rejection, a
membership-protected capability endpoint, explicit legacy version 0 responses,
a security dialog, and safer rejection logging. They are not an encrypted
messaging implementation. No database migration or historical-content
transformation was performed.

## Existing data flow

- React/Vite in client/src is the actual browser application.
- ChatsPage sends JSON to POST /api/messages. MessageService validates membership,
  blocks, chat lock, reply targets and upload ownership, then saves Message.content.
- WebSocket event "message" reaches the same MessageService. Edits, reactions,
  replies and forwarding expose content to the service and database.
- ScheduledMessage.content stores text for later server-side sending.
- History and reply previews serialize stored text. Conversation previews,
  notification payloads, exports and server search need review before encryption.
- /api/messages/uploads stores plaintext bytes in private local storage.
  Membership checks protect retrieval. Access control does not encrypt the file.
  The generic upload service also supports Cloudinary for other app media.
- calls.tsx uses RTCPeerConnection, getUserMedia and ICE with STUN/TURN configuration.
  Signaling checks authenticated accounts, call IDs and participants.
  Media uses browser DTLS-SRTP. SDP fingerprints are not bound to independent,
  verified messaging identities. A malicious signaling server remains in scope.
- Calls are one-to-one. There is no reviewed group-call media architecture.

## Threat model

Desired protection covers disclosure of database snapshots and private upload
storage, server operators reading message content, injected/replayed envelopes,
unauthorized devices, removed group members and key-directory substitution.

It cannot protect an unlocked compromised device, malicious browser extension,
XSS, maliciously delivered frontend code, participant recordings or routing
metadata. HTTPS/WSS, browser-origin isolation, strict CSP and deployment access
controls are still necessary.

## Protocol evaluation

Sources checked during implementation, November 2026.

- Signal libsignal publishes native Node libraries. Its official package cannot
  simply be installed into this browser Vite bundle.
  https://github.com/signalapp/libsignal/blob/main/README.md
- Matrix SDK crypto WASM is a genuine browser-capable candidate, with IndexedDB
  storage and Olm/Megolm state management. It requires integration of device lists,
  key uploads/claims, to-device requests, room membership and synchronization.
  Its security model and recovery properties must be evaluated against the
  requested post-compromise recovery for groups before selecting it.
  https://matrix-org.github.io/matrix-sdk-crypto-wasm/
  https://matrix-org.github.io/matrix-sdk-crypto-wasm/classes/OlmMachine.html
- ts-mls states it has not undergone a formal security audit. It is not selected
  to satisfy the reviewed-implementation requirement.
  https://github.com/LukaJCB/ts-mls#security-disclaimer
- OpenMLS supplies an MLS implementation and a WASM build, but its README lists
  wasm32 as built and not tested on CI. The browser adapter, persistent state,
  credentials and protocol delivery need their own compatibility/security work.
  https://github.com/openmls/openmls#supported-platforms

This evaluation does not establish that no suitable library exists. It establishes
that no reviewed, compatible protocol integration has been delivered in this repo.

## Required implementation architecture

Before enabling any encrypted conversation, deliver and test the following together.

1. Pin a maintained protocol implementation and its reproducible WASM artifacts.
   Verify license, provenance, upstream audit coverage and dependency advisories.
2. Bind account device credentials to protocol identity keys. Require a verified
   device or explicit out-of-band identity confirmation for new device trust.
   Atomically consume one-time prekeys and reject unauthorized replacement.
3. Persist protocol state and secrets only on authorized devices, isolated by
   account and origin. Specify encrypted storage unlocking, logout semantics,
   device deletion and crash-safe ratchet-state commits. Never store JWT-derived keys.
4. Introduce separate ciphertext envelopes with unique cryptographic IDs, sender
   device, recipient device and protocol version. Require encrypted mode
   irreversibly for the conversation. Reject plaintext on every API/WS mutation.
   Commit outbound session state and retryable envelopes transactionally.
5. Encrypt content, reply previews, reactions, captions, edit operations, filenames,
   MIME metadata and attachment keys inside authenticated protocol messages.
   Deduplicate envelope IDs and test replay, reordering and reconnect delivery.
6. Use a reviewed attachment format with fresh authenticated encryption keys.
   Send only ciphertext to a private upload endpoint. Authenticate complete files
   before creating preview object URLs. Revoke preview URLs on cleanup. Define
   chunk authentication, size limits and cancellation before large-file support.
7. Bind MLS epochs to authenticated membership commits. Serialize concurrent
   commits and enforce removals before later application messages are accepted.
   New devices and new group members receive no historical secrets automatically.
8. Implement local decrypted search. Disable server previews, server scheduling
   of plaintext, content notifications and server media transforms for E2EE mode.
   Keep legacy messages clearly labeled and require explicit migration consent.
9. Authenticate call SDP/DTLS fingerprints through verified protocol identities.
   Check reconnect/ICE renegotiation and reject identity changes. Group calls
   require a reviewed SFrame/encoded-transform key distribution design.
10. Perform independent cryptographic integration review before production claims.

## Current API and rejection behavior

GET /api/messages/conversations/{conversation_id}/security requires membership
and an unlocked chat. It reports actual deployed capabilities.

MessageCreate, MessageEdit and ScheduledMessageCreate accept legacy version 0.
Other versions and unknown envelope fields are rejected. WebSocket sends now
validate the original envelope rather than copying only recognized fields,
so encryption intent cannot be silently discarded. Validation failures are
logged without exception details that might include submitted message text.

This boundary cannot detect ciphertext disguised by a caller as ordinary text.
Clients must never label such messages encrypted.

## Validation and remaining work

Tests cover unsupported versions/envelopes, authorized status retrieval, rejection
without a database write, legacy compatibility, existing messaging and call
signaling. They do not test actual encrypted send/receive because none exists.

All requested cryptographic tests (independent identities, tampering, prekeys,
replay, browser persistence, group epochs and encrypted attachments) remain
unimplemented. Browser media calls, peer authentication, CSP rollout, device
recovery, encrypted backups and production HTTPS/WSS verification remain pending.
