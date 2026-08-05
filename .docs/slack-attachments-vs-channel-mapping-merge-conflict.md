# Resolving the Slack attachments ↔ channel-mapping merge conflict

## Background

Two independent upstream PRs both touch the Slack adapter's core message-handling
path, so merging one branch into the other (or, later, GitHub merging both into
`dev` back to back) produces real conflicts — not noise. This doc records exactly
how they were resolved locally so the same resolution can be reapplied once both
land upstream.

### The two changes

|     | Issue                                                                                                                                               | PR                                                                   | Branch                                                                | What it does                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | [coleam00/Archon#2298](https://github.com/coleam00/Archon/issues/2298) — "Slack is not processing attachments"                                      | [coleam00/Archon#2419](https://github.com/coleam00/Archon/pull/2419) | `fix/adapters-slack-make-attachments-available-#2298`                 | Downloads Slack file attachments (`downloadAttachments`) so the AI can read them; reports skipped files in-thread; cleans up after the run.                                    |
| B   | [coleam00/Archon#2274](https://github.com/coleam00/Archon/issues/2274) — "allow slack channel to project mapping + make archon slack channel aware" | [coleam00/Archon#2440](https://github.com/coleam00/Archon/pull/2440) | `feat/adapters-slack-channel-aware-context-and-project-mapping-#2274` | Resolves a channel ID to its name (`resolveChannelName`), auto-binds new threads to a project via `slack.channelProjects`, and gives the AI a "Message Origin" prompt section. |

Both are authored by the same person, both are still **OPEN** upstream as of this
writing, and both PRs are otherwise independent — but they touch the exact same
call sites in the Slack adapter, so whichever merges second upstream will hit this
same conflict.

Locally, this was resolved by merging branch B into a branch that already had
branch A's commits (`dev-with-my-extras`). Merge commit: `32587a7e`. Parent A:
`9b0f631e` (attachments). Parent B: `6836a9ca` (channel mapping, PR #2440 head at
merge time).

## Why they conflict

Both features hook the same three places:

1. `packages/adapters/src/chat/slack/types.ts` — each adds its own new types
   (`SlackFileRef`/`SkippedSlackAttachment` vs. `SlackChannelNameResult`).
2. `packages/adapters/src/chat/slack/adapter.ts` — each adds a new async method
   on `SlackAdapter` (`downloadAttachments` vs. `resolveChannelName` +
   `lookupChannelName`), plus new private cache fields and constants.
3. `packages/server/src/index.ts` — both extend the Slack `onMessage` handler
   body and the `handleMessage(...)` call inside the lock-manager callback.

None of the additions are semantically incompatible — they're just textually
adjacent, so git can't auto-merge them. The fix in every case is **keep both,
placed as independent, sequential pieces** — never pick one side.

## File-by-file resolution

### `packages/adapters/src/chat/slack/types.ts`

Straight union: keep `SlackFileRef`, `SlackAttachmentSkipReason`,
`SkippedSlackAttachment` (A) followed by `SlackChannelNameResult` (B).
`SlackMessageEvent` already carries `files?: SlackFileRef[]` from A; B does not
touch it further.

### `packages/adapters/src/chat/slack/adapter.ts`

- Import line: merge into one `import type { ... } from './types'` covering all
  four new type names.
- Constants: keep both (`MAX_SLACK_FILE_BYTES`, `MAX_SLACK_FILES_PER_MESSAGE`,
  `SLACK_ATTACHMENT_TIMEOUT_MS`, `isTrustedSlackDownloadUrl` from A, then
  `CHANNEL_NAME_FAILURE_BACKOFF_MS` from B).
- Private class fields: keep both sets (`filesReadMissingScopeLogged` from A,
  then `channelNameCache` / `channelNameFailureUntil` / `channelNameInFlight` /
  `channelInfoMissingScopeLogged` from B).
- Methods: `downloadAttachments()` (A) and `resolveChannelName()` +
  `lookupChannelName()` (B) become **sibling methods** on the class — A's method
  closes with its own `}`, then B's methods follow. They share nothing and call
  nothing in each other.

### `packages/adapters/src/chat/slack/index.ts` and `packages/adapters/src/index.ts`

Both are barrel re-export files. Union the export lists — `formatSkippedAttachmentsNotice`
(A) alongside `SlackChannelNameResult` (B, type-only export).

### `packages/adapters/src/chat/slack/adapter.test.ts` — the hard one

Git's line-based diff interleaved the two branches' new `describe()` blocks
(`downloadAttachments` from A, `resolveChannelName` from B) because both contain
similarly-shaped tests (`missing_scope` warned-once assertions, etc.) that
git's diff matched against each other line-by-line instead of treating them as
two separate insertions. **Do not hand-edit the interleaved conflict markers —
you will mismatch braces.** Instead:

1. Get both pre-merge versions of the file in full (`git show <branch>:path`).
2. Find where each one's _shared_ prefix ends (the last common `describe()`
   block — `fetchDisplayName (users.info enrichment)` in this case) and where
   each one's new `describe()` block starts and fully closes (matching
   indentation of the closing `});`).
3. Concatenate: shared prefix (unmodified) → A's whole `downloadAttachments`
   describe block (through its own closing `});`) → B's whole
   `resolveChannelName` describe block (through its own tests' closing, but
   **not** its own outer `describe`/file closes) → one final `});` to close the
   outer `describe('SlackAdapter', ...)`.
4. Verify: no `<<<<<<<`/`=======`/`>>>>>>>` markers remain, and a rough
   `{`/`}` count matches.

The import line at the top of this file also had a small ordinary conflict
(`afterEach` from A vs. `spyOn` from B) — both are used later in the file, so
merge to `import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';`.

### `packages/server/src/index.ts`

Inside the Slack `onMessage` handler, before the lock:

1. Keep A's attachment download + skip-notice block first (network I/O, no lock
   needed).
2. Keep B's channel-context resolution block second (also no lock needed).

Inside `lockManager.acquireLock(...)`, the `handleMessage(...)` call must carry
**all** of: `threadContext`, `parentConversationId`, `isolationHints`, `userId`,
the conditional `attachedFiles` spread (A), **and** `codebaseId` /
`origin` (B) — all in one object literal. A's `try { ... } finally { cleanup }`
wrapper stays; the `handleMessage` call simply gains B's two extra fields inside
the `try` block. Imports (`formatSkippedAttachmentsNotice`, `loadConfig`,
`codebaseDb`, `unlink`/`rm`, `resolveSlackChannelContext`) merge without
conflict since they're on separate lines already.

### `packages/docs-web/src/content/docs/adapters/slack.md`

Two independent doc sections in each conflict: bot-scope bullets
(`files:read` from A; `channels:read`/`groups:read` from B) and troubleshooting
subsections (`### Archon Ignores an Attached File` from A; `### Channel →
Project Mapping Not Applying` from B). Keep both, A's content first in each
case (matches the order the scopes are listed in Step 3 already).

### Everything else

`config-loader.ts`/`.test.ts`, `config-types.ts`, `core/index.ts`,
`orchestrator-agent.ts`, `prompt-builder.ts`/`.test.ts`, `types/index.ts`,
`configuration.md`, `server/package.json`, and the two new files
`slack-channel-context.ts`/`.test.ts` are all **B-only** changes with no
overlap from A — these merge automatically with no manual step.

## Design decisions: why this order, and why nothing runs twice

A merge conflict resolution's job is to **combine**, not to also optimize or
redesign. Every ordering choice below follows one rule: preserve each PR's own
internal order of its own steps, and never introduce a behavior neither PR's
own (already-reviewed) diff contained. Where the two PRs' code needed to
interleave into a single call site, A's block was placed first and B's second,
matching the convention git's own conflict markers already used
(`<<<<<<< HEAD` = A, the branch being merged into = first; `=======` /
`>>>>>>> B` = the incoming branch = second) — this keeps every resolved file
reviewable against the same "ours-then-theirs" mental model instead of a
different arbitrary order per file.

### Runtime order in `server/src/index.ts`

Inside the Slack `onMessage` handler, the merged order is: thread-context /
`resolveUserId` (pre-existing, untouched) → **A: download attachments + send
skip notice** → **B: resolve channel context** → acquire lock → `handleMessage`
(carrying both A's and B's outputs) → A's `finally` cleanup.

- **Both A's and B's blocks are correctness-independent of each other.**
  Attachment download reads Slack's file CDN and writes nothing but temp files;
  channel-context resolution reads `conversations.info` + the codebase DB and
  writes nothing. Neither's output is an input to the other (attachments don't
  affect `codebaseId`; channel context doesn't affect which files get
  downloaded), so there is no correctness requirement forcing one before the
  other.
- **Both stay outside `lockManager.acquireLock(...)`, on purpose.** This
  matches a pre-existing invariant from _before_ either PR: only the code
  inside the lock touches conversation/session state via `handleMessage`.
  Both A and B only _read_ external systems (Slack API, DB) before that point,
  so keeping both pre-lock preserves the invariant and keeps the locked
  critical section exactly as short as it was pre-merge.
- **A-before-B is a readability convention, not a requirement.** It was fixed
  by which side was `HEAD` (A, since B was merged _into_ a branch that already
  had A's commits) — not by any data dependency. If this is ever reapplied with
  the branches swapped (B merged into a tree that already has A), keeping
  A's snippets in the position closest to where they lived pre-conflict is more
  important than mechanically matching "HEAD first" again.
- **Considered and rejected: running the two blocks concurrently with
  `Promise.all`.** Both make network calls, so awaiting them sequentially adds
  one call's latency to the other before the lock is acquired. This was
  deliberately _not_ done during the merge: neither PR's own review (including
  CodeRabbit's two passes on #2440) exercised concurrent execution, so adding
  it here would be a new, unreviewed behavior smuggled into what should be a
  pure combination. It also makes the merge diff harder to audit — a reviewer
  checking "did this PR-combination change anything beyond combining?" can't
  tell at a glance. If the latency genuinely matters, it belongs in its own
  small, independently-reviewable follow-up, not bundled into a conflict
  resolution.
- **The `handleMessage(...)` call itself has exactly one legal shape.** Both
  `...(attachedFiles.length > 0 ? { attachedFiles } : {})` (A) and
  `codebaseId` / `origin` (B) are inputs to the _same_ function call, so there
  is only one place they can go — inside the one object literal. Object
  literal key order has no runtime effect here (no getters, no proxies), so
  placing B's two fields after A's spread is again the "ours-then-theirs"
  convention, not a functional necessity.
- **A's `try { handleMessage } finally { cleanup }` wrapper is untouched.** It
  already had to run cleanup on both success and failure paths pre-merge (a
  downloaded file must be deleted even if the AI call throws); B introduces no
  new resource that needs cleanup (no files, no held locks), so the wrapper
  needed no new branches — B's fields simply ride inside the existing `try`.

### Class member order in `adapter.ts`

Constants, private fields, and methods all follow the same A-then-B placement
for the same reason: it mirrors the conflict markers and keeps every resolved
region diffable against "which PR added this" without needing git blame.
`downloadAttachments()` and `resolveChannelName()`/`lookupChannelName()` are
genuine siblings — neither calls the other, and nothing in the class
constructor wires them together — so their relative position in the file has
no runtime meaning at all, only a reading-order one.

### No work happens twice

This was checked explicitly, not assumed:

- **`loadConfig()`** is called once per inbound Slack message (inside B's
  channel-context block) in addition to the one call already made at server
  startup (`packages/server/src/index.ts:321`, pre-existing, unrelated scope).
  This is **not** new duplication introduced by the merge — it's B's own
  documented design (global config is cached per-process; see PR #2440's own
  "Side Effects" section: "every inbound Slack message now does one extra
  (cached) config read"). The merge did not add a second per-message call on
  top of it.
- **`downloadAttachments` and `resolveChannelName` hit disjoint external
  APIs** — Slack's file CDN (`fetch` against `url_private_download`) vs. the
  Bolt client's `conversations.info` — so there's no shared cache or shared
  network call either feature could have accidentally called twice.
- **`codebaseId` is resolved exactly once and consumed exactly once.** It's
  computed inside `resolveSlackChannelContext` (one call site) and passed
  exactly once into `handleMessage`'s options, where `orchestrator-agent.ts`
  documents it as a **creation-only default** for `getOrCreateConversation`
  (`packages/core/src/orchestrator/orchestrator-agent.ts:1151-1157`, B-only,
  untouched by the merge) — an already-existing conversation ignores it, so
  there's no risk of it silently re-binding a project on every message in a
  thread.
- **The spliced `adapter.test.ts` was verified arithmetically, not just by
  running it.** Before the splice, branch A's file had 59 top-level `test(...)`
  calls (21 of them inside its own new `downloadAttachments` describe block,
  38 in the block shared with B). Branch B's file had 48 (10 inside its own
  new `resolveChannelName` describe block, the same 38 shared). The merged
  file has exactly `38 + 21 + 10 = 69` tests — confirmed by both a direct
  `grep -c` count and `bun test` reporting `69 pass / 0 fail` for that file
  alone. If the splice had duplicated or dropped anything, this arithmetic
  would not have come out exact.

## Validation after resolving

Commands run, in order, after resolving all seven conflicted files:

```bash
bun run type-check    # all 12 packages: 0 errors
bun run lint           # 0 warnings (--max-warnings 0)
bun run format:check   # clean
```

Tests were run per-package (not `bun run test` from the repo root — see the
project's own testing guidance on `--parallel` and mock-pollution isolation):

| Package            | Result                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `@archon/adapters` | 6 files, 278 tests, 0 fail (`adapter.test.ts` alone: 69 tests, 0 fail) |
| `@archon/server`   | 25 files, 502 tests, 0 fail                                            |
| `@archon/core`     | 22 files, 513 tests, 0 fail                                            |

A full `bun run test` (all packages, `--parallel`) was also run once to check
for cross-package fallout. Two unrelated failures surfaced, both in packages
this merge never touched:

- `@archon/isolation` — `overlay-scripts.test.ts`, a whiteout-name traversal
  test that also timed out at 5000ms.
- `@archon/cli` — `serve.test.ts`, two `tar` extraction failures.

Confirmed unrelated by `git diff HEAD^1 HEAD --stat -- packages/isolation
packages/cli`, which returns **empty** — the merge commit touches neither
package at all. These are pre-existing, environment-specific failures (this
machine's `tar` availability / a timing-sensitive test) rather than merge
fallout, and `bun run validate`'s bundled `test:install` step separately fails
on native Windows by design (WSL2/Linux-only, noted in PR #2419's own
validation section) — neither blocks this merge.

## When both PRs actually merge upstream

Whichever of #2419 / #2440 merges into `coleam00/Archon`'s `dev` **second** will
show this exact conflict in its own branch (since its diff base no longer matches
`dev`). Re-apply this same file-by-file resolution on that PR's branch, then
re-run the validation commands above before pushing.
