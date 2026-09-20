import * as fs from 'node:fs';
import { IS_WINDOWS } from './platform.js';

// Missing dash-heavy paths otherwise expand into 4^(dash count) filesystem probes.
const MAX_CANDIDATE_CHECKS = 10_000;

/**
 * Derive cwd from a slug directory name using recursive backtracking.
 * Slugs replace `/` and `.` with `-` in the directory name, e.g.:
 *   "Users-evolution-Sites-localhost-dzcm-test" → "/Users/evolution/Sites/localhost/dzcm.test"
 *
 * At each dash, tries: path separator `/`, dot `.`, literal `-`, or `_`.
 * Validates candidates with fs.existsSync(). Falls back to naive slash replacement.
 */
export function cwdFromSlug(slug: string): string {
  const parts = slug.split('-');
  let best: string | null = null;
  let candidateChecks = 0;
  const checkedPaths = new Map<string, boolean>();
  const isDriveSlug = parts.length > 0 && /^[A-Za-z]$/.test(parts[0] || '');

  function exists(candidate: string): boolean {
    const cached = checkedPaths.get(candidate);
    if (cached !== undefined) return cached;
    if (candidateChecks >= MAX_CANDIDATE_CHECKS) return false;
    candidateChecks++;
    const found = fs.existsSync(candidate);
    checkedPaths.set(candidate, found);
    return found;
  }

  function candidatePaths(segments: string[]): string[] {
    const unixPath = '/' + segments.join('/');
    if (segments.length > 0 && /^[A-Za-z]$/.test(segments[0] || '')) {
      const drive = segments[0].toUpperCase();
      const rest = segments.slice(1).join('/');
      const winPath = rest ? `${drive}:/${rest}` : `${drive}:/`;
      // On Windows prefer drive-letter paths; on Unix keep legacy order.
      return IS_WINDOWS ? [winPath, unixPath] : [unixPath, winPath];
    }
    return [unixPath];
  }

  function resolve(idx: number, segments: string[]): void {
    if (best || candidateChecks >= MAX_CANDIDATE_CHECKS) return;

    if (idx >= parts.length) {
      for (const p of candidatePaths(segments)) {
        if (candidateChecks >= MAX_CANDIDATE_CHECKS) break;
        if (exists(p)) {
          best = p;
          break;
        }
      }
      return;
    }

    const part = parts[idx];

    // A separator finalizes the current directory. Prune nonexistent prefixes
    // before exploring descendants, preserving the original candidate order
    // while leaving the probe budget available for real dash/underscore paths.
    if (segments.length === 0 || candidatePaths(segments).some(exists)) {
      resolve(idx + 1, [...segments, part]);
    }
    if (best) return;

    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      const rest = segments.slice(0, -1);

      // Option 2: treat dash as dot (e.g. dzcm-test → dzcm.test)
      resolve(idx + 1, [...rest, last + '.' + part]);
      if (best) return;

      // Option 3: keep as literal dash (e.g. laravel-contentai)
      resolve(idx + 1, [...rest, last + '-' + part]);
      if (best) return;

      // Option 4: treat dash as underscore (e.g. continuous-lam -> continuous_lam)
      resolve(idx + 1, [...rest, last + '_' + part]);
    }
  }

  resolve(0, []);
  if (best) return best;

  if (isDriveSlug && IS_WINDOWS) {
    const drive = parts[0].toUpperCase();
    const rest = parts.slice(1).join('/');
    return rest ? `${drive}:/${rest}` : `${drive}:/`;
  }

  return '/' + slug.replace(/-/g, '/');
}

/**
 * Check if a session's cwd matches or is a subdirectory of targetDir.
 * Returns false for empty session cwds or root `/` target.
 */
export function matchesCwd(sessionCwd: string, targetDir: string): boolean {
  if (!sessionCwd || !targetDir) return false;
  const normTarget = targetDir.replace(/\/+$/, '');
  if (normTarget === '') return false; // guard against root '/'
  const normSession = sessionCwd.replace(/\/+$/, '');
  return normSession === normTarget || normSession.startsWith(normTarget + '/');
}
