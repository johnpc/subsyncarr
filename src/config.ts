import { existsSync } from 'fs';

export interface ScanConfig {
  includePaths: string[];
  excludePaths: string[];
}

export interface SuffixConfig {
  ffsubsync: string;
  autosubsync: string;
  alass: string;
}

export function getSuffixConfig(): SuffixConfig {
  return {
    ffsubsync: process.env.FFSUBSYNC_SUFFIX || 'ffsubsync',
    autosubsync: process.env.AUTOSUBSYNC_SUFFIX || 'autosubsync',
    alass: process.env.ALASS_SUFFIX || 'alass',
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

function parsePathList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
}

export function getScanConfig(): ScanConfig {
  const parsedScanPaths = parsePathList(process.env.SCAN_PATHS);
  const scanPaths = parsedScanPaths.length > 0 ? parsedScanPaths : ['/scan_dir'];
  const excludePaths = parsePathList(process.env.EXCLUDE_PATHS);

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

  validIncludePaths
    .filter((path) => !existsSync(path))
    .forEach((path) => {
      console.warn(`${new Date().toLocaleString()} Scan path does not exist: ${path} (is it mounted as a volume?)`);
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
