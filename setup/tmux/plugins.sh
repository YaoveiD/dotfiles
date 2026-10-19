#!/usr/bin/env bash
# TPM reads server state; isolate it from the user's live tmux sessions.
set -eu
scratch=$(mktemp -d)
socket=$scratch/tmux.sock
cleanup() {
    tmux -S "$socket" kill-server >/dev/null 2>&1 || true
    rm -rf -- "$scratch"
}
trap cleanup EXIT
# A session keeps the isolated server alive while TPM runs.
tmux -S "$socket" -f /dev/null new-session -d -s dotfiles-setup 'sleep 3600'
tmux -S "$socket" set-environment -g TMUX_PLUGIN_MANAGER_PATH "$HOME/.tmux/plugins/"
TMUX="$socket,0,0" "$HOME/.tmux/plugins/tpm/bin/install_plugins"
