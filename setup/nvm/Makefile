include ../common.mk

deps:
	@$(HELPER); require_commands curl git; \
	if [[ ! -s "$$NVM_DIR/nvm.sh" ]]; then clone_once https://github.com/nvm-sh/nvm.git "$$NVM_DIR" "$(NVM_VERSION)"; fi; \
	set +u; source "$$NVM_DIR/nvm.sh" --no-use; \
	if [[ $$(nvm version "$(NODE_VERSION)") == N/A ]]; then nvm install "$(NODE_VERSION)"; fi; \
	nvm alias default "$(NODE_VERSION)"
config:
	@printf '%s\n' 'NVM initialization is provided by the shared Zsh configuration.'
check:
	@$(HELPER); use_node; node --version; npm --version
