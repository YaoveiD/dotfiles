source "${${(%):-%N}:A:h}/environment.zsh"
bindkey -e

ZIM_HOME=${ZIM_HOME:-${ZDOTDIR:-${HOME}}/.zim}
[[ -r "$ZIM_HOME/init.zsh" ]] && source "$ZIM_HOME/init.zsh"

HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
HISTSIZE=50000
SAVEHIST=50000
setopt SHARE_HISTORY EXTENDED_HISTORY HIST_IGNORE_ALL_DUPS
unsetopt INC_APPEND_HISTORY

alias vi=nvim
alias tls='tmux ls'
alias lg=lazygit
alias ll='ls -la'
alias ..='cd ..'
mkcdir() { mkdir -p -- "$1" && cd -P -- "$1"; }

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" --no-use
  if [[ -n ${NVM_BIN:-} && -x "$NVM_BIN/node" ]]; then
    path=("$NVM_BIN" "${path[@]}")
  else
    nvm use --silent default
  fi
fi
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
return 0
