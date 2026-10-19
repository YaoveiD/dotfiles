# Public environment; machine-specific settings belong in ~/.zshrc.local.
[[ -n ${_DOTFILES_ENV_LOADED:-} ]] && return
_DOTFILES_ENV_LOADED=1

typeset -gU PATH path
export EDITOR=nvim
export GOPATH=${GOPATH:-$HOME/go}
export BUN_INSTALL=${BUN_INSTALL:-$HOME/.bun}
export NVM_DIR=${NVM_DIR:-$HOME/.nvm}
export SDKMAN_DIR=${SDKMAN_DIR:-$HOME/.sdkman}

() {
  local dir
  local -a tool_paths
  for dir in "${NVM_BIN:-}" "$HOME/.local/bin" "$BUN_INSTALL/bin" \
    /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin /usr/local/sbin \
    "$GOPATH/bin"; do
    [[ -d $dir ]] && tool_paths+=("$dir")
  done
  path=("${tool_paths[@]}" "${path[@]}")
}
export PATH
[[ -r "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
return 0
