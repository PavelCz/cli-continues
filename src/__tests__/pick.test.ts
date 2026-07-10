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
const { formatSessionForSelect } = await import('../display/format.js');

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

  it('groups all sessions by collapsible directory and sorts groups and sessions by recency', async () => {
    const olderA = {
      ...makeSession('older-a', 'codex', '/tmp/project-a'),
      updatedAt: new Date('2026-04-15T10:00:00.000Z'),
    };
    const newerA = {
      ...makeSession('newer-a', 'claude', '/tmp/project-a'),
      updatedAt: new Date('2026-04-15T12:00:00.000Z'),
    };
    const newestB = {
      ...makeSession('newest-b', 'codex', '/tmp/project-b'),
      updatedAt: new Date('2026-04-15T13:00:00.000Z'),
    };
    const olderB = {
      ...makeSession('older-b', 'claude', '/tmp/project-b'),
      updatedAt: new Date('2026-04-15T09:00:00.000Z'),
    };
    const snapshots: Array<Array<{ value: Record<string, unknown>; label: string }>> = [];
    let selectCall = 0;

    testState.getAllSessions.mockResolvedValue([olderA, olderB, newerA, newestB]);
    testState.selectTargetTool.mockResolvedValue('claude');
    testState.select.mockImplementation(
      async (config: { options: Array<{ value: Record<string, unknown>; label: string }> }) => {
        selectCall += 1;
        if (selectCall === 1) return 'all-in-scope';
        if (selectCall === 6) return 'current';

        snapshots.push(config.options);
        const projectA = config.options.find(
          (option) => option.value.kind === 'directory' && option.value.cwd === '/tmp/project-a',
        );
        if (selectCall === 2 || selectCall === 3 || selectCall === 4) return projectA?.value;
        return config.options.find(
          (option) =>
            option.value.kind === 'session' && (option.value.session as UnifiedSession | undefined)?.id === 'newer-a',
        )?.value;
      },
    );

    await interactivePick({ all: true }, { isTTY: true, supportsColor: false, version: '0.0.0-test' });

    const directoryCwds = snapshots[0]
      .filter((option) => option.value.kind === 'directory')
      .map((option) => option.value.cwd);
    const expandedAIds = snapshots[1]
      .filter((option) => option.value.kind === 'session')
      .map((option) => (option.value.session as UnifiedSession).id);

    expect(directoryCwds).toEqual(['/tmp/project-b', '/tmp/project-a']);
    expect(snapshots[0].every((option) => option.value.kind === 'directory')).toBe(true);
    expect(expandedAIds).toEqual(['newer-a', 'older-a']);
    expect(snapshots[2].every((option) => option.value.kind === 'directory')).toBe(true);
    expect(testState.resume).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'newer-a' }),
      'claude',
      'inline',
      undefined,
      expect.any(Object),
    );
  });
});

describe('session picker labels', () => {
  it('prefers the explicit session name over the first-message summary', () => {
    const session = {
      ...makeSession('named-session', 'codex'),
      name: 'Explicit session name',
      summary: 'First prompt',
    };

    const label = formatSessionForSelect(session);

    expect(label).toContain('Explicit session name');
    expect(label).not.toContain('First prompt');
  });
});
