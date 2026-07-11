import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnifiedSession } from "../types/index.js";

const testState = vi.hoisted(() => ({ home: "" }));

vi.mock("../utils/parser-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/parser-helpers.js")>()),
  homeDir: () => testState.home,
}));

const tmpDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function loadClaudeParser(
  configDir: string,
): Promise<typeof import("../parsers/claude.js")> {
  vi.resetModules();
  vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
  return import("../parsers/claude.js");
}

function makeSession(cwd: string, originalPath: string): UnifiedSession {
  const now = new Date("2026-07-10T00:00:00.000Z");
  return {
    id: "sid-1234",
    source: "claude",
    cwd,
    lines: 1,
    bytes: 100,
    createdAt: now,
    updatedAt: now,
    originalPath,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("relocateClaudeSessionForCwd", () => {
  it("moves the session file into the launch cwd slug folder and keeps a backup", async () => {
    const configDir = makeTmpDir("claude-relocate-");
    testState.home = makeTmpDir("claude-relocate-home-");
    const { relocateClaudeSessionForCwd } = await loadClaudeParser(configDir);

    const originalDir = path.join(configDir, "projects", "-old-project");
    const originalPath = path.join(originalDir, "sid-1234.jsonl");
    fs.mkdirSync(originalDir, { recursive: true });
    fs.writeFileSync(originalPath, '{"type":"user"}\n');

    relocateClaudeSessionForCwd(makeSession("/new/launch_dir", originalPath));

    const movedPath = path.join(
      configDir,
      "projects",
      "-new-launch-dir",
      "sid-1234.jsonl",
    );
    const backupPath = path.join(
      testState.home,
      ".continues",
      "backups",
      "claude",
      "-old-project",
      "sid-1234.jsonl",
    );
    expect(fs.existsSync(movedPath)).toBe(true);
    expect(fs.existsSync(originalPath)).toBe(false);
    expect(fs.readFileSync(backupPath, "utf8")).toBe('{"type":"user"}\n');
  });

  it("invalidates the cached session index after a move", async () => {
    const configDir = makeTmpDir("claude-relocate-");
    testState.home = makeTmpDir("claude-relocate-home-");
    const { relocateClaudeSessionForCwd } = await loadClaudeParser(configDir);

    const continuesDir = path.join(testState.home, ".continues");
    fs.mkdirSync(continuesDir, { recursive: true });
    fs.writeFileSync(path.join(continuesDir, "sessions.jsonl"), "stale\n");
    fs.writeFileSync(
      path.join(continuesDir, "sessions.claude.jsonl"),
      "stale\n",
    );

    const originalDir = path.join(configDir, "projects", "-old-project");
    const originalPath = path.join(originalDir, "sid-1234.jsonl");
    fs.mkdirSync(originalDir, { recursive: true });
    fs.writeFileSync(originalPath, '{"type":"user"}\n');

    relocateClaudeSessionForCwd(makeSession("/new/launch_dir", originalPath));

    expect(fs.existsSync(path.join(continuesDir, "sessions.jsonl"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(continuesDir, "sessions.claude.jsonl")),
    ).toBe(false);
  });

  it("does nothing when the session file is already in the launch cwd slug folder", async () => {
    const configDir = makeTmpDir("claude-relocate-");
    testState.home = makeTmpDir("claude-relocate-home-");
    const { relocateClaudeSessionForCwd } = await loadClaudeParser(configDir);

    const originalDir = path.join(configDir, "projects", "-same-project");
    const originalPath = path.join(originalDir, "sid-1234.jsonl");
    fs.mkdirSync(originalDir, { recursive: true });
    fs.writeFileSync(originalPath, '{"type":"user"}\n');

    relocateClaudeSessionForCwd(makeSession("/same/project", originalPath));

    expect(fs.existsSync(originalPath)).toBe(true);
    expect(fs.existsSync(path.join(testState.home, ".continues"))).toBe(false);
  });

  it("is wired as the claude adapter prepareNativeResume hook", async () => {
    vi.resetModules();
    const { adapters } = await import("../parsers/registry.js");
    const { relocateClaudeSessionForCwd } =
      await import("../parsers/claude.js");
    expect(typeof relocateClaudeSessionForCwd).toBe("function");
    expect(adapters.claude.prepareNativeResume).toBe(
      relocateClaudeSessionForCwd,
    );
  });
});
