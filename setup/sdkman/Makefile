include ../common.mk

.PHONY: candidates
setup: candidates
deps:
	@$(HELPER); require_commands bash curl zip unzip; \
	if [[ ! -s "$$SDKMAN_DIR/bin/sdkman-init.sh" ]]; then \
	  installer=$$(mktemp); trap 'rm -f "$$installer"' EXIT; \
	  curl -fsSL --proto '=https' --proto-redir '=https' 'https://get.sdkman.io?ci=true&rcupdate=false' -o "$$installer"; \
	  bash "$$installer"; \
	fi
config:
	@printf '%s\n' 'SDKMAN initialization is provided by the shared Zsh configuration.'
candidates: deps
	@$(HELPER); set +u; source "$$SDKMAN_DIR/bin/sdkman-init.sh"; \
	export sdkman_auto_answer=true; \
	if [[ -n "$(JAVA_VERSION)" && ! -d "$$SDKMAN_DIR/candidates/java/$(JAVA_VERSION)" ]]; then sdk install java "$(JAVA_VERSION)"; fi; \
	if [[ -n "$(MAVEN_VERSION)" && ! -d "$$SDKMAN_DIR/candidates/maven/$(MAVEN_VERSION)" ]]; then sdk install maven "$(MAVEN_VERSION)"; fi
check:
	@$(HELPER); test -s "$$SDKMAN_DIR/bin/sdkman-init.sh"; \
	if [[ -n "$(JAVA_VERSION)" ]]; then test -x "$$SDKMAN_DIR/candidates/java/$(JAVA_VERSION)/bin/java"; fi; \
	if [[ -n "$(MAVEN_VERSION)" ]]; then test -x "$$SDKMAN_DIR/candidates/maven/$(MAVEN_VERSION)/bin/mvn"; fi
