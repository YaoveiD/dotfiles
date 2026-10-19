include ../common.mk

deps:
	@$(HELPER); require_commands zsh vim
config:
	@$(HELPER); home="$${ZDOTDIR:-$$HOME}"; \
	link_config "$$DOTFILES_ROOT/vimrc" "$$HOME/.vimrc"; \
	link_config "$$DOTFILES_ROOT/zprofile" "$$home/.zprofile"; \
	entry=zshrc.example; [[ ! -f "$$DOTFILES_ROOT/zshrc" ]] || entry=zshrc; \
	link_config "$$DOTFILES_ROOT/$$entry" "$$home/.zshrc"
check:
	@$(HELPER); require_commands zsh vim; home="$${ZDOTDIR:-$$HOME}"; \
	check_link "$$DOTFILES_ROOT/vimrc" "$$HOME/.vimrc"; \
	check_link "$$DOTFILES_ROOT/zprofile" "$$home/.zprofile"; \
	entry=zshrc.example; [[ ! -f "$$DOTFILES_ROOT/zshrc" ]] || entry=zshrc; \
	check_link "$$DOTFILES_ROOT/$$entry" "$$home/.zshrc"
