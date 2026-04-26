#!/bin/bash

# Adjust node user UID/GID at runtime if PUID/PGID are set
PUID=${PUID:-1000}
PGID=${PGID:-1000}

if [ "$(id -u node)" != "$PUID" ] || [ "$(id -g node)" != "$PGID" ]; then
  groupmod -o -g "$PGID" node
  usermod -o -u "$PUID" node
  chown -R node:node /home/node
fi

# Always fix ownership on /app/data — it's a mounted volume with unpredictable ownership
chown -R node:node /app/data

exec gosu node "$@"
