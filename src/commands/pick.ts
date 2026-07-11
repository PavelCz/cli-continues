import * as clack from "@clack/prompts";
import chalk from "chalk";
import { showBanner } from "../display/banner.js";
import { formatSessionForSelect, sourceColors } from "../display/format.js";
import { showNoSessionsHelp } from "../display/help.js";
import { maybePromptGithubStar } from "../display/star-prompt.js";
import type { SessionSource, UnifiedSession } from "../types/index.js";
import type { HandoffForwardingOptions } from "../utils/forward-flags.js";
import {
  getAllSessions,
  getSessionsByCwd,
  getSessionsBySource,
} from "../utils/index.js";
import {
  getResumeCommand,
  resolveCrossToolForwarding,
  resolveLaunchCwd,
  resume,
  withLaunchCwd,
} from "../utils/resume.js";
import { matchesCwd } from "../utils/slug.js";
import { selectTargetTool, showForwardingWarnings } from "./_shared.js";

async function selectLaunchCwd(
  session: UnifiedSession,
  currentDir: string,
): Promise<string | null> {
  const sessionDir = session.cwd || currentDir;
  const selected = await clack.select({
    message: "Launch from:",
    options: [
      { value: "session", label: `Session directory: ${sessionDir}` },
      { value: "current", label: `Current directory: ${currentDir}` },
      { value: "custom", label: "Enter a directory" },
    ],
    initialValue: "session",
  });

  if (clack.isCancel(selected)) {
    clack.cancel("Cancelled");
    return null;
  }

  if (selected === "session") return sessionDir;
  if (selected === "current") return currentDir;

  const customDir = await clack.text({
    message: "Working directory:",
    placeholder: currentDir,
    validate: (value) => {
      try {
        resolveLaunchCwd(session, value);
      } catch (error) {
        return (error as Error).message;
      }
    },
  });

  if (clack.isCancel(customDir)) {
    clack.cancel("Cancelled");
    return null;
  }

  return resolveLaunchCwd(session, customDir);
}

type DirectoryGroup = {
  kind: "directory";
  cwd: string;
  sessions: UnifiedSession[];
};
type SessionSelection = { kind: "session"; session: UnifiedSession };
type DirectorySelection = DirectoryGroup | SessionSelection;
type DirectoryOption =
  | { value: DirectoryGroup; label: string; hint?: string }
  | { value: SessionSelection; label: string; hint?: string };

async function selectSessionByDirectory(
  sessions: UnifiedSession[],
  currentDir: string,
): Promise<UnifiedSession | null> {
  const byDirectory = new Map<string, UnifiedSession[]>();
  for (const session of sessions) {
    const group = byDirectory.get(session.cwd) ?? [];
    group.push(session);
    byDirectory.set(session.cwd, group);
  }

  const groups = Array.from(
    byDirectory,
    ([cwd, directorySessions]): DirectoryGroup => ({
      kind: "directory",
      cwd,
      sessions: directorySessions.sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      ),
    }),
  ).sort((a, b) => {
    // Pin groups matching the current directory first, then sort by recency
    const aCurrent = matchesCwd(a.cwd, currentDir);
    const bCurrent = matchesCwd(b.cwd, currentDir);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return (
      b.sessions[0].updatedAt.getTime() - a.sessions[0].updatedAt.getTime()
    );
  });
  const expanded = new Set<string>();
  let initialValue: DirectorySelection | undefined;

  while (true) {
    const pickerOptions: DirectoryOption[] = [];
    for (const group of groups) {
      const isExpanded = expanded.has(group.cwd);
      const count = group.sessions.length;
      const latest = group.sessions[0].updatedAt
        .toISOString()
        .slice(0, 16)
        .replace("T", " ");
      pickerOptions.push({
        value: group,
        label: `${isExpanded ? "[-]" : "[+]"} ${group.cwd || "(unknown directory)"}`,
        hint: `${count} session${count === 1 ? "" : "s"}, latest ${latest}`,
      });

      if (isExpanded) {
        pickerOptions.push(
          ...group.sessions.map((session) => ({
            value: { kind: "session" as const, session },
            label: `  ${formatSessionForSelect(session)}`,
            hint: session.id.slice(0, 8),
          })),
        );
      }
    }

    const selected = await clack.select<DirectorySelection>({
      message: `Select a directory or session (${sessions.length} sessions)`,
      options: pickerOptions,
      initialValue,
      maxItems: 15,
    });

    if (clack.isCancel(selected)) {
      clack.cancel("Cancelled");
      return null;
    }

    if (selected.kind === "session") return selected.session;
    if (!expanded.delete(selected.cwd)) expanded.add(selected.cwd);
    initialValue = selected;
  }
}

/**
 * Main interactive TUI command
 */
export async function interactivePick(
  options: {
    source?: string;
    noTui?: boolean;
    rebuild?: boolean;
    all?: boolean;
    allTools?: boolean;
    forwardArgs?: string[];
    preset?: string;
    configPath?: string;
    chain?: boolean;
  },
  context: { isTTY: boolean; supportsColor: boolean; version: string },
): Promise<void> {
  try {
    // If not TTY or --no-tui, fall back to list
    if (!context.isTTY || options.noTui) {
      console.log(
        chalk.yellow(
          'Interactive mode requires a TTY. Use "continues list" instead.',
        ),
      );
      process.exitCode = 1;
      return;
    }

    const bannerCancelled = await showBanner(
      context.version,
      context.supportsColor,
    );
    if (bannerCancelled) return;
    await maybePromptGithubStar();
    clack.intro(
      chalk.bold("continue") +
        chalk.cyan.bold("s") +
        chalk.gray(" — session picker"),
    );

    const currentDir = process.cwd();
    const dirName = currentDir.split("/").pop() || currentDir;
    let sessions: UnifiedSession[] = [];
    let cwdSessions: UnifiedSession[] = [];
    let allSessionsLoaded = false;

    const refreshCwdSessions = (): void => {
      cwdSessions = options.all
        ? []
        : sessions.filter((sess) => matchesCwd(sess.cwd, currentDir));
    };

    const loadAllSessions = async (
      message = "Loading all sessions...",
    ): Promise<UnifiedSession[]> => {
      if (allSessionsLoaded) return sessions;
      const loading = clack.spinner();
      loading.start(message);
      sessions = await getAllSessions(options.rebuild);
      refreshCwdSessions();
      allSessionsLoaded = true;
      loading.stop();
      return sessions;
    };

    const s = clack.spinner();
    s.start("Loading sessions...");
    if (options.source) {
      sessions = await getSessionsBySource(
        options.source as SessionSource,
        options.rebuild,
      );
      cwdSessions = options.all
        ? []
        : sessions.filter((sess) => matchesCwd(sess.cwd, currentDir));
    } else {
      cwdSessions = options.all
        ? []
        : await getSessionsByCwd(currentDir, options.rebuild);
      if (cwdSessions.length > 0) {
        sessions = cwdSessions;
      } else {
        sessions = await getAllSessions(options.rebuild);
        refreshCwdSessions();
        allSessionsLoaded = true;
      }
    }

    s.stop();

    if (sessions.length === 0) {
      showNoSessionsHelp();
      clack.outro(chalk.gray("No sessions to resume"));
      return;
    }

    const hasCwdSessions = cwdSessions.length > 0;

    if (!options.all && !hasCwdSessions && sessions.length > 0) {
      clack.log.info(chalk.gray(`No sessions in ${dirName}, showing all`));
    }

    const autoSelectedSession =
      cwdSessions.length === 1 && !options.source ? cwdSessions[0] : undefined;

    // Step 1: Filter by CLI tool (optional) -- skip if source already specified or auto-selected
    let filteredSessions = hasCwdSessions ? cwdSessions : sessions;
    let selectedScope: "cwd" | "all" = hasCwdSessions ? "cwd" : "all";

    if (
      !autoSelectedSession &&
      !options.source &&
      !options.allTools &&
      sessions.length > 0
    ) {
      let scope = selectedScope;

      while (true) {
        const pool = scope === "cwd" ? cwdSessions : sessions;
        const bySource = pool.reduce(
          (acc, sess) => {
            acc[sess.source] = (acc[sess.source] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const toolCount = Object.keys(bySource).length;

        // Select message conveys scope context
        let message: string;
        if (scope === "cwd") {
          message = `${dirName} — ${pool.length} session${pool.length !== 1 ? "s" : ""}`;
        } else if (hasCwdSessions) {
          message = `All sessions — ${pool.length} total`;
        } else {
          message = `${pool.length} sessions across ${toolCount} tool${toolCount !== 1 ? "s" : ""}`;
        }

        // Build options: tool names first, then "All tools", then scope toggle
        const filterOptions: { value: string; label: string; hint?: string }[] =
          [];

        // Per-tool options (sorted by count desc, colored)
        filterOptions.push(
          ...Object.entries(bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([source, count]) => ({
              value: source,
              label: `${sourceColors[source as SessionSource](source.charAt(0).toUpperCase() + source.slice(1))} (${count})`,
            })),
        );

        // "All tools" -- no tool filter, shows all sessions in current scope
        filterOptions.push({
          value: "all-in-scope",
          label: `All tools (${pool.length})`,
        });

        // Scope toggle (only when CWD sessions exist and --all wasn't used)
        if (hasCwdSessions && !options.all) {
          if (scope === "cwd") {
            filterOptions.push({
              value: "scope-toggle",
              label: chalk.dim(
                allSessionsLoaded
                  ? `Show all sessions (${sessions.length})`
                  : "Show all sessions",
              ),
            });
          } else {
            filterOptions.push({
              value: "scope-toggle",
              label: chalk.dim(`This directory (${cwdSessions.length})`),
            });
          }
        }

        const toolFilter = await clack.select({
          message,
          options: filterOptions,
          initialValue: "all-in-scope",
        });

        if (clack.isCancel(toolFilter)) {
          clack.cancel("Cancelled");
          return;
        }

        // Scope toggle: flip and re-render
        if (toolFilter === "scope-toggle") {
          if (scope === "cwd") {
            await loadAllSessions();
            scope = "all";
          } else {
            scope = "cwd";
          }
          continue;
        }

        // "All tools": use entire pool
        if (toolFilter === "all-in-scope") {
          filteredSessions = pool;
          selectedScope = scope;
          break;
        }

        // Specific tool: filter by source
        filteredSessions = pool.filter((sess) => sess.source === toolFilter);
        selectedScope = scope;
        break;
      }
    }

    // Step 2: Select session -- show all with scrolling (maxItems controls viewport)
    const PAGE_SIZE = 500;
    const visibleSessions = filteredSessions.slice(0, PAGE_SIZE);

    if (filteredSessions.length > PAGE_SIZE) {
      clack.log.info(
        chalk.gray(
          `Showing first ${PAGE_SIZE} of ${filteredSessions.length} sessions. Use --source to narrow results.`,
        ),
      );
    }

    let session: UnifiedSession;
    if (autoSelectedSession) {
      session = autoSelectedSession;
      console.log(chalk.gray(`  Auto-selected the only matching session:`));
      console.log(`  ${formatSessionForSelect(session)}`);
      console.log();
    } else if (selectedScope === "all") {
      const selectedSession = await selectSessionByDirectory(
        visibleSessions,
        currentDir,
      );
      if (!selectedSession) return;
      session = selectedSession;
    } else {
      const selectedSession = await clack.select({
        message: `Select a session (${filteredSessions.length} available)`,
        options: visibleSessions.map((sess) => ({
          value: sess,
          label: formatSessionForSelect(sess),
          hint: sess.id.slice(0, 8),
        })),
        maxItems: 15,
      });

      if (clack.isCancel(selectedSession)) {
        clack.cancel("Cancelled");
        return;
      }

      session = selectedSession as UnifiedSession;
    }

    // Step 3: Select target tool
    const targetTool = await selectTargetTool(session, {
      excludeSource: false,
    });
    if (!targetTool) return;

    const launchCwd = await selectLaunchCwd(session, currentDir);
    if (!launchCwd) return;
    const launchSession = withLaunchCwd(session, launchCwd);

    const forwarding: HandoffForwardingOptions | undefined =
      targetTool !== session.source
        ? { tailArgs: options.forwardArgs }
        : undefined;

    if (forwarding) {
      const resolved = resolveCrossToolForwarding(targetTool, forwarding);
      await showForwardingWarnings(resolved.warnings, context);
    }

    // Step 4: Show what will happen and resume
    console.log();
    clack.log.info(`Working directory: ${chalk.cyan(launchCwd)}`);
    clack.log.info(
      `Command: ${chalk.cyan(getResumeCommand(launchSession, targetTool, forwarding))}`,
    );
    console.log();

    clack.log.step(`Handing off to ${targetTool}...`);
    clack.outro(`Launching ${targetTool}`);

    process.chdir(launchCwd);
    await resume(launchSession, targetTool, "inline", forwarding, {
      preset: options.preset,
      configPath: options.configPath,
      chain: options.chain,
    });
  } catch (error) {
    if (clack.isCancel(error)) {
      clack.cancel("Cancelled");
      return;
    }
    clack.log.error(`${(error as Error).message}`);
    process.exitCode = 1;
  }
}
