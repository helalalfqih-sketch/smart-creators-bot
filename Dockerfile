# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM python:3.13-slim AS base

# Install system dependencies: ffmpeg (required by yt-dlp) + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies first (for layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Create downloads directory
RUN mkdir -p downloads

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Expose port for Cloud Run
ENV PORT=8080
EXPOSE 8080

# Startup script will be used as entrypoint
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENTRYPOINT ["/start.sh"]
