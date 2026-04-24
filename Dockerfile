# === Build stage ===
FROM node:20-bullseye AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies
COPY package*.json ./
ENV HUSKY=0
RUN npm install --ignore-scripts && npm rebuild better-sqlite3

# Copy source and build
COPY . .
RUN mkdir -p /home/node/.local/bin/ && cp bin/* /home/node/.local/bin/ && chown -R node:node /home/node/.local
RUN npm run build

# Install Python tools as node user
USER node
RUN python3 -m pip install --user pipx \
    && python3 -m pipx ensurepath
ENV PATH="/home/node/.local/bin:$PATH"
RUN pipx install ffsubsync \
    && pipx install autosubsync \
    && python3 -m pip cache purge \
    && find /home/node/.local/share/pipx -type f -name "*.pyc" -delete 2>/dev/null || true \
    && find /home/node/.local/share/pipx -type d -name "__pycache__" -delete 2>/dev/null || true

# === Runtime stage ===
FROM node:20-slim

ENV PUID=1000
ENV PGID=1000
ENV CRON_SCHEDULE="0 0 * * *"
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV PATH="/home/node/.local/bin:$PATH"

# Install runtime dependencies and gosu
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    cron \
    curl \
    ca-certificates \
    && dpkgArch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/tianon/gosu/releases/download/1.17/gosu-$dpkgArch" -o /usr/local/bin/gosu \
    && chmod +x /usr/local/bin/gosu \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app from builder
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Copy alass binary
COPY --from=builder --chown=node:node /home/node/.local/bin/alass /home/node/.local/bin/alass

# Copy Python tools from builder
COPY --from=builder --chown=node:node /home/node/.local /home/node/.local

# Create data directory
RUN mkdir -p /app/data && chown node:node /app/data

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

USER root
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--optimize-for-size", "dist/index-server.js"]
