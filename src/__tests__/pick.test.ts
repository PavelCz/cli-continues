import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSource, UnifiedSession } from '../types/index.js';

const testState = vi.hoisted(() => ({
  getAllSessions: vi.fn(),
  getSessionsByCwd: vi.fn(),
  getSessionsBySource: vi.fn(),
  resolveLaunchCwd: vi.fn((session: UnifiedSession, cwd?: string) => cwd || session.cwd),
  resume: vi.fn(),
  select: vi.fn(),
  selectTargetTool: vi.fn(),
  text: vi.fn(),
  withLaunchCwd: vi.fn((session: UnifiedSession, cwd: string) => ({ ...session, cwd })),
}));

vi.mock('@clack/prompts', () => ({
  cancel: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  },
  outro: vi.fn(),
  select: testState.select,
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  text: testState.text,
}));

vi.mock('../display/banner.js', () => ({
  showBanner: vi.fn(async () => false),
}));

vi.mock('../display/star-prompt.js', () => ({
  maybePromptGithubStar: vi.fn(async () => undefined),
}));

vi.mock('../utils/index.js', () => ({
  getAllSessions: testState.getAllSessions,
  getSessionsByCwd: testState.getSessionsByCwd,
  getSessionsBySource: testState.getSessionsBySource,
}));

vi.mock('../utils/resume.js', () => ({
  getResumeCommand: vi.fn(() => 'continues resume selected'),
  resolveCrossToolForwarding: vi.fn(() => ({ warnings: [] })),
  resolveLaunchCwd: testState.resolveLaunchCwd,
  resume: testState.resume,
  withLaunchCwd: testState.withLaunchCwd,
}));

vi.mock('../commands/_shared.js', () => ({
  selectTargetTool: testState.selectTargetTool,
  showForwardingWarnings: vi.fn(async () => undefined),
}));

const { interactivePick } = await import('../commands/pick.js');

function makeSession(id: string, source: SessionSource, cwd = process.cwd()): UnifiedSession {
  const now = new Date('2026-04-15T00:00:00.000Z');
  return {
    id,
    source,
    cwd,
    lines: 1,
    bytes: 100,
    createdAt: now,
    updatedAt: now,
    originalPath: `/tmp/${id}.jsonl`,
  };
}

describe('interactivePick native resume', () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    process.exitCode = undefined;
    testState.getAllSessions.mockReset();
    testState.getSessionsByCwd.mockReset();
    testState.getSessionsBySource.mockReset();
    testState.resolveLaunchCwd.mockClear();
    testState.resume.mockReset();
    testState.select.mockReset();
    testState.selectTargetTool.mockReset();
    testState.text.mockReset();
    testState.withLaunchCwd.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('lets an auto-selected session resume natively from a custom directory', async () => {
    const session = makeSession('only-cwd-session', 'codex');
    testState.getSessionsByCwd.mockResolvedValue([]);
    testState.getAllSessions.mockResolvedValue([session]);
    testState.selectTargetTool.mockResolvedValue('codex');
    testState.select.mockResolvedValue('custom');
    testState.text.mockResolvedValue('/tmp');

    await interactivePick({}, { isTTY: true, supportsColor: false, version: '0.0.0-test' });

    expect(testState.getAllSessions).toHaveBeenCalledTimes(1);
    expect(testState.selectTargetTool).toHaveBeenCalledWith(session, { excludeSource: false });
    expect(testState.resume).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp' }),
      'codex',
      'inline',
      undefined,
      expect.any(Object),
    );
  });
});
