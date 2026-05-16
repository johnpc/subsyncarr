export interface ScanConfig {
  includePaths: string[];
  excludePaths: string[];
}

export interface SyncRetryConfig {
  /** Offset threshold in ms that triggers a retry (default: 5000 = 5 seconds) */
  thresholdMs: number;
  /** Maximum number of retry attempts after the first sync (default: 1) */
  maxRetries: number;
}

export function getSyncRetryConfig(): SyncRetryConfig {
  const thresholdMs = parseInt(process.env.SYNC_RETRY_THRESHOLD_MS || '5000', 10);
  const maxRetries = parseInt(process.env.SYNC_MAX_RETRIES || '1', 10);
  return {
    thresholdMs: isNaN(thresholdMs) || thresholdMs <= 0 ? 5000 : thresholdMs,
    maxRetries: isNaN(maxRetries) || maxRetries < 0 ? 1 : maxRetries,
  };
}

export interface RetentionConfig {
  keepRunsDays: number; // Keep complete runs for N days
  trimLogsDays: number; // Trim logs after N days
  maxLogSizeBytes: number; // Max size for trimmed logs
  cleanupIntervalHours: number; // How often to run cleanup
}

function validatePath(path: string): boolean {
  // Add any path validation logic you need
  return path.startsWith('/') && !path.includes('..');
}

export function getScanConfig(): ScanConfig {
  const scanPaths = process.env.SCAN_PATHS?.split(',').filter(Boolean) || ['/scan_dir'];
  const excludePaths = process.env.EXCLUDE_PATHS?.split(',').filter(Boolean) || [];

  // Validate paths
  const validIncludePaths = scanPaths.filter((path) => {
    const isValid = validatePath(path);
    if (!isValid) {
      console.warn(`${new Date().toLocaleString()} Invalid include path: ${path}`);
    }
    return isValid;
  });

  const validExcludePaths = excludePaths.filter((path) => {
    const isValid = validatePath(path);
    if (!isValid) {
      console.warn(`${new Date().toLocaleString()} Invalid exclude path: ${path}`);
    }
    return isValid;
  });

  if (validIncludePaths.length === 0) {
    console.warn(`${new Date().toLocaleString()} No valid scan paths provided, defaulting to /scan_dir`);
    validIncludePaths.push('/scan_dir');
  }

  console.log(`${new Date().toLocaleString()} Scan configuration:`, {
    includePaths: validIncludePaths,
    excludePaths: validExcludePaths,
  });

  return {
    includePaths: validIncludePaths,
    excludePaths: validExcludePaths,
  };
}

export function getRetentionConfig(): RetentionConfig {
  return {
    keepRunsDays: parseInt(process.env.RETENTION_KEEP_RUNS_DAYS || '30', 10),
    trimLogsDays: parseInt(process.env.RETENTION_TRIM_LOGS_DAYS || '7', 10),
    maxLogSizeBytes: parseInt(process.env.RETENTION_MAX_LOG_SIZE || '10000', 10),
    cleanupIntervalHours: parseInt(process.env.RETENTION_CLEANUP_INTERVAL_HOURS || '24', 10),
  };
}
