FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (gcc for builds, libpq-dev for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend and frontend code
COPY backend ./backend
COPY frontend ./frontend

# Create data directories
# /var/data is where Render mounts a Persistent Disk (paid plan)
RUN mkdir -p /app/backend/uploads /var/data

# Environment variables
ENV PYTHONPATH=/app/backend
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

# Start Uvicorn server
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
