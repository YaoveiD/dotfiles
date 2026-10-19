include ../common.mk

deps:
	@$(HELPER); brew_install --cask nikitabobko/tap/aerospace; brew_install --formula python
config:
	@$(HELPER); legacy="$$HOME/.aerospace.toml"; \
	if [[ -e "$$legacy" || -L "$$legacy" ]]; then check_link "$$DOTFILES_ROOT/aerospace/aerospace.toml" "$$legacy"; fi; \
	link_config "$$DOTFILES_ROOT/aerospace" "$$HOME/.config/aerospace"
check:
	@$(HELPER); require_commands aerospace python3; check_link "$$DOTFILES_ROOT/aerospace" "$$HOME/.config/aerospace"
