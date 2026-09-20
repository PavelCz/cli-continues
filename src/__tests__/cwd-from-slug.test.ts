import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cwdFromSlug } from '../utils/slug.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

describe('cwdFromSlug', () => {
  it('bounds probes for missing paths with many ambiguous separators', () => {
    const exists = vi.mocked(fs.existsSync);
    const original = exists.getMockImplementation();
    let probes = 0;
    exists.mockImplementation(() => {
      if (++probes > 10_000) throw new Error('Unbounded slug search');
      return false;
    });
    try {
      const slug = 'private-tmp-missing-project-with-many-dashes-and-underscores-session-one-two-three';
      expect(cwdFromSlug(slug)).toBe(`/${slug.replaceAll('-', '/')}`);
      expect(probes).toBeLessThanOrEqual(10_000);
    } finally {
      exists.mockImplementation(original!);
    }
  });
  const itWindows = process.platform === 'win32' ? it : it.skip;

  itWindows('resolves Windows drive-letter slugs using existing path', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'continues-slug-'));
    const target = path.join(base, 'project-alpha');
    fs.mkdirSync(target, { recursive: true });

    const normalized = target.replace(/\\/g, '/');
    const slug = normalized.replace(':', '').replace(/[/.]/g, '-');
    const resolved = cwdFromSlug(slug).replace(/\\/g, '/');

    expect(resolved.toLowerCase()).toBe(normalized.toLowerCase());

    fs.rmSync(base, { recursive: true, force: true });
  });

  itWindows('falls back to drive-letter path format when no candidate exists', () => {
    expect(cwdFromSlug('D-Workspace-project-alpha')).toBe('D:/Workspace/project/alpha');
  });

  it('falls back to Unix path format for drive-letter-like slugs on non-Windows', () => {
    if (process.platform === 'win32') return;
    expect(cwdFromSlug('D-Workspace-project-alpha')).toBe('/D/Workspace/project/alpha');
  });

  it('keeps Unix fallback behavior for non-drive slugs', () => {
    expect(cwdFromSlug('Users-alice-my-project')).toBe('/Users/alice/my/project');
  });

  it('resolves existing Unix paths that contain literal dashes and underscores', () => {
    if (process.platform === 'win32') return;

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'continues-slug-'));
    try {
      const target = path.join(base, 'linux-data', 'code', 'clam', 'continuous_lam');
      fs.mkdirSync(target, { recursive: true });

      const normalized = target.replace(/\\/g, '/');
      const slug = normalized.replace(/^\//, '').replace(/[/.]/g, '-');

      expect(cwdFromSlug(slug)).toBe(normalized);
      expect(cwdFromSlug(slug.replaceAll('_', '-'))).toBe(normalized);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
