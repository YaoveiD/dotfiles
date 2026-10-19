# Defaults shared by the root and per-tool Makefiles.
PROJECTS ?= git shell zimfw nvm sdkman nvim tmux
NVM_VERSION ?= v0.40.8
NODE_VERSION ?= 22
ZIMFW_URL ?= https://github.com/zimfw/zimfw/releases/latest/download/zimfw.zsh
VIM_PLUG_URL ?= https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
# Empty SDK versions install only the manager. Choose IDs from `sdk list`.
JAVA_VERSION ?=
MAVEN_VERSION ?=
NVIM_PACKAGES ?= neovim ripgrep universal-ctags cmake shellcheck cppcheck python uv
TMUX_PACKAGES ?= tmux fzf python
