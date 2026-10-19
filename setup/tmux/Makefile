include ../common.mk

.PHONY: plugins
setup: plugins
deps:
	@$(HELPER); brew_install --formula $(TMUX_PACKAGES); \
	clone_once https://github.com/tmux-plugins/tpm.git "$$HOME/.tmux/plugins/tpm"
config:
	@$(HELPER); xdg="$${XDG_CONFIG_HOME:-$$HOME/.config}/tmux/tmux.conf"; \
	if [[ -e "$$xdg" || -L "$$xdg" ]]; then check_link "$$DOTFILES_ROOT/tmux.conf" "$$xdg"; fi; \
	link_config "$$DOTFILES_ROOT/tmux.conf" "$$HOME/.tmux.conf"
plugins: deps config
	@bash "$(DOTFILES_ROOT)/setup/tmux/plugins.sh"
check:
	@$(HELPER); require_commands tmux fzf python3; \
	check_link "$$DOTFILES_ROOT/tmux.conf" "$$HOME/.tmux.conf"; test -x "$$HOME/.tmux/plugins/tpm/bin/install_plugins"
