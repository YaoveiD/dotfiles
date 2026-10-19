# toggle-skills extension

A global pi extension inspired by [`monotykamary/pi-toggle-skills`](https://github.com/monotykamary/pi-toggle-skills).
It controls which loaded skills appear in the model's `<available_skills>` system-prompt section. Hidden skills remain callable with `/skill:name`.

## Two scopes

- **Global · persistent**: updates `disable-model-invocation` in the skill's Markdown frontmatter and reloads pi. The setting affects future sessions that load that skill. For a project skill, “global” means persistent for that skill/project—not every unrelated project.
- **Session · current only**: applies a prompt-only override stored in the current session JSONL. It survives `/reload` and resume, but is ignored by `/new`, `/fork`, and `/clone` because those have new session IDs.

The Session tab is tri-state internally:

- no override: inherit Global
- visible session override
- hidden session override

`Ctrl+R` removes the selected session override and returns it to Global inheritance.

## Commands

```text
/toggle-skills
/toggle-skills status [global|session]
/toggle-skills list
/toggle-skills enable <name>             # global, compatibility default
/toggle-skills disable <name>            # global, compatibility default
/toggle-skills session enable <name>
/toggle-skills session disable <name>
/toggle-skills reset-session [name|all]
/toggle-skills help
```

`--session` and `--global` are also accepted after direct enable/disable commands.

## TUI keys

| Key | Action |
|---|---|
| `Tab`, `Shift+Tab`, `←`, `→` | Switch Global/Session tabs |
| `↑`, `↓` | Navigate |
| `Enter` | Toggle selected skill |
| `Ctrl+A` | Hide all (filtered list when searching) |
| `Ctrl+D` | Show all (filtered list when searching) |
| `Ctrl+R` | Session tab: inherit Global for selected skill |
| `Ctrl+S` | Save staged changes; auto-reload if Global changed |
| `Esc` | Cancel and discard staged changes |
| `Ctrl+C` | Clear search, or cancel when search is empty |

## Implementation notes

- Discovers the exact skills already loaded by pi through `getSystemPromptOptions()`, including package/settings/CLI skills—not only standard directories.
- Global edits preserve the Markdown body and unrelated frontmatter text; only the top-level `disable-model-invocation` line is added/removed.
- Flow-style YAML (`{name: ..., description: ...}`) is rejected instead of being rewritten unsafely; use normal block-style skill frontmatter.
- A provider-request safeguard reapplies session visibility if another extension dynamically adds/removes the `read` tool during an agent run.
- Current-session visibility is applied in `before_agent_start` using pi's exported `formatSkillsForPrompt()`; it can therefore expose a globally hidden skill without touching its file.
- Branch-local state is restored from custom session entries. Entries carry the originating session ID so copied history cannot leak overrides into a new/forked session.
