import { spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import type { SessionContext, UnifiedSession } from "../types/index.js";
import { extractContext } from "./index.js";

/**
 * Render a session's recent conversation as plain markdown for the pager.
 */
export function renderPeekMarkdown(context: SessionContext): string {
  const { session } = context;
  const lines = [
    `# ${session.name || session.summary || session.id}`,
    "",
    `Session ${session.id} (${session.source}) — full transcript: ${session.originalPath}`,
    "",
  ];

  if (context.recentMessages.length === 0) {
    lines.push("No conversation messages available for this session.");
    return lines.join("\n");
  }

  for (const message of context.recentMessages) {
    const role =
      message.role === "user"
        ? "User"
        : message.role === "system"
          ? "System"
          : "Assistant";
    const time = message.timestamp
      ? ` (${message.timestamp.toISOString().slice(0, 16).replace("T", " ")})`
      : "";
    lines.push(`## ${role}${time}`, "", message.content, "");
  }

  return lines.join("\n");
}

function showInPager(text: string): Promise<void> {
  return new Promise((resolve) => {
    // ponytail: `less` is the pager; when it's missing (Windows), plain print
    const pager = spawn("less", ["-R"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    pager.on("error", () => {
      console.log(text);
      resolve();
    });
    pager.on("close", () => resolve());
    pager.stdin?.on("error", () => {});
    pager.stdin?.write(text);
    pager.stdin?.end();
  });
}

/**
 * Show the session's recent conversation in a pager without launching it.
 */
export async function peekSession(session: UnifiedSession): Promise<void> {
  const s = clack.spinner();
  s.start("Loading conversation...");
  try {
    const context = await extractContext(session);
    s.stop();
    await showInPager(renderPeekMarkdown(context));
  } catch (error) {
    s.stop();
    clack.log.error(`Failed to load conversation: ${(error as Error).message}`);
  }
}
