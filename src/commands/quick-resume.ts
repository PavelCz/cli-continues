import chalk from 'chalk';
import { formatSessionColored } from '../display/format.js';
import type { SessionSource } from '../types/index.js';
import { getSessionsBySource } from '../utils/index.js';
import { nativeResume, resolveLaunchCwd, withLaunchCwd } from '../utils/resume.js';

/**
 * Resume Nth session from a specific source tool
 */
export async function resumeBySource(source: SessionSource, n: number, options: { cwd?: string } = {}): Promise<void> {
  try {
    const sessions = await getSessionsBySource(source);

    if (sessions.length === 0) {
      console.log(chalk.yellow(`No ${source} sessions found.`));
      return;
    }

    const index = Math.max(0, Math.min(n - 1, sessions.length - 1));
    const session = sessions[index];

    console.log(chalk.gray(`Resuming ${source} session #${index + 1}:`));
    console.log(formatSessionColored(session));
    console.log();

    const launchCwd = resolveLaunchCwd(session, options.cwd);
    const launchSession = withLaunchCwd(session, launchCwd);

    if (options.cwd) {
      console.log(chalk.gray('Working directory: ') + chalk.cyan(launchCwd));
      console.log();
    }

    process.chdir(launchCwd);
    await nativeResume(launchSession);
  } catch (error) {
    console.error(chalk.red('Error:'), (error as Error).message);
    process.exitCode = 1;
  }
}
