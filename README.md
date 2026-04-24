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

#### 1. Create a new directory for your project

```bash
mkdir subsyncarr && cd subsyncarr
```

#### 2. Download the docker-compose.yml file

```bash
curl -O https://raw.githubusercontent.com/johnpc/subsyncarr/refs/heads/main/docker-compose.yaml
```

#### 3. Edit the docker-compose.yml file with your timezone and paths

```bash
TZ=America/New_York  # Adjust to your timezone
```

#### 4. Start the container

```bash
docker compose up -d
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PUID` | `1000` | User ID for file ownership. Run `id -u` to find yours. |
| `PGID` | `1000` | Group ID for file ownership. Run `id -g` to find yours. |
| `SCAN_PATHS` | `/scan_dir` | Comma-separated list of directories to scan |
| `EXCLUDE_PATHS` | _(none)_ | Comma-separated list of directories to exclude |
| `INCLUDE_ENGINES` | `ffsubsync,autosubsync,alass` | Comma-separated list of sync engines to use |
| `MAX_CONCURRENT_SYNC_TASKS` | `1` | Number of files to process in parallel |
| `SYNC_TIMEOUT` | _(none)_ | Timeout in seconds per sync operation. If a sync engine hangs, it will be killed and skipped after this duration. |

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
