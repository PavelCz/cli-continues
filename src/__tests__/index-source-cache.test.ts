import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSource, UnifiedSession } from '../types/index.js';

const testState = vi.hoisted(() => ({
  fakeHome: `/tmp/continues-index-source-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  parseClaude: vi.fn(),
  parseCodex: vi.fn(),
  parseCursor: vi.fn(),
}));

vi.mock('../utils/parser-helpers.js', () => ({
  homeDir: () => testState.fakeHome,
}));

vi.mock('../parsers/registry.js', () => ({
  ALL_TOOLS: ['claude', 'codex', 'cursor'],
  adapters: {
    cursor: {
      name: 'cursor',
      parseSessions: testState.parseCursor,
      supportsCwdLookup: true,
      supportsCwdTreeLookup: true,
    },
    claude: {
      name: 'claude',
      envVar: 'CLAUDE_CONFIG_DIR',
      parseSessions: testState.parseClaude,
      supportsCwdLookup: true,
    },
    codex: {
      name: 'codex',
      envVar: 'CODEX_HOME',
      parseSessions: testState.parseCodex,
    },
  },
}));

const { getAllSessions, getSessionsByCwd, getSessionsBySource } = await import('../utils/index.js');

function makeSession(id: string, source: SessionSource, cwd = '/tmp/project'): UnifiedSession {
  return {
    id,
    source,
    cwd,
    lines: 0,
    bytes: 100,
    createdAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-15T00:00:00.000Z'),
    originalPath: `/tmp/${id}.jsonl`,
    summary: `${source} session`,
  };
}

describe('source-scoped session index', () => {
  beforeEach(() => {
    fs.rmSync(testState.fakeHome, { recursive: true, force: true });
    testState.parseClaude.mockReset();
    testState.parseCodex.mockReset();
    testState.parseCursor.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    fs.rmSync(testState.fakeHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('source lookups rebuild only the requested source when no cache exists', async () => {
    testState.parseClaude.mockResolvedValue([makeSession('claude-1', 'claude')]);
    testState.parseCodex.mockResolvedValue([makeSession('codex-1', 'codex')]);

    const sessions = await getSessionsBySource('claude');

    expect(sessions.map((session) => session.id)).toEqual(['claude-1']);
    expect(testState.parseClaude).toHaveBeenCalledWith({ lightweight: true });
    expect(testState.parseCodex).not.toHaveBeenCalled();
  });

  it('source lookups reuse the source cache on repeated calls', async () => {
    testState.parseClaude.mockResolvedValue([makeSession('claude-1', 'claude')]);

    await getSessionsBySource('claude');
    const sessions = await getSessionsBySource('claude');

    expect(sessions.map((session) => session.id)).toEqual(['claude-1']);
    expect(testState.parseClaude).toHaveBeenCalledTimes(1);
  });

  it('full rebuild clears stale per-source caches for tools with zero sessions', async () => {
    testState.parseCodex.mockResolvedValue([makeSession('codex-old', 'codex')]);
    await getSessionsBySource('codex');

    testState.parseClaude.mockResolvedValue([makeSession('claude-1', 'claude')]);
    testState.parseCodex.mockResolvedValue([]);
    await getAllSessions(true);

    testState.parseCodex.mockClear();
    const sessions = await getSessionsBySource('codex');

    expect(sessions).toEqual([]);
    expect(testState.parseCodex).not.toHaveBeenCalled();
  });

  it('cwd lookups narrow only tree-aware adapters and retain subdirectory sessions', async () => {
    testState.parseClaude.mockResolvedValue([makeSession('claude-1', 'claude', '/tmp/project/subdir')]);
    testState.parseCodex.mockResolvedValue([makeSession('codex-1', 'codex', '/tmp/project')]);

    const sessions = await getSessionsByCwd('/tmp/project');

    expect(sessions.map((session) => session.id)).toEqual(['claude-1', 'codex-1']);
    expect(testState.parseClaude).toHaveBeenCalledWith({ lightweight: true });
    expect(testState.parseCodex).toHaveBeenCalledWith({ lightweight: true });
    expect(testState.parseCursor).toHaveBeenCalledWith({ lightweight: true, cwd: '/tmp/project' });
  });

  it('scoped rebuilds do not replace global or source caches', async () => {
    const elsewhere = makeSession('elsewhere', 'cursor', '/tmp/elsewhere');
    testState.parseClaude.mockResolvedValue([]);
    testState.parseCodex.mockResolvedValue([]);
    testState.parseCursor.mockResolvedValue([elsewhere]);
    await getAllSessions(true);
    testState.parseCursor.mockResolvedValue([makeSession('local', 'cursor')]);

    expect((await getSessionsByCwd('/tmp/project', true)).map((s) => s.id)).toEqual(['local']);
    expect((await getAllSessions()).map((s) => s.id)).toEqual(['elsewhere']);
    expect((await getSessionsBySource('cursor')).map((s) => s.id)).toEqual(['elsewhere']);
  });

  it('a cold scoped scan does not create a partial global cache', async () => {
    testState.parseClaude.mockResolvedValue([]);
    testState.parseCodex.mockResolvedValue([]);
    testState.parseCursor.mockResolvedValue([makeSession('local', 'cursor')]);
    await getSessionsByCwd('/tmp/project');
    testState.parseCursor.mockResolvedValue([makeSession('elsewhere', 'cursor', '/tmp/elsewhere')]);
    expect((await getAllSessions()).map((s) => s.id)).toEqual(['elsewhere']);
    expect(testState.parseCursor).toHaveBeenLastCalledWith({ lightweight: true });
  });
});
