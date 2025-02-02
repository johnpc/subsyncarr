# Use Node.js LTS (Long Term Support) as base image
FROM node:20-bullseye

# Create app user and group with configurable UID/GID
ENV PUID=1000
ENV PGID=1000

RUN mkdir -p /app
RUN chown node:node /app

# Modify existing node user instead of creating new one
RUN groupmod -g ${PGID} node && \
    usermod -u ${PUID} -g ${PGID} node && \
    chown -R node:node /home/node
RUN apt-get clean

# Install system dependencies including ffmpeg, Python, and cron
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    cron \
    && rm -rf /var/lib/apt/lists/*

USER node
# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY --chown=node:node package*.json ./

# Install Node.js dependencies while skipping husky installation
ENV HUSKY=0
RUN npm install --ignore-scripts

# Copy the rest of your application
COPY --chown=node:node . .
RUN mkdir -p /home/node/.local/bin/
RUN cp bin/* /home/node/.local/bin/

# Build TypeScript
RUN npm run build

# Create startup script
# Set default cron schedule (if not provided by environment variable)
ENV CRON_SCHEDULE="0 0 * * *"

# Install pipx
RUN python3 -m pip install --user pipx \
    && python3 -m pipx ensurepath

# Add pipx to PATH
ENV PATH="/home/node/.local/bin:$PATH"

# Install ffsubsync and autosubsync using pipx
RUN pipx install ffsubsync \
    && pipx install autosubsync


# Create startup script with proper permissions
RUN echo '#!/bin/bash\n\
# Add cron job to user crontab\n\
crontab - <<EOF\n\
${CRON_SCHEDULE} cd /app && /usr/local/bin/node /app/dist/index.js >> /var/log/subsyncarr/cron.log 2>&1\n\
EOF\n\
\n\
# Run the initial instance of the app\n\
node dist/index.js\n\
mkdir -p /app/logs/\n\
touch /app/logs/app.log\n\
tail -f /app/logs/app.log' > /app/startup.sh

# Make startup script executable
RUN chmod +x /app/startup.sh

# Use startup script as entrypoint
CMD ["/app/startup.sh"]
