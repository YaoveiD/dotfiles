include ../common.mk

deps:
	@$(HELPER); brew_install --formula git lazygit
config:
	@$(HELPER); link_config "$$DOTFILES_ROOT/gitconfig" "$$HOME/.gitconfig"
check:
	@$(HELPER); require_commands git lazygit; check_link "$$DOTFILES_ROOT/gitconfig" "$$HOME/.gitconfig"
