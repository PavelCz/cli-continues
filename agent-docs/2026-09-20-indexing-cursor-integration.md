# Indexing and Cursor integration

Integrated selected changes from upstream `yigitkonur/cli-continues`:

- [#82](https://github.com/yigitkonur/cli-continues/pull/82): indexing changes from
  commit `5b91050023f74b94f410bf55d9d992632eeb4d07`, not its additional tool parsers.
  Global discovery requests lightweight metadata; Cursor and Droid process up to
  16 transcripts concurrently. Large Droid transcripts skip exact line counts,
  while files up to 8 KiB are counted to exclude single-record stubs. Lightweight
  Droid recency uses file mtime. Codex summaries recognize user `response_item`s.
- [#81](https://github.com/yigitkonur/cli-continues/pull/81) and
  [#83](https://github.com/yigitkonur/cli-continues/pull/83): bounded slug decoding,
  lazy metadata-first Cursor cwd resolution, and cwd-scoped Cursor discovery.
- [#80](https://github.com/yigitkonur/cli-continues/pull/80): keep Cursor user
  prompts that begin with an absolute path, while filtering injected content.
- [#86](https://github.com/yigitkonur/cli-continues/pull/86): extract pending and
  in-progress Droid tasks from nested array-valued `todos`, retaining legacy
  string support, ignoring malformed items, and keeping the five-task limit.

## Fork-specific safeguards

- Existing underscore recovery is retained. Applying the upstream 10,000-probe
  limit alone broke the existing real-path regression. The decoder now prunes
  nonexistent finalized directory prefixes and memoizes probes, preserving
  separator/dot/dash/underscore search order within that budget. This is still a
  heuristic: ambiguous paths or exhausted budgets can produce a fallback cwd.
- Cursor reads `repo.json` before decoding slugs; metadata and resolved paths
  are shared across concurrent transcripts. The metadata key precedence remains
  `workspace > rootPath > path`. An exact encoded-slug match can use the supplied
  cwd when metadata is missing; descendants retain their own resolved cwd.
- Scoped discovery includes descendant projects, not just an exact cwd. Only
  adapters with `supportsCwdTreeLookup` may narrow repository-wide discovery.
  Claude's existing exact-project optimization is not tree-complete, so it is
  deliberately not used here. Partial scans never replace global/source caches.
- Claude title/cwd and Codex cwd scans still read all metadata records: stopping
  after the first user message would lose later titles or directory changes.
- Head scans use the existing streaming implementation with a default 512 KiB
  byte window instead of introducing a second JSONL reader. Full context reads
  are not capped. A summary beyond the window can be absent during discovery.
- No new runtime dependencies or writes to source-tool storage were introduced.

## Verification and local use

Run `pnpm run check` and `pnpm test`. Regression coverage includes path-prefixed
Cursor prompts, underscore paths, bounded probes, scoped descendants and cache
isolation, Codex response items/latest cwd, Droid arrays/stubs/mtime, and bounded
JSONL heads with UTF-8 split across chunks. Windows-specific slug tests are
skipped on Linux; no cross-platform performance claim is made.

The local `continues`/`cont` installation is linked to this repository's
`dist/cli.js`; `pnpm build` refreshes it. Existing discovery caches expire after
five minutes, or `continues rebuild` explicitly refreshes them. No end-to-end
speedup factor has been measured for this fork.
