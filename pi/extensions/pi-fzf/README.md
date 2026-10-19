# pi-fzf

A floating file picker for Pi. Search for files or directories and insert references at the cursor.

## Features

- Recursive fuzzy project search
- Toggle Git-ignored Project entries without closing the picker
- Yazi-style parent/current/preview browsing
- Multi-select across scopes
- Independent query and cursor state per scope and global directory
- Configurable search limits, caching, debounce, and symlink following
- Inserts references without submitting the prompt

## Requirements

Project search requires `fd`:

```bash
# macOS
brew install fd

# Ubuntu/Debian
apt install fd-find
ln -s "$(command -v fdfind)" ~/.local/bin/fd
```

Install dependencies:

```bash
cd ~/.pi/agent/extensions/pi-fzf
npm install
```

## Usage

Press `@` or run `/fzf-files`.

| Key | Action |
|---|---|
| Type | Fuzzy-search Project; filter the current Global directory |
| `[` / `]` | Switch to Project / Global |
| `Up` / `Down` | Move |
| `PageUp` / `PageDown` | Move by page |
| `Tab` / `Shift+Tab` | Toggle mark and move down/up |
| `Enter` | Open an unmarked Global directory; otherwise review insertion |
| `Right` / `Ctrl+L` | Search within the selected directory |
| `Left` / `Ctrl+H`, or `Backspace` on an empty query | Search from the parent directory |
| `Ctrl+S` | Review selected files |
| `Ctrl+X` | Clear all marks |
| `Ctrl+G` | Toggle Git-ignored files and directories in Project |
| `Esc` / `Ctrl+C` | Cancel |
| `@` | Close and insert a literal `@` |

In the selected-files view, use `Space` to toggle, `Tab` / `Shift+Tab` to
toggle and move, `Ctrl+A` to select all shown files, and `Ctrl+X` to clear.
`Enter` opens a final confirmation; `Esc` goes back.

`[` and `]` are reserved inside the picker and cannot be used in queries.

## Scopes

### Project

The initial root is the current session `cwd`. Use `Ctrl+H` / `Left` to move the search root up and `Ctrl+L` / `Right` on a directory to move it down. The active root appears as `../`, `src/`, and so on. Each root keeps its query and cursor. Inserted references remain relative to the session `cwd`.

Hidden entries are included, ignore files are respected, and `.git` is excluded. Press `Ctrl+G` to show entries ignored by `.gitignore`; press it again to hide them.

The default `dynamic` mode runs a debounced `fd` query, cancels stale searches, then ranks bounded results with fzf.

Complete cached result sets are filtered locally for longer queries, and prepared fzf indexes are reused.

`preload` mode scans once and filters locally. Prefer `dynamic` for large repositories.

### Global

The default root is `~/repos`. On wide terminals, Global uses Yazi-style
parent, current, and selected-directory preview panes. Each pane reads one
directory level. Directories appear first. `.git`, `node_modules`, `Library`,
`.cache`, `.Trash`, and `.DS_Store` are excluded.

Returning to a parent restores its query and cursor. Navigation cannot go above the Global root.

## Configuration

Create `~/.pi/agent/pi-fzf.json`:

```json
{
  "globalRoot": "~/repos",
  "search": {
    "mode": "dynamic",
    "maxResults": 2000,
    "debounceMs": 30,
    "cacheTtlMs": 30000,
    "followSymlinks": false
  }
}
```

- `search.mode`: `dynamic` or `preload`
- `search.maxResults`: `fd` candidate limit; `0` means unlimited. `preload` defaults to `0`
- `search.debounceMs`: Dynamic-search delay
- `search.cacheTtlMs`: Project-query and Global-directory cache lifetime; `0` disables caching
- `search.followSymlinks`: Follow symlinks in Project

Configuration is read whenever the picker opens; `/reload` is unnecessary.

## Reference format

Project paths are relative. Global paths use `~/...` or absolute paths:

```text
@src/index.ts @~/repos/demo/README.md 
```

Directories keep their trailing slash. Paths containing spaces or quotes are escaped:

```text
@"src/my file.ts"
```

References are deduplicated by absolute path.

## Development

```bash
cd ~/.pi/agent/extensions/pi-fzf
npm run check
```
