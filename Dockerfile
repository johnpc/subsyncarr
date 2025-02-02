# Use Node.js LTS (Long Term Support) as base image
FROM node:20-bullseye

# Set working directory
WORKDIR /app

RUN apt-get clean

# Install system dependencies including ffmpeg, Python, and cron
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Install pipx
RUN python3 -m pip install --user pipx \
    && python3 -m pipx ensurepath

# Add pipx to PATH
ENV PATH="/root/.local/bin:$PATH"

# Install ffsubsync and autosubsync using pipx
RUN pipx install ffsubsync \
    && pipx install autosubsync

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install Node.js dependencies while skipping husky installation
ENV HUSKY=0
RUN npm install --ignore-scripts

# Copy the rest of your application
COPY . .
RUN mv bin/* /root/.local/bin/

# Build TypeScript
RUN npm run build

# Create startup script
# Set default cron schedule (if not provided by environment variable)
ENV CRON_SCHEDULE="0 0 * * *"

# Create startup script with environment variable
RUN echo '#!/bin/bash\n\
# Add cron job\n\
echo "${CRON_SCHEDULE} cd /app && /usr/local/bin/node /app/dist/index.js >> /var/log/cron.log 2>&1" > /etc/cron.d/subsyncarr\n\
chmod 0644 /etc/cron.d/subsyncarr\n\
crontab /etc/cron.d/subsyncarr\n\
\n\
# Start cron\n\
service cron start\n\
\n\
# Run the initial instance of the app\n\
node dist/index.js\n\
\n\
# Keep container running\n\
tail -f /var/log/cron.log' > /app/startup.sh

# Make startup script executable
RUN chmod +x /app/startup.sh

# Create log file
RUN touch /var/log/cron.log

# Use startup script as entrypoint
CMD ["/app/startup.sh"]
