# Modular setup

macOS + GNU Make (including Apple's Make 3.81). Install Xcode Command Line Tools
and [Homebrew](https://brew.sh) first. The setup does not install Homebrew, use
`sudo`, change your login shell, or edit existing profile files.

```sh
make                       # help; no installation
make -n setup              # preview
make setup                 # dependencies + config + plugins
make setup-nvim            # one module, including Node dependency
make -C setup/zimfw setup   # same module, directly
make config                # configuration links only; offline
make check                 # commands/files/links; read-only
```

`./install` forwards to `make setup`; `./install config` only links configuration.
Each module has `setup`, `deps`, `config`, and `check` targets. The root invokes
modules serially, including under `make -j`, to avoid package-manager races.
Do not run separate setup processes concurrently.

## Modules

| Module | Dependencies and configuration |
|---|---|
| `git` | Homebrew Git/lazygit; `.gitconfig` |
| `shell` | System Zsh/Vim; `.vimrc`, `.zprofile`, `.zshrc` |
| `zimfw` | Zim manager, `.zimrc`, Zim modules |
| `nvm` | NVM and Node 22; sets NVM's default Node version |
| `sdkman` | SDKMAN; optional explicitly selected JDK/Maven versions |
| `nvim` | NVM/Node, Neovim, ripgrep, ctags, CMake, ShellCheck, cppcheck, Python, uv, vim-plug/plugins |
| `tmux` | tmux, fzf, Python, TPM/plugins, `.tmux.conf` |

Additional modules may be available in a private checkout. They are not selected
by default. Use `make -C setup/<tool> setup` for any available module.

The checkout should be `~/.dotfiles`: the current tmux pane picker uses that path.
A newly created symlink points to the checkout; do not move it afterward.
Shell links honor `ZDOTDIR`; Neovim honors `XDG_CONFIG_HOME`. Custom `NVIM_APPNAME`
is not supported. Legacy Bash/SSH configurations are not linked automatically.

## Local choices

Defaults live in `setup/config.mk`. Override them in the ignored `setup.local.mk`:

```makefile
PROJECTS = git shell zimfw nvm sdkman nvim tmux
NODE_VERSION = 22
# Choose exact IDs from `sdk list java` / `sdk list maven`:
# JAVA_VERSION = ...
# MAVEN_VERSION = ...
```

Or override once:

```sh
make setup PROJECTS='shell zimfw'
make setup-nvm NODE_VERSION=24
make -C setup/sdkman candidates JAVA_VERSION=<version-id>
```

JDK/Maven are **not installed** when their version variables are empty. Installed
SDK candidates are not replaced; use SDKMAN to select a different default.
Existing NVM/TPM checkouts are reused, not upgraded or reset. Homebrew installs
missing packages without intentionally upgrading installed ones; dependencies
may still change according to Homebrew's resolution. Plugin versions follow the
configuration; this setup is repeatable, not a lockfile/reproducible build.

## Safety

- Existing regular files, directories and conflicting symlinks cause failure;
  nothing is replaced or deleted. Back them up yourself before retrying.
- Correct symlinks are left alone. Missing links are created. Earlier successful
  steps remain if a later step fails; setup is not transactional.
- `config` never downloads packages. `setup`, `deps`, `plugins`, `candidates`, and
  `linters` can access the network and execute upstream installation/build code.
- NVM is cloned without its profile-editing installer. SDKMAN uses
  `ci=true&rcupdate=false`; Zim downloads its manager without running its profile installer.
- No user dotfiles are sourced by `make config` or `make check` (NVM's own
  initializer is loaded when checking Node).
- The TPM installer uses a temporary tmux server, not your running sessions.
- A local `zshrc` takes precedence over `zshrc.example`. If the selected entry
  changes, an existing link to the old entry is a conflict; move it yourself.

## Editor extras

The initial plugin installation reads only the `plug#begin()` / `plug#end()` block
from `nvim/init.vim`; it does not load settings that require not-yet-installed plugins.

```sh
make -C setup/nvim plugins
make -C setup/nvim linters  # Darker/Black, cmakelint, cpplint via uv
```

After setup, start Neovim normally. CoC extensions and Treesitter parsers may
still download on first use. Java/Go/Ruby/Rust/LaTeX and their language servers,
plus golangci-lint v2, remain language-specific opt-ins. `make check` is a basic
availability check, not an end-to-end check of every language or plugin.
Add `~/.local/bin` to PATH for uv-installed linters (the provided Zsh config does this).

## Adding a module

Create `setup/<tool>/Makefile`, include `../common.mk`, and define `deps`, `config`,
and `check`. `setup` already depends on `deps config`; add a `plugins` prerequisite
when needed. Put commands that mutate state on ordinary recipe lines, not in
`$(shell ...)` or on the same line as `$(MAKE)`, so `make -n` remains safe.
Add the module to `PROJECTS` only when it should be installed by default.
New files do not automatically become part of a public export.

References: [Zim](https://zimfw.sh/docs/install/),
[SDKMAN](https://sdkman.io/install/), [NVM](https://github.com/nvm-sh/nvm),
[vim-plug](https://github.com/junegunn/vim-plug), [TPM](https://github.com/tmux-plugins/tpm).
