# 🚀 Deployment Guide: Real-Time Chat App

This application is packaged as a **single, unified full-stack service**: FastAPI serves the REST API, the WebSocket server (`/ws`), file uploads (`/uploads`), and the built React frontend (`/app/`). The root URL redirects to `/app/`.

---

## 📋 Table of Contents
1. [Important Considerations for Real-Time Apps](#important-considerations-for-real-time-apps)
2. [Option 1: Render.com (Recommended for Quick Cloud Hosting)](#option-1-rendercom-recommended-for-quick-cloud-hosting)
3. [Option 2: Railway.app (Persistent Disks & Zero-Config WebSockets)](#option-2-railwayapp-persistent-disks--zero-config-websockets)
4. [Option 3: Docker & Docker Compose (Any Host / VPS)](#option-3-docker--docker-compose-any-host--vps)
5. [Option 4: Linux VPS (Ubuntu + Systemd + Nginx + Let's Encrypt SSL)](#option-4-linux-vps-ubuntu--systemd--nginx--lets-encrypt-ssl)
6. [Environment Variables Reference](#environment-variables-reference)

---

## ⚠️ Important Considerations for Real-Time Apps

1. **WebSockets Support**: The host must allow long-lived HTTP Upgrade connections (WebSockets). Render, Railway, Fly.io, and standard VPS hosts support WebSockets out of the box. Serverless platforms (like AWS Lambda or Vercel Serverless) are not suited for persistent WebSockets without external gateways.
2. **SQLite Persistence**: If using SQLite in production on PaaS platforms (like Render or Railway), attach a **Persistent Disk/Volume** so the `chat.db` database is not wiped on restarts or deployments. Alternatively, switch `DATABASE_URL` to PostgreSQL.
3. **Cloudinary for Files**: In production, configure Cloudinary credentials so uploaded images and attachments are preserved on Cloudinary's CDN rather than local ephemeral container storage.

---

## 🌐 Option 1: Render.com (Recommended for Quick Cloud Hosting)

Render provides a straightforward way to deploy FastAPI apps with WebSocket support.

### Step-by-Step Instructions:

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "chore: ready for deployment"
   git remote add origin https://github.com/<your-username>/realtime-chat-app.git
   git push -u origin main
   ```

2. **Create a new Web Service on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - Click **New +** > **Web Service**.
   - Connect your GitHub repository.

3. **Configure Settings**:
   - **Name**: `realtime-chat-app`
   - **Environment**: `Python 3`
   - **Region**: Choose the region closest to you
   - **Branch**: `main`
   - **Root Directory**: Leave blank (root of repository)
   - **Build Command**:
     ```bash
     pip install -r backend/requirements.txt
     ```
   - **Start Command**:
     ```bash
     PYTHONPATH=backend uvicorn app.main:app --host 0.0.0.0 --port $PORT
     ```

4. **Environment Variables**:
   In the **Environment** tab, add:
   - `PYTHONPATH`: `backend`
   - `SECRET_KEY`: Generate a secure random string (e.g. run `openssl rand -hex 32`)
   - `APP_ENV`: `production`
   - `DEBUG`: `False`
   - `DATABASE_URL`: `sqlite:////var/data/chat.db` (if using a persistent disk)
   - *(Optional Cloudinary)*:
     - `CLOUDINARY_CLOUD_NAME`: `your-cloud-name`
     - `CLOUDINARY_API_KEY`: `your-api-key`
     - `CLOUDINARY_API_SECRET`: `your-api-secret`

5. **Attach a Persistent Disk (Optional for SQLite)**:
   - In Render, scroll to **Disks** and click **Add Disk**.
   - Name: `chat-data`
   - Mount Path: `/var/data`
   - Size: `1 GB`

6. Click **Create Web Service**. Render will build and deploy your app with HTTPS and WSS enabled automatically!

---

## 🚂 Option 2: Railway.app (Persistent Disks & Zero-Config WebSockets)

Railway automatically detects Python applications and supports persistent volumes and WebSockets.

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select your `realtime-chat-app` repository.
4. Add a **Persistent Volume**:
   - Click your service > **Settings** > **Volumes** > **Add Volume**.
   - Mount path: `/app/data`
5. In **Variables**, add:
   - `PORT`: `8000`
   - `SECRET_KEY`: `<your-random-secret-key>`
   - `DATABASE_URL`: `sqlite:////app/data/chat.db`
   - `UPLOAD_DIR`: `/app/data/uploads`
6. In **Settings** > **Deploy**, Railway uses the `Dockerfile` or `Procfile` automatically.
7. Click **Generate Domain** under **Networking**.

---

## 🐳 Option 3: Docker & Docker Compose (Any Host / VPS)

You can run the entire application using Docker Compose with one command.

### 1. Build and Run Container:
```bash
docker compose up -d --build
```

### 2. Check Logs:
```bash
docker compose logs -f
```

### 3. Stop Container:
```bash
docker compose down
```

The database (`chat.db`) and uploaded files persist in the named Docker volume `chat_data`.

---

## 🖥️ Option 4: Linux VPS (Ubuntu 22.04/24.04 + Systemd + Nginx + SSL)

For full control, deploy on an Ubuntu droplet or VPS (DigitalOcean, Linode, AWS EC2, Hetzner).

### Step 1: Install System Dependencies
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv git nginx certbot python3-certbot-nginx
```

### Step 2: Clone the Project
```bash
cd /var/www
sudo git clone https://github.com/<your-username>/realtime-chat-app.git
sudo chown -R $USER:$USER /var/www/realtime-chat-app
cd /var/www/realtime-chat-app
```

### Step 3: Setup Virtual Environment
```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

### Step 4: Configure Environment Variables
Create `/var/www/realtime-chat-app/backend/.env`:
```env
APP_NAME="Real-Time Chat App"
APP_ENV=production
DEBUG=False
SECRET_KEY=generate_a_random_64_character_string_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
DATABASE_URL=sqlite:////var/www/realtime-chat-app/backend/chat.db

# Cloudinary (recommended for cloud storage)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### Step 5: Setup Systemd Service
Create `/etc/systemd/system/chat-app.service`:
```ini
[Unit]
Description=Real-Time Chat FastAPI Application
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/realtime-chat-app
EnvironmentFile=/var/www/realtime-chat-app/backend/.env
Environment="PYTHONPATH=/var/www/realtime-chat-app/backend"
ExecStart=/var/www/realtime-chat-app/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1

Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Ensure permissions:
```bash
sudo chown -R www-data:www-data /var/www/realtime-chat-app
sudo chmod -R 775 /var/www/realtime-chat-app/backend
sudo systemctl daemon-reload
sudo systemctl enable chat-app
sudo systemctl start chat-app
```

### Step 6: Configure Nginx with WebSocket Proxying
Edit `/etc/nginx/sites-available/chat-app`:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    server_name yourdomain.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        
        # WebSocket Upgrade Headers (Crucial!)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout adjustments
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/chat-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 7: Enable Free SSL with Certbot
```bash
sudo certbot --nginx -d yourdomain.com
```
Certbot will configure HTTPS and secure WebSockets (`wss://`) automatically!

---

## 🔑 Environment Variables Reference

### Staff password recovery email

Set these server-side variables before using **Forgot password?** on `/app/staff/login`:

| Variable | Purpose |
|---|---|
| `STAFF_RECOVERY_ORIGIN` | Trusted public HTTPS application origin, for example `https://relay.example.com`. Development may use `http://localhost:8000`. Do not include a path. |
| `SMTP_HOST` | Outgoing SMTP server. |
| `SMTP_PORT` | SMTP port; default `587` for STARTTLS. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | SMTP credentials, if required by your server. Set both together. |
| `SMTP_FROM_EMAIL` | Sender address authorized by your SMTP provider. |
| `SMTP_USE_SSL` | Set `true` for implicit TLS (usually port `465`); otherwise STARTTLS is required. |

Keep SMTP credentials in server environment secrets, never in the client bundle or source control. The recovery request endpoint returns a temporary-unavailable response until the origin and SMTP settings are configured. SMTP delivery should be verified against the actual provider before relying on recovery; the application cannot guarantee delivery if the mail server rejects a message.

To recover an existing staff account, configure SMTP, open `/app/staff/login`, choose **Forgot password?**, enter the registered staff email, and open the emailed link within 15 minutes. Enter the current code from the already enrolled authenticator and a new password of at least 12 characters. Recovery changes the password on the same account and signs out all sessions; it keeps the account ID, staff role, data, and TOTP enrollment. Sign in again with the new password and authenticator code. No existing plaintext password can be retrieved. Accounts without an enrolled TOTP factor cannot use this recovery path; an authorized administrator must use the existing audited staff management process, without a public bypass endpoint.

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `Real-Time Chat App` | Name displayed in docs and headers |
| `APP_ENV` | `development` | Set to `production` in live environments |
| `DEBUG` | `True` | Set to `False` in production |
| `SECRET_KEY` | *(Built-in key)* | Cryptographic key for signing JWTs (**Must change in production**) |
| `DATABASE_URL` | `sqlite:///./chat.db` | SQLAlchemy connection URL (SQLite or PostgreSQL) |
| `ACCESS_TOKEN_EXPIRE_MINUTES`| `10080` (7 days) | JWT expiration duration in minutes |
| `CLOUDINARY_CLOUD_NAME` | *(Empty)* | Cloudinary account name for cloud media storage |
| `CLOUDINARY_API_KEY` | *(Empty)* | Cloudinary API Key |
| `CLOUDINARY_API_SECRET` | *(Empty)* | Cloudinary API Secret |
| `UPLOAD_DIR` | `backend/uploads` | Path for local uploaded file storage |
| `PORT` | `8000` | Port listened by the server |

## Self-hosted WebRTC calls (Coturn)

WebRTC tries direct peer-to-peer routes first. STUN helps discover addresses, but carrier-grade NAT, symmetric NAT, and restrictive firewalls can still prevent a direct route. A TURN relay is required for reliable calls across those networks. This app uses native browser WebRTC and its existing authenticated FastAPI WebSocket at `/ws`; Coturn supplies STUN and TURN only. Media is not sent through FastAPI. Production refuses to return an ICE configuration unless the self-hosted STUN URL, TURN URLs, and shared secret are set.

### Ubuntu TURN VPS

Use a public IPv4 address and an A record such as `turn.example.com` pointing to it. A separate VPS is required when the API runs on Render: the Render web service handles HTTPS/WSS signaling, while Coturn needs public UDP listener and relay ports. On a single VPS, run Nginx/FastAPI on HTTPS 443 and Coturn on the ports below. Both arrangements use the same application settings.

```bash
sudo apt update
sudo apt install coturn certbot
openssl rand -hex 32
sudo certbot certonly --standalone -d turn.example.com
sudo install -m 600 deploy/coturn/turnserver.conf.example /etc/turnserver.conf
sudo nano /etc/turnserver.conf
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

Set `realm` and `server-name` to the TURN hostname, put the generated secret in `static-auth-secret`, and ensure Coturn can read the TLS certificate and key. Standalone Certbot needs inbound TCP 80 during issuance and renewal; on a shared VPS already running Nginx, use Certbot's Nginx or webroot challenge instead. On Ubuntu packages that require it, set `TURNSERVER_ENABLED=1` in `/etc/default/coturn` before starting. The example uses authenticated temporary allocations, fingerprinting, user and total allocation quotas, a bandwidth cap, and blocked loopback/multicast peers. Keep the secret outside Git and rotate it on both Coturn and FastAPI together. Use a dedicated certificate/deploy hook that renews the certificate and restarts Coturn, for example a root-owned script under `/etc/letsencrypt/renewal-hooks/deploy/` containing `systemctl restart coturn`; check permissions so the Coturn service can read the renewed key. If the VPS is behind one-to-one NAT, set `listening-ip`, `relay-ip`, and `external-ip=PUBLIC_IPV4/PRIVATE_IPV4` as shown in the example, and forward all relay ports. A VPS with its own public address usually does not need `external-ip`.

Open the following in both the VPS firewall and cloud security group:

| Port | Protocol | Use |
|---|---|---|
| 3478 | UDP and TCP | STUN and TURN |
| 5349 | TCP | TURN over TLS (`turns:`) |
| 49160–49260 | UDP | TURN media relay range in the example |
| 443 | TCP | Application HTTPS and WSS, if hosted on the same VPS |
| 80 | TCP | Certificate HTTP challenge and optional HTTP-to-HTTPS redirect |

For UFW: `sudo ufw allow 3478/udp`, `sudo ufw allow 3478/tcp`, `sudo ufw allow 5349/tcp`, and `sudo ufw allow 49160:49260/udp`. Allow SSH before enabling UFW. Check the certificate with `openssl s_client -connect turn.example.com:5349 -servername turn.example.com`. Networks that block all of these ports may need TURN/TLS on 443 on a **dedicated TURN IP**, because the application's HTTPS service may already use 443. Size the relay range and VPS bandwidth for concurrent calls; TURN relays both media directions, and video can consume far more bandwidth than audio. Watch Coturn allocation errors, CPU, outgoing transfer, port exhaustion, and certificate expiry. Avoid logging TURN credentials or SDP.

Set these on the FastAPI service (Render environment settings or the VPS service environment):

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=THE_SAME_RANDOM_SECRET_AS_COTURN
TURN_CREDENTIAL_TTL_SECONDS=3600
WEBRTC_ICE_TRANSPORT_POLICY=all
```

Only the backend and Coturn know `TURN_SHARED_SECRET`. `/api/calls/config` returns an HMAC-based, expiring Coturn REST username/password to the authenticated caller with `Cache-Control: no-store, private`. The client refreshes TURN credentials before expiry and requests a fresh ICE route; browser behavior for a long-lived existing allocation can vary, so verify calls lasting more than an hour on the target browsers. `WEBRTC_ICE_TRANSPORT_POLICY=relay` forces TURN for a **dedicated connectivity test**; restore `all` afterwards. Use HTTPS for the application so browsers grant microphone/camera access, and WSS for signaling. Set the application’s normal production cookie, origin, RP, and JWT secrets as described above.

The WebSocket connection manager and active-call registry are currently process-local. Run **one FastAPI worker and one application instance** until they are moved to a shared broker/store; multiple workers or replicas can route peers to different processes. The previous two-worker example above was changed for this reason. This is an availability/scaling limit, not a TURN limit.

### Reproducible call verification

Use two separate authenticated accounts. In a development build, open *Connection diagnostics* in each call; it shows signaling progress, selected direct/relay path, ICE state, packet loss, RTT, and bitrate without exposing IP addresses. Open browser WebRTC internals when deeper route details are needed. Verify that both clients reach `connected`, hear/see bidirectional media, and return to the chat after ending. Record actual device/browser/network combinations and outcomes rather than assuming local success proves internet connectivity.

1. On localhost, use two browser profiles and test audio, then video; verify both directions and hang-up on each side.
2. Repeat with two devices on one Wi-Fi, one on Wi-Fi and one on mobile data, two mobile networks, and networks with different NAT behavior.
3. Set `WEBRTC_ICE_TRANSPORT_POLICY=relay`, restart the API, and repeat. Both clients must show `TURN relay`. Test with the UDP TURN URL, then temporarily configure only the TCP URL, then only the TLS URL. Restore all URLs and `all` after testing.
4. On a restrictive network, verify TLS TURN and media in both directions. If it fails, check firewall/security-group rules, Coturn allocation logs, certificate validity, relay port forwarding, and `external-ip` mapping.
5. Deny microphone, then camera permissions separately; the UI should display an error and release any tracks. Decline an incoming call; place a second call while busy; close either participant’s browser; temporarily disable/re-enable a network connection; verify timeout, rejection, cleanup, and reconnection behavior.

The automated tests cover configuration and signaling authorization/state. They cannot establish a real media path, exercise NATs, or prove microphone/camera output. Complete the device/network matrix above on a deployed instance before claiming production connectivity.

### Browser session and MFA security

See [SECURITY_AUTH_PRIVACY.md](SECURITY_AUTH_PRIVACY.md) for the cookie migration,
CSRF API contract, encryption-key preservation, additive database migration,
rollback constraints and production checklist. Set `MFA_ENCRYPTION_KEY` before
production startup and preserve it with encrypted database backups. Keep
`WS_ALLOW_QUERY_TOKENS=false`; enable `HSTS_ENABLED` only after HTTPS is verified.
