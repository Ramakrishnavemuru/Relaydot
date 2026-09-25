# 💬 Full Real-Time Chat Application

A high-performance, full-stack real-time chat application built with **FastAPI**, **WebSockets**, **SQLAlchemy**, **SQLite**, and modern **Vanilla HTML/CSS/JavaScript**.

---

## 🚀 Features

- **🔐 Robust Authentication & Security**:
  - User Registration, Login, Logout
  - Secure bcrypt password hashing with salt
  - JWT Bearer Token authorization
  - Change password & Forgot/Reset password flows
  - Strict input validation via Pydantic & Regex sanitization
  - CORS configuration and authorization verification on every request

- **👤 User Profiles & Privacy**:
  - Search users by username or display name
  - Change display name, bio, and profile picture
  - Online presence indicator & "Last seen" timestamps
  - Granular privacy toggles: hide/show last seen, hide/show online status, hide/show read receipts
  - Block & unblock users with backend enforcement preventing direct messages

- **💬 1-to-1 & Group Messaging**:
  - Instant real-time messaging via WebSockets with persistent storage in SQLite
  - Group chats: Create groups, add/remove members, promote/demote admins, leave group, customize group name and avatar
  - Message replies with quote preview
  - Edit sent messages with `(edited)` indicator
  - Soft delete messages ("This message was deleted")
  - Emoji reactions (👍, ❤️, 😂, 😮, 😢, 🔥, 🎉) with toggle support
  - Read receipts (`✓` Sent, `✓✓` Delivered, `✓✓` Read)
  - Ephemeral typing indicators ("Rahul is typing...") with bouncing animation
  - Search messages across all joined conversations

- **📎 File & Media Sharing**:
  - Cloudinary free tier integration with seamless local storage fallback
  - Image previews inline, documents and PDFs with download links and file size display
  - Upload size limit and file type validation

- **🔔 Notifications**:
  - Web Audio API synthesized notification chimes (0 external audio dependencies)
  - Browser Desktop Web Notifications API integration
  - Unread message counters on conversation list

- **📱 Fully Responsive Design**:
  - Sleek desktop multi-column interface
  - Mobile sliding drawer interface with back navigation
  - Modern glassmorphic dark theme

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| **Backend** | Python 3.10+, FastAPI, Starlette |
| **Real-time** | WebSockets |
| **Database** | SQLite with Foreign Key pragma support |
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
│   │   │   └── block.py
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
│   │   │   └── uploads.py
│   │   └── utils/                 # Validators and text/avatar helpers
│   ├── tests/                     # Pytest suite
│   │   ├── conftest.py            # In-memory test database fixture
│   │   ├── test_auth.py
│   │   ├── test_users.py
│   │   └── test_messages.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── index.html                 # Landing / auth redirect
│   ├── login.html                 # Login & forgot password
│   ├── register.html              # Registration
│   ├── chat.html                  # Main real-time chat interface
│   ├── profile.html               # Profile page
│   ├── settings.html              # Settings page
│   ├── css/
│   │   ├── global.css
│   │   ├── auth.css
│   │   ├── chat.css
│   │   ├── profile.css
│   │   └── responsive.css
│   └── js/
│       ├── config.js
│       ├── utils.js
│       ├── api.js
│       ├── auth.js
│       ├── websocket.js
│       ├── notifications.js
│       ├── users.js
│       ├── groups.js
│       ├── profile.js
│       └── chat.js
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
SECRET_KEY=super-secret-jwt-key-for-realtime-chat-app-2026-production-ready
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
DATABASE_URL=sqlite:///./chat.db

# Optional Cloudinary (uses local uploads directory if blank)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### 3. Start the Server

```bash
# From the backend directory:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The application will be live at:
- **Web App**: [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## 🧪 Running Tests

To run the full backend test suite:

```bash
PYTHONPATH=backend pytest backend/tests -v
```

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
