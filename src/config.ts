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

interface ResolvedScanConfig {
  config: ScanConfig;
  warnings: string[];
}

function resolveScanConfig(): ResolvedScanConfig {
  const parsedScanPaths = parsePathList(process.env.SCAN_PATHS);
  const scanPaths = parsedScanPaths.length > 0 ? parsedScanPaths : ['/scan_dir'];
  const excludePaths = parsePathList(process.env.EXCLUDE_PATHS);

  const includePaths = scanPaths.filter(validatePath);
  const validExcludePaths = excludePaths.filter(validatePath);

  const warnings = [
    ...scanPaths.filter((path) => !validatePath(path)).map((path) => `Invalid include path: ${path}`),
    ...excludePaths.filter((path) => !validatePath(path)).map((path) => `Invalid exclude path: ${path}`),
    ...includePaths
      .filter((path) => !existsSync(path))
      .map((path) => `Scan path does not exist: ${path} (is it mounted as a volume?)`),
  ];

  if (includePaths.length === 0) {
    warnings.push('No valid scan paths provided, defaulting to /scan_dir');
    includePaths.push('/scan_dir');
  }

  return { config: { includePaths, excludePaths: validExcludePaths }, warnings };
}

/** Resolves scan paths from the environment. Silent; call logScanConfig once at startup for diagnostics. */
export function getScanConfig(): ScanConfig {
  return resolveScanConfig().config;
}

/** Logs the resolved scan configuration and any invalid or missing paths. */
export function logScanConfig(): void {
  const { config, warnings } = resolveScanConfig();
  warnings.forEach((warning) => console.warn(`${new Date().toLocaleString()} ${warning}`));
  console.log(`${new Date().toLocaleString()} Scan configuration:`, config);
}

export function getRetentionConfig(): RetentionConfig {
  return {
    keepRunsDays: parseInt(process.env.RETENTION_KEEP_RUNS_DAYS || '30', 10),
    trimLogsDays: parseInt(process.env.RETENTION_TRIM_LOGS_DAYS || '7', 10),
    maxLogSizeBytes: parseInt(process.env.RETENTION_MAX_LOG_SIZE || '10000', 10),
    cleanupIntervalHours: parseInt(process.env.RETENTION_CLEANUP_INTERVAL_HOURS || '24', 10),
  };
}
