# Relay QA report — 21 October 2026

The application is running at `http://localhost:8000/app/`. Feature tests used a separate SQLite database and upload directory on port 8001, so test accounts and media did not alter the existing app data.

## Automated regression

- Backend: **39 tests passed**. The suite covers authentication, one-time codes, passkey verification and replay protection, two-factor authentication, sessions, profiles, privacy, posts and feed interactions, stories, communities, chat actions, unread counts, scheduled and disappearing messages, attachments, WebSocket delivery, calls configuration, Reel processing and engagement, and frontend routing.
- Frontend: TypeScript check and Vite production build passed.

## Browser and live-server checks

- Opened Home, Chats, Reels, Explore, Profile, Activity, Bookmarks, Communities, and Settings at 390px and 1440px. All rendered without JavaScript exceptions or horizontal overflow.
- Registered with a development verification code, reset a password, signed in with the new password, and confirmed the previous password was rejected.
- Created a passkey and signed in with it using Chrome's virtual WebAuthn authenticator.
- Changed to the light theme, reloaded the page, and confirmed both the preference and browser theme color persisted. The authenticator QR code loaded in Settings.
- Created a direct chat in the isolated database. An incoming message showed as unread, opening the conversation cleared its unread count, sending through the browser saved a message, and the other account received the live WebSocket event.
- Uploaded a short Reel, waited for processing to publish it, fetched its video with an HTTP range request (`206`), and confirmed the browser loaded the video and used vertical scroll snapping.
- Confirmed voice-call invite, accept, and end events reached the other account over WebSocket.

## Fixes made during QA

- The story strip now truncates long account names from the end, so their beginnings remain visible on narrow screens.
- Settings now reads the backend's `qr_code` field and displays the authenticator QR image.

## Checks requiring real devices or services

Live audio/video quality and media permissions across two physical devices were not exercised. The WebRTC signaling and ICE configuration paths were checked. A real platform passkey was not used; the browser flow was tested with a virtual authenticator. External storage and delivery services were not configured in the isolated test environment.
