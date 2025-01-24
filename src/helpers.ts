import { promisify } from 'util';
import { exec } from 'child_process';

export interface ProcessingResult {
  success: boolean;
  message: string;
}

export const execPromise = promisify(exec);
