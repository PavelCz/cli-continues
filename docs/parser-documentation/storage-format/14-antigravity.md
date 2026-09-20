# Antigravity

Updated: 2026-09-20 (CLI implementation checked against local storage and `agy --help`).

## Observed Storage

- Root: `~/.gemini/antigravity/`
- CLI root: `~/.gemini/antigravity-cli/`
- CLI conversations: `antigravity-cli/conversations/<conversation-id>.db`
- Persisted conversation IDs: `conversations/*.pb`
- Handoff artifacts: `brain/<conversation-id>/task.md`, `implementation_plan.md`, `walkthrough.md`, plus `.resolved*` variants.
- UI/index metadata: Antigravity global storage SQLite at `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` on macOS.
- Auxiliary local data: `code_tracker/`, `browser_recordings/`, `implicit/`, `knowledge/`, and account/setting files.

## Parser Behavior

- `src/parsers/antigravity.ts` now discovers sessions from the union of CLI `conversations/*.db`, IDE `conversations/*.pb`, `brain/<id>/`, `state.vscdb` trajectory summaries, and optional live language-server RPC.
- CLI `.db` extraction copies the database and any WAL to temporary storage before opening it read-only through `node:sqlite`. This includes committed WAL steps without creating shared-memory files in tool storage. Temporary copies are removed after reading.
- CLI titles, workspace URIs, and update times come from `conversation_summaries.db` or `cache/conversation_metadata.json`. The `cache/last_conversations.json` mapping is a fallback, not the only source of repository association.
- Known protobuf fields are decoded directly: user input `19/2`, planner text `20/1` (fallback `20/8`), tool calls `20/7/{2,3}`, checkpoint title `30/4`, timestamp `5/1`. These paths were observed in local data; they are not a published schema. Checkpoints are not user messages. Unknown layouts retain best-effort string extraction.
- Discovery samples at most 40 steps per database. Context extraction reads all steps before applying the configured message limit. Metadata caches are loaded once per discovery pass.
- CLI database extraction does not launch the IDE, including for empty or unreadable databases. IDE `.pb` behavior is unchanged. When both stores have the same conversation ID, the CLI database takes precedence.
- `code_tracker/` is no longer treated as canonical. It is parsed only as a legacy fallback when a file actually contains chat-shaped `{type, content, timestamp}` records.
- Offline extraction does not decrypt `.pb`; it builds a useful handoff from brain artifacts and state metadata.
- When Antigravity is running, the parser attempts read-only RPC extraction for full steps, messages, tool activity, and modified files.

## Remaining Uncertainty

- CLI protobuf layouts are private and may change. Tool results, reasoning, and unrecognized step types are not fully reconstructed. Copying a live DB and WAL is not a transactional snapshot; concurrent checkpoints can require a retry on the next discovery/extraction.
- First-party docs still do not publish the raw `conversations/*.pb` schema.
- Offline full transcript reconstruction from `.pb` remains intentionally unsupported by default because it would require private schema/decryption behavior.
- Live RPC method and field names are private implementation details, so extraction is best-effort and falls back to offline artifacts.

## Direct Access Recipe

```bash
find ~/.gemini/antigravity-cli/conversations -name '*.db'
find ~/.gemini/antigravity/conversations -name '*.pb'
find ~/.gemini/antigravity/brain -maxdepth 2 -type f | head -n 80
sqlite3 "$HOME/Library/Application Support/Antigravity/User/globalStorage/state.vscdb" \
  "SELECT key, length(value) FROM ItemTable WHERE key LIKE '%trajectorySummaries%'"
```

## Sources

- Integration base: [sebastianbarrozo's PR #73](https://github.com/yigitkonur/cli-continues/pull/73), commit `f4e050eebbe030ce199371a0d23d9976dc225a74`. [PR #77](https://github.com/yigitkonur/cli-continues/pull/77) only adds binary detection and does not provide CLI session extraction.
- This fork extends #73 with metadata-backed repository association, structured message decoding, WAL-aware reads, interactive handoff arguments, and real-parser conversion tests. Fixtures contain synthetic content shaped after local records; no private transcripts are committed.
- Third-party sync evidence: https://github.com/mrd9999/antigravity-sync
- Google Antigravity docs root: https://antigravity.google/docs
