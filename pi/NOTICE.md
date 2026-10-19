# Pi extension sources and licenses

## agent-stuff

The following files are from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff),
licensed under Apache-2.0. See `licenses/Apache-2.0.txt`.

| File under `extensions/` | Public source revision |
|---|---|
| `btw.ts`, `files.ts`, `review.ts`, `todos.ts`, `whimsical.ts` | `a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d` |
| `goal.ts` | `ac79012425c315ce545a8b2564f866c803d619c8` |
| `no-sleep.ts` | `ab0a07b6d3b0e3a2846c4ee3753dee4c683e7ec2` |
| `session-breakdown.ts` | `ab1e7f3414e4c8aa54a3eda0a3c634c32d3794f0` |
| `subagent.ts` | `d265b8ef32f896d3ef3bc6a45bd7b8e0d02150e0` |
| `unified-edit.ts` | `c77d49797ad3fb78888e5b002ae606a93777c6b1` |

Those ten files match their listed revisions. `notify.ts` is a modified variant of
revision `a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d`, adding native macOS notifications,
sound controls and tmux passthrough. It carries a changed-file notice.

## Additional upstream material

- `unified-edit.ts` contains Pi edit/diff logic. Pi: Copyright (c) 2025 Mario Zechner,
  MIT; see `licenses/Pi-MIT.txt`. Source:
  [earendil-works/pi](https://github.com/earendil-works/pi/tree/1402973a9dbe8c627341e04c9744c54953e285ca).
- `review.ts` includes adapted OpenAI Codex review prompts. OpenAI Codex,
  Copyright 2025 OpenAI, Apache-2.0; see `licenses/Codex-Apache-2.0.txt`.
  [Codex](https://github.com/openai/codex) attribution is retained without claiming
  a precise historical revision for the adapted prompt text.
- `toggle-skills` credits inspiration from
  [monotykamary/pi-toggle-skills](https://github.com/monotykamary/pi-toggle-skills/tree/75bddf66ff6ef327203a0bfeaee819a72fe2a89b).
  Upstream identifies Tom X Nguyen as author and declares MIT in its package
  metadata. Its standalone LICENSE file is absent. MIT terms and author credit
  are retained in `licenses/Toggle-skills-MIT.txt`; the local implementation is
  substantially rewritten, not an exact upstream copy.

Other extensions are local additions. These notices do not assign a blanket
license to unrelated repository content.

## Public packaging

The `pi-fzf` lockfile changes registry URLs only. Dependency versions, integrity
hashes and graph are preserved; its package manifest is unchanged. Runtime
profiles, credentials, installed packages, backups and session data are excluded.
