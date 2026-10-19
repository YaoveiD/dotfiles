# dotfiles

Personal Vim, Neovim, tmux and Zsh configuration for macOS.
This is a reviewed snapshot with independent Git history.

## Install

```sh
git clone --branch public https://github.com/YaoveiD/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
make -n setup
make setup
```

Install Xcode Command Line Tools and Homebrew first. Each tool has its own
Makefile under `setup/`; the root Makefile installs dependencies, links configs
and installs plugins. Existing configuration conflicts cause failure, not replacement.
Use `~/.dotfiles` for the checkout: the tmux picker uses this path.

`make config` only creates links; `make check` performs basic read-only checks.
Use `make setup-nvim` or `make -C setup/zimfw setup` for individual tools.
`./install` forwards to `make setup`.

See [docs/setup.md](docs/setup.md) for versions, opt-in JDK/Maven and editor extras.
Local installation choices belong in ignored `setup.local.mk`.

## Local settings

Keep Git identity in `~/.gitconfig.local`:

```ini
[user]
    name = Your Name
    email = your-public-email@example.org
```

Keep machine-specific Shell settings in `~/.zshrc.local`.
These files live outside the repository.

## Keys

- Neovim: Space leader, Ctrl-P files, `Space gd` definition.
- tmux: `Prefix w` searches panes using fzf; `Prefix W` opens the session tree.
- Zsh: shared history, `ll`, `vi` and `lg` aliases.
