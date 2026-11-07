import { buildOutputPath, execPromise, ProcessingResult } from './helpers';
import { existsSync } from 'fs';
import { getSuffixConfig } from './config';
import { unsupportedFormatResult } from './subtitleFormats';

export async function generateAutosubsyncSubtitles(srtPath: string, videoPath: string): Promise<ProcessingResult> {
  const unsupported = unsupportedFormatResult('autosubsync', srtPath);
  if (unsupported) return unsupported;

  const outputPath = buildOutputPath(srtPath, getSuffixConfig().autosubsync);

  const exists = existsSync(outputPath);
  if (exists) {
    return {
      success: true,
      message: `Skipping ${outputPath} - already processed`,
      skipped: true,
    };
  }

  try {
    const command = `autosubsync "${videoPath}" "${srtPath}" "${outputPath}"`;
    console.log(`${new Date().toLocaleString()} Processing: ${command}`);
    const { stdout, stderr } = await execPromise(command);
    return {
      success: true,
      message: `Successfully processed: ${outputPath}`,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('SIGTERM') || /timed out/i.test(errorMessage);

    // Extract stdout/stderr from error if available
    const execError = error as { stdout?: string; stderr?: string };
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';

    if (isTimeout) {
      return {
        success: false,
        message: `Timeout: ${outputPath} took longer than allowed timeout`,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      };
    }

    return {
      success: false,
      message: `Error processing ${outputPath}: ${errorMessage}`,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    };
  }
}
