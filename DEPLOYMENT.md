# 🚀 Deployment Guide: Real-Time Chat App

This application is packaged as a **single, unified full-stack service**: FastAPI serves both the REST API, the WebSocket server (`/ws`), the file storage/uploads (`/uploads`), and the frontend static assets (`/`).

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
ExecStart=/var/www/realtime-chat-app/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2

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
