import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSession } from '../types/index.js';

const getSessionsBySourceMock = vi.fn();
const nativeResumeMock = vi.fn();

vi.mock('../utils/index.js', () => ({
  getSessionsBySource: getSessionsBySourceMock,
}));

vi.mock('../utils/resume.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../utils/resume.js')>();
  return {
    ...orig,
    nativeResume: nativeResumeMock,
  };
});

const { resumeBySource } = await import('../commands/quick-resume.js');

function makeSession(): UnifiedSession {
  return {
    id: 'cursor-session-id',
    source: 'cursor',
    cwd: '/tmp/original-project',
    repo: 'test/repo',
    branch: 'main',
    summary: 'Test cwd override',
    lines: 10,
    bytes: 100,
    createdAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-15T00:00:00.000Z'),
    originalPath: '/tmp/original-project/session.jsonl',
  };
}

describe('resumeBySource cwd override', () => {
  const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
    // Silence command output during tests.
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
    // Silence error output during tests.
  });

  afterEach(() => {
    getSessionsBySourceMock.mockReset();
    nativeResumeMock.mockReset();
    chdirSpy.mockClear();
    logSpy.mockClear();
    errorSpy.mockClear();
    process.exitCode = undefined;
  });

  it('launches a quick resumed session from an explicit cwd override', async () => {
    const launchCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'continues-quick-cwd-'));
    try {
      getSessionsBySourceMock.mockResolvedValue([makeSession()]);

      await resumeBySource('cursor', 1, { cwd: launchCwd });

      expect(nativeResumeMock).toHaveBeenCalledTimes(1);
      expect(nativeResumeMock.mock.calls[0]?.[0]).toMatchObject({ cwd: launchCwd });
      expect(chdirSpy).toHaveBeenCalledWith(launchCwd);
    } finally {
      fs.rmSync(launchCwd, { recursive: true, force: true });
    }
  });

  it('rejects a missing explicit cwd override before native resume', async () => {
    const missingCwd = path.join(os.tmpdir(), `continues-missing-${Date.now()}`);
    getSessionsBySourceMock.mockResolvedValue([makeSession()]);

    await resumeBySource('cursor', 1, { cwd: missingCwd });

    expect(process.exitCode).toBe(1);
    expect(nativeResumeMock).not.toHaveBeenCalled();
    expect(chdirSpy).not.toHaveBeenCalledWith(missingCwd);
    expect(errorSpy.mock.calls.map((call) => call.join(' ')).join('\\n')).toContain('Working directory not found');
  });
});
