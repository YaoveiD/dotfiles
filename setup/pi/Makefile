include ../common.mk

.PHONY: adopt
# Pi is opt-in; no credentials/settings are installed or copied.
deps:
	@$(HELPER); require_commands pi node npm python3; brew_install --formula fd; \
	npm ci --prefix "$$DOTFILES_ROOT/pi/extensions/pi-fzf" --ignore-scripts --omit=dev --legacy-peer-deps
config:
	python3 extensions.py config
check:
	python3 extensions.py check
adopt:
	python3 extensions.py adopt
