# Use Node.js 18 Alpine for smaller size
FROM node:18-alpine AS base

# Install system dependencies for audio processing
RUN apk add --no-cache \
    python3 \
    py3-pip \
    python3-dev \
    ffmpeg \
    build-base \
    curl \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Install Python dependencies for audio processing
RUN pip3 install --no-cache-dir \
    librosa \
    scipy \
    numpy \
    matplotlib \
    soundfile \
    scikit-learn

# Copy application code
COPY src/ ./src/
COPY bin/ ./bin/

# Create directories for temporary files
RUN mkdir -p /app/temp /app/uploads /app/spectrograms

# Expose port (Railway will set PORT automatically)
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:$PORT/health || exit 1

# Start the application
CMD ["npm", "start"]
