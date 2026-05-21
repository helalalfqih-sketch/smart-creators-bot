FROM python:3.13-slim

# Install system dependencies: ffmpeg (required by yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    fonts-noto \
    fonts-noto-extra \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (for layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .
# Explicitly copy .env so it's always present (not excluded by build-cache quirks)
COPY .env .env

# Create downloads directory
RUN mkdir -p downloads

# Expose port
ENV PORT=8080
EXPOSE 8080

# Use Python launcher to avoid bash CRLF issues
CMD ["python", "launcher.py"]
