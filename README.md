# Relay — messaging, social feed, and communities

A unified communication app built with **React, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS, FastAPI, WebSockets, and SQLAlchemy**. Existing chats and accounts share one backend with the social feed and communities.

---

## 🚀 Features

- **Social**: For You and Following feeds, posts with media and polls, replies, reactions, reposts, bookmarks, topics, profiles, follows, and search.
- **Messaging**: direct and group chats with real-time updates, attachments, message replies and actions, disappearing messages, scheduled sends, group management, and voice/video calling.
- **Stories and Reels**: expiring text/media stories with replies, plus a vertical Reel feed with upload, comments, likes, saves, and creator editing.
- **Communities**: discovery, creation, joining, posts, and linked group chats.
- **Account**: password, one-time-code, and passkey sign-in; registration verification; password recovery; profile images; privacy controls; sessions and two-factor authentication.
- **Responsive UI**: desktop columns and mobile navigation in the same React application.

The FastAPI backend also exposes advanced moderation, Reel analytics, and other capabilities through `/docs`. Some of those controls do not yet have dedicated React screens.

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS 4 |
| **Backend** | Python 3.10+, FastAPI, Starlette |
| **Real-time** | WebSockets |
| **Database** | SQLite or PostgreSQL via SQLAlchemy |
| **ORM** | SQLAlchemy 2.0+ |
| **Authentication** | JWT (python-jose) + bcrypt |
| **File Storage** | Cloudinary Free Tier (with local `/uploads` fallback) |
| **Testing** | Pytest, HTTPX |

---

## 📦 Project Structure

```
realtime-chat-app/
├── backend/
│   ├── app/
│   │   ├── config.py              # App settings & environment configs
│   │   ├── database.py            # SQLite engine, session & declarative base
│   │   ├── main.py                # FastAPI app, CORS, static mounts, /ws
│   │   ├── models/                # SQLAlchemy database models
│   │   │   ├── user.py
│   │   │   ├── conversation.py
│   │   │   ├── message.py
│   │   │   ├── attachment.py
│   │   │   ├── reaction.py
│   │   │   ├── block.py
│   │   │   └── social.py
│   │   ├── schemas/               # Pydantic v2 validation schemas
│   │   │   ├── auth.py
│   │   │   ├── user.py
│   │   │   ├── conversation.py
│   │   │   └── message.py
│   │   ├── security/              # Bcrypt hashing & JWT utilities
│   │   │   ├── password.py
│   │   │   ├── jwt.py
│   │   │   └── dependencies.py
│   │   ├── services/              # Business logic layer
│   │   │   ├── auth_service.py
│   │   │   ├── user_service.py
│   │   │   ├── conversation_service.py
│   │   │   ├── message_service.py
│   │   │   ├── notification_service.py
│   │   │   ├── feed_service.py
│   │   │   ├── rate_limit.py
│   │   │   └── cloudinary_service.py
│   │   ├── websocket/             # WebSocket connection manager & events
│   │   │   ├── manager.py
│   │   │   └── events.py
│   │   ├── routes/                # FastAPI API endpoint routers
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── conversations.py
│   │   │   ├── groups.py
│   │   │   ├── messages.py
│   │   │   ├── search.py
│   │   │   ├── social.py
│   │   │   └── uploads.py
│   │   └── utils/                 # Validators and text/avatar helpers
│   ├── tests/                     # Pytest suite
│   │   ├── conftest.py            # In-memory test database fixture
│   │   ├── test_auth.py
│   │   ├── test_users.py
│   │   ├── test_social.py
│   │   └── test_messages.py
│   ├── requirements.txt
│   └── .env
├── client/                         # React + TypeScript application
│   ├── src/                        # Pages, shared UI, typed API, auth store
│   ├── vite.config.ts              # Dev proxy and production /app/ base
│   └── package.json
└── README.md
```

---

## ⚡ Getting Started

### 1. Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Environment Configuration

Copy or edit `backend/.env`:
```env
APP_NAME="Real-Time Chat App"
APP_ENV=development
DEBUG=True
SECRET_KEY=replace-with-a-long-random-secret-before-deploying
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
DATABASE_URL=sqlite:///./chat.db

# Optional Cloudinary (uses local uploads directory if blank)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### 3. Install and build the React frontend

```bash
cd client
npm install
npm run build
```

Vite serves the source during development with `npm run dev` at `http://localhost:5173/app/`. Its `/api`, `/uploads`, and `/ws` requests proxy to FastAPI on port 8000. Run the backend at the same time.

With `APP_ENV=development`, request a login, registration, or password-reset code and use **123456** in the app. The code expires after `OTP_EXPIRE_MINUTES` and can be used once. The app displays it beside the code field in development. Demo codes and code responses are disabled outside development. Passkeys require a browser with WebAuthn support and a `localhost` origin; use `http://localhost:8000` or `http://localhost:5173` when testing them locally.

### 4. Start the Server

Install **FFmpeg and FFprobe** on the server before uploading Reels. Processing runs in a background worker started with the FastAPI app. Reel originals and processed media are stored in a private `reel_media` directory beside `UPLOAD_DIR`; include that directory in backups and provision persistent storage in production.
The existing startup schema update creates the additive Reel tables and indexes without replacing chat or social tables.
Reel media currently uses private local storage and signed one-hour playback links. Deploy it with persistent storage and a strong `SECRET_KEY`. An external object store, adaptive streaming, a licensed audio catalog, and a platform-wide Reel moderation console remain future infrastructure work.

```bash
# From the backend directory:
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The built React application will be live at:
- **Social home**: [http://localhost:8000/app/](http://localhost:8000/app/)
- **Chats**: [http://localhost:8000/app/chats](http://localhost:8000/app/chats)
- **Reels**: [http://localhost:8000/app/reels](http://localhost:8000/app/reels)
- **Communities**: [http://localhost:8000/app/communities](http://localhost:8000/app/communities)
- **Settings**: [http://localhost:8000/app/settings](http://localhost:8000/app/settings)
- **Interactive Swagger API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

The React application is the only frontend. The previous `social.html`, `chat.html`, `reels.html`, and auth URLs redirect to their React routes for existing bookmarks. Build the client before starting FastAPI so it can serve `/app/`.

---

## 🧪 Running Tests

To run the full backend test suite:

```bash
cd backend
python -m pytest -q
```

For frontend type checking and a production bundle, run `npm run build` from `client/`.

If a globally installed pytest plugin conflicts with this project, use
`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=. python -m pytest -q` from `backend`.

---

## 📡 WebSocket API

Connect to `ws://localhost:8000/ws?token=<YOUR_JWT_TOKEN>`

### Client to Server Events:
- `message`: `{ conversation_id: 1, content: "Hello", message_type: "TEXT", reply_to_id: null, attachments: [] }`
- `typing_start`: `{ conversation_id: 1 }`
- `typing_stop`: `{ conversation_id: 1 }`
- `read`: `{ conversation_id: 1 }`
- `ping`: `{}` (receives `pong`)

### Server to Client Events:
- `message`: Broadcast new message payload
- `message_edit`: Broadcast edited message
- `message_delete`: Broadcast soft-deleted status
- `reaction`: Broadcast updated emoji reactions
- `typing_start`: User started typing
- `typing_stop`: User stopped typing
- `read`: Read receipt notification
- `online`: Contact presence came online
- `offline`: Contact presence went offline
