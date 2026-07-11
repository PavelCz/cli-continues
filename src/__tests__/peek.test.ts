import { describe, expect, it } from 'vitest';
import type { SessionContext, UnifiedSession } from '../types/index.js';
import { renderPeekMarkdown } from '../utils/peek.js';

function makeContext(): SessionContext {
  const session: UnifiedSession = {
    id: 'peek-session',
    source: 'codex',
    cwd: '/tmp/project',
    lines: 10,
    bytes: 1000,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    updatedAt: new Date('2026-07-02T11:00:00.000Z'),
    originalPath: '/tmp/peek-session.jsonl',
    summary: 'Fix the parser',
  };
  return {
    session,
    recentMessages: [
      {
        role: 'user',
        content: 'Please fix the parser',
        timestamp: new Date('2026-07-02T10:00:00.000Z'),
      },
      { role: 'assistant', content: 'Done, the parser now passes.' },
    ],
    filesModified: [],
    pendingTasks: [],
    toolSummaries: [],
    markdown: '# full handoff',
  };
}

describe('renderPeekMarkdown', () => {
  it('renders a header and each recent message with role and content', () => {
    const output = renderPeekMarkdown(makeContext());

    expect(output).toContain('peek-session');
    expect(output).toContain('/tmp/peek-session.jsonl');
    expect(output).toContain('User');
    expect(output).toContain('Please fix the parser');
    expect(output).toContain('Assistant');
    expect(output).toContain('Done, the parser now passes.');
    expect(output.indexOf('Please fix the parser')).toBeLessThan(output.indexOf('Done, the parser now passes.'));
  });

  it('says so when the session has no recent messages', () => {
    const context = { ...makeContext(), recentMessages: [] };
    expect(renderPeekMarkdown(context)).toContain('No conversation messages');
  });
});
