FROM python:3.11-slim

WORKDIR /app

# --------------------------------------------------
# System dependencies
# --------------------------------------------------
# gcc       -> build Python packages when required
# libpq-dev -> PostgreSQL dependencies
# ffmpeg    -> Reel/video processing
# --------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --------------------------------------------------
# Install Python dependencies
# --------------------------------------------------
COPY backend/requirements.txt ./backend/requirements.txt

RUN pip install --no-cache-dir -r ./backend/requirements.txt

# --------------------------------------------------
# Copy application
# --------------------------------------------------
COPY backend ./backend
COPY frontend ./frontend

# --------------------------------------------------
# Create required directories
# --------------------------------------------------
RUN mkdir -p \
    /app/backend/uploads \
    /app/backend/uploads/reels \
    /app/backend/uploads/temp \
    /var/data

# --------------------------------------------------
# Environment
# --------------------------------------------------
ENV PYTHONPATH=/app/backend
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# --------------------------------------------------
# Verify FFmpeg is installed during Docker build
# --------------------------------------------------
RUN ffmpeg -version

# --------------------------------------------------
# Port
# --------------------------------------------------
EXPOSE 8000

# --------------------------------------------------
# Start FastAPI
# --------------------------------------------------
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
