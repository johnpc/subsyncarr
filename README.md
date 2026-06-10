# Subsyncarr

An automated subtitle synchronization tool that runs as a Docker container. It continuously monitors your media directories for video files with out-of-sync subtitles and automatically synchronizes them using three sync engines (ffsubsync, autosubsync, and alass).

**Docker Hub:** [mrorbitman/subsyncarr](https://hub.docker.com/r/mrorbitman/subsyncarr)

## Features

### Core Functionality

- **Automated Subtitle Synchronization** - Syncs subtitles for your entire media library or specific folders.
- **Multiple Sync Engines** - Uses ffsubsync, autosubsync, and alass for maximum compatibility and success rate
- **Scheduled Processing** - Runs on a configurable cron schedule (default: daily at midnight) and on container startup
- **Parallel Processing** - Configure concurrent subtitle processing for faster library syncing
- **Skip Already Synced Files** - Avoids re-processing files that already have synchronized subtitles or where an engine repeatedly fails.
- **Processing History** - View past runs with detailed statistics, results, and logs
- **Configuration Dashboard** - View current settings, monitored paths, and schedule status
- **Configurable Timeouts** - Set per-engine timeout limits to prevent hung processes
- **Log Management** - Configurable retention policies with automatic trimming and deletion
- **Non Destructive** - Creates new files for each engine so no original files are altered. Allows easy switching between engines while watching content.

## Quick Start

### Using Docker Compose (Recommended)

1. **Create a docker-compose.yaml file** with the following content:

```yaml
name: subsyncarr

services:
  subsyncarr:
    image: mrorbitman/subsyncarr:latest
    container_name: subsyncarr
    ports:
      - '3000:3000' # Web UI
    volumes:
      # Mount your media directories
      - /path/to/movies:/movies
      - /path/to/tv:/tv
      - /path/to/anime:/anime
      - ./data:/app/data # Persist database across restarts
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 768M # Hard limit
        reservations:
          memory: 128M # Minimum guaranteed memory
    environment:
      - TZ=Etc/UTC # Replace with your own timezone
      - PUID=1000
      - PGID=10
      - CRON_SCHEDULE=0 0 * * * # Runs every day at midnight by default
      - SCAN_PATHS=/movies,/tv # Comma-separated paths to scan
      - EXCLUDE_PATHS=/movies/temp,/tv/downloads # Optional: exclude directories
      - MAX_CONCURRENT_SYNC_TASKS=1 # Number of parallel processing tasks
      - INCLUDE_ENGINES=ffsubsync,autosubsync,alass # Engines to use
```

2. **Update the configuration:**

   - Replace `/path/to/movies`, `/path/to/tv`, etc. with your actual media paths
   - Update `TZ` to your timezone (e.g., `America/New_York`, `Europe/London`)
   - Update `PUID` and `PGID` to match your user (run `id` command to find these)
   - Adjust `SCAN_PATHS` to match your mounted volumes

3. **Start the container:**

```bash
docker compose up -d
```

4. **Access the Web UI:**

Open your browser to [http://localhost:3000](http://localhost:3000) or whatever port you've mapped to inside docker.

### Using Docker Run

```bash
docker run -d \
  --name subsyncarr \
  -p 3000:3000 \
  -v /path/to/movies:/movies \
  -v /path/to/tv:/tv \
  -v ./data:/app/data \
  -e TZ=Etc/UTC \
  -e PUID=1000 \
  -e PGID=10 \
  -e CRON_SCHEDULE="0 0 * * *" \
  -e SCAN_PATHS=/movies,/tv \
  -e MAX_CONCURRENT_SYNC_TASKS=1 \
  mrorbitman/subsyncarr:latest
```

## Configuration

### Core Configuration

| Variable                    | Default                       | Description                                                                      |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `SCAN_PATHS`                | `/scan_dir`                   | Comma-separated directories to scan for SRT files (must be mounted as volumes)   |
| `EXCLUDE_PATHS`             | _(none)_                      | Comma-separated directories to exclude from scanning                             |
| `SYNC_LANGUAGES`            | _(none)_                      | Comma-separated language codes to sync (e.g., `en,de`). Only syncs subtitles with matching language tags in the filename (e.g., `movie.en.srt`). If not set, all subtitles are synced. |
| `CRON_SCHEDULE`             | `0 0 * * *`                   | Cron expression for sync schedule (daily at midnight), or `disabled` to turn off |
| `MAX_CONCURRENT_SYNC_TASKS` | `1`                           | Number of subtitle files to process in parallel (higher = faster but more CPU)   |
| `INCLUDE_ENGINES`           | `ffsubsync,autosubsync,alass` | Which sync engines to use (comma-separated)                                      |
| `FFSUBSYNC_SUFFIX`          | `ffsubsync`                   | Custom suffix for ffsubsync output files (e.g., `sdh` → `movie.en.sdh.srt`)     |
| `AUTOSUBSYNC_SUFFIX`        | `autosubsync`                 | Custom suffix for autosubsync output files (e.g., `cc` → `movie.en.cc.srt`)     |
| `ALASS_SUFFIX`              | `alass`                       | Custom suffix for alass output files (e.g., `forced` → `movie.en.forced.srt`)   |
| `SYNC_TIMEOUT`              | _(none)_                      | Timeout in seconds per sync operation (overrides SYNC_ENGINE_TIMEOUT_MS)         |
| `SYNC_ENGINE_TIMEOUT_MS`    | `1800000`                     | Timeout for each sync engine in milliseconds (30 min default)                    |
| `NODE_OPTIONS`             | `--max-old-space-size=512`    | Node.js options, used here to set memory limit (in MB)                           |
| `WEB_PORT`                 | `3000`                        | Port for the web UI                                                              |
| `WEB_HOST`                 | `127.0.0.1`                   | Host to bind the web UI to (`0.0.0.0` to expose externally)                     |
| `TZ`                        | _(system)_                    | Timezone for logging and cron scheduling (e.g., `America/New_York`)              |
| `PUID`                      | `1000`                        | User ID for file permissions (run `id -u` to find yours)                         |
| `PGID`                      | `1000`                        | Group ID for file permissions (run `id -g` to find yours)                        |

### Database & Log Configuration

| Variable                           | Default                        | Description                                 |
| ---------------------------------- | ------------------------------ | ------------------------------------------- |
| `DB_PATH`                          | `/app/data/subsyncarr.db` | SQLite database location                    |
| `LOG_BUFFER_SIZE`                  | `1000`                         | Ring buffer size for in-memory logs         |
| `RETENTION_KEEP_RUNS_DAYS`         | `30`                           | Keep complete runs for N days               |
| `RETENTION_TRIM_LOGS_DAYS`         | `7`                            | Trim logs after N days (keeps summary only) |
| `RETENTION_MAX_LOG_SIZE`           | `10000`                        | Max size for trimmed logs in bytes          |
| `RETENTION_CLEANUP_INTERVAL_HOURS` | `24`                           | How often to run cleanup (in hours)         |

### Timeout Configuration

The `SYNC_ENGINE_TIMEOUT_MS` environment variable controls how long each sync engine can run before being terminated. This prevents hung processes from blocking the queue.

Example configuration:

```yaml
environment:
  - SYNC_ENGINE_TIMEOUT_MS=3600000 # 60 minutes for large files
```


### Directory Structure

Your media directory should be organized with video files and their corresponding subtitle files using matching names:

```txt
/movies
├── Movie Title (2024).mkv
├── Movie Title (2024).srt          # Will be synchronized
├── Movie Title (2024).ffsubsync.srt # Generated output
└── Another Movie.mp4
    └── Another Movie.srt

/tv
├── Show Name/
│   ├── Season 01/
│   │   ├── Show.S01E01.mkv
│   │   └── Show.S01E01.srt
```

The app follows standard naming conventions compatible with Plex, Jellyfin, Emby, and Bazarr.

## Web UI

Subsyncarr Plus includes a comprehensive web-based monitoring interface accessible at `http://localhost:3000` after starting the container.

### UI Features

**Real-time Monitoring:**

- Live progress bars showing current processing status
- File-by-file status updates via WebSocket
- Engine-level detail (see which sync engine is running)
- Current and queued files display

**Manual Control:**

- **Start Full Run** - Process all configured directories immediately
- **Scan Specific Path** - Process a custom directory on demand
- **Stop Processing** - Cancel all remaining files in current run
- **Skip File** - Cancel processing for individual files

**File Management:**

- View completed and skipped files
- Clear processed files from the UI
- Track file status (pending, processing, completed, skipped, error)
- See matched video files for each subtitle

**Processing History:**

- Sortable run history table with timestamps
- Per-run statistics (total, completed, skipped, failed counts)
- Engine-level results summary with notation:
  - **F** = ffsubsync result
  - **Au** = autosubsync result
  - **Al** = alass result
- Duration tracking for each run
- View detailed logs for any past run with copy-to-clipboard functionality

**Configuration Dashboard:**

- Display of monitored paths and excluded paths
- Schedule status with next run time
- Human-readable cron schedule translation

### Database Persistence

Processing history is stored in SQLite and persists across container restarts. Ensure the data volume is mounted:

```yaml
volumes:
  - ./data:/app/data # Database and logs stored here
```

## Advanced Features

### Auto-Skip on Repeated Failures

The app intelligently tracks failures for each file/engine combination. After 3 consecutive failures, that engine will be automatically skipped for that specific file, preventing wasted processing time. You can reset skip status via the API endpoint `/api/skip-status/reset`.

### Memory Management

Optimized for low-memory environments with:

- Configurable memory limits (768MB default, 128MB minimum)
- SQLite optimizations for low RAM usage
- File-based logging with buffering to reduce memory pressure
- Automatic database vacuuming and cleanup
- Ring buffer for in-memory logs

### Log Retention & Cleanup

Automatic cleanup keeps your database size manageable:

- Complete runs retained for 30 days (configurable)
- Logs trimmed after 7 days, keeping only summaries
- Runs beyond retention period are automatically deleted
- Cleanup runs every 24 hours (configurable)

## Troubleshooting

### View Container Logs

```bash
docker logs -f subsyncarr
```

### Check Web UI Logs

Detailed processing logs are available in the Web UI under "Processing History" - click on any run to view full logs.

### Permission Issues

If you encounter permission errors, ensure `PUID` and `PGID` match your host user:

```bash
id -u  # Get your user ID
id -g  # Get your group ID
```

Then update your docker-compose.yaml with these values.

> **Note:** Do not use the `user:` directive in docker-compose or `--user` in docker run. The container must start as root so the entrypoint can configure file permissions using `PUID`/`PGID`, then drops to the unprivileged user automatically via `gosu`.

### Memory Issues

If the container is being killed due to OOM (Out Of Memory):

1. Reduce `MAX_CONCURRENT_SYNC_TASKS` to 1
2. Increase memory limit in `NODE_OPTIONS` (e.g., `--max-old-space-size=1024`)
3. Increase memory limit in docker-compose.yaml
4. Reduce `SYNC_ENGINE_TIMEOUT_MS` for faster timeouts
4. Exclude large files or problematic directories with `EXCLUDE_PATHS`

### Files Not Being Processed

Check that:

1. Your subtitle files are named to match video files (e.g., `movie.mkv` and `movie.srt`)
2. `SCAN_PATHS` matches your mounted volumes
3. Files haven't already been synced (check for `.ffsubsync.srt` files)
4. Files aren't being auto-skipped due to repeated failures (check skip status in Web UI)

## Docker Hub

Pull the latest image:

```bash
docker pull mrorbitman/subsyncarr:latest
```

**Docker Hub Repository:** [mrorbitman/subsyncarr](https://hub.docker.com/r/mrorbitman/subsyncarr)

## Contributing

Issues and pull requests are welcome! Please report bugs or suggest features via GitHub Issues.

## License

See LICENSE file for details.
