include ../common.mk

.PHONY: plugins
setup: plugins
deps:
	@$(HELPER); require_commands curl git zsh; download_once "$(ZIMFW_URL)" "$$ZIM_HOME/zimfw.zsh"
config:
	@$(HELPER); link_config "$$DOTFILES_ROOT/zimrc" "$${ZDOTDIR:-$$HOME}/.zimrc"
plugins: deps config
	@ZIM_CONFIG_FILE="$${ZDOTDIR:-$$HOME}/.zimrc" zsh -f -c 'source "$$ZIM_HOME/zimfw.zsh" install'
check:
	@$(HELPER); require_commands zsh; \
	check_link "$$DOTFILES_ROOT/zimrc" "$${ZDOTDIR:-$$HOME}/.zimrc"; \
	test -s "$$ZIM_HOME/zimfw.zsh" && test -s "$$ZIM_HOME/init.zsh"
