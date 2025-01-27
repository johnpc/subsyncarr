# Subsyncarr

An automated subtitle synchronization tool that runs as a Docker container. It watches a directory for video files with matching subtitles and automatically synchronizes them using both ffsubsync and autosubsync.

## Features

- Automatically scans directory for video files and their corresponding subtitles
- Uses both ffsubsync and autosubsync for maximum compatibility
- Runs on a schedule (daily at midnight) and on container startup
- Supports common video formats (mkv, mp4, avi, mov)
- Docker-based for easy deployment
- Generates synchronized subtitle files with `.ffsubsync.srt` and `.autosubsync.srt` extensions

## Quick Start

### Using Docker Compose (Recommended)

#### 1. Create a new directory for your project:

```bash
mkdir subsyncarr && cd subsyncarr
```

#### 2. Download the docker-compose.yml file:

```bash
curl -O https://raw.githubusercontent.com/johnpc/subsyncarr/main/docker-compose.yml
```

#### 3. Edit the docker-compose.yml file with your timezone and paths:

```bash
TZ=America/New_York  # Adjust to your timezone
```

#### 4. Start the container:

```bash
docker compose up -d
```

## Configuration

The container is configured to:

- Scan for subtitle files in the mounted directory
- Run synchronization at container startup
- Run daily at midnight (configurable via cron)
- Generate synchronized subtitle versions using different tools (currently ffsubsync and autosubsync)

### Directory Structure

Your media directory should be organized as follows:

```txt
/media
├── movie1.mkv
├── movie1.srt
├── movie2.mp4
└── movie2.srt
```

It should follow the naming conventions expected by other services like Bazarr and Jellyfin.

## Logs

View container logs:

```bash
docker logs -f subsyncarr
```
