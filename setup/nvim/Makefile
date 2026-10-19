include ../common.mk

.PHONY: plugins linters
setup: plugins
deps:
	$(MAKE) -C ../nvm setup
	@$(HELPER); brew_install --formula $(NVIM_PACKAGES); require_commands cc make; \
	data=$$(nvim --headless -u NONE -i NONE -n '+lua io.stdout:write(vim.fn.stdpath("data"))' +qa); \
	download_once "$(VIM_PLUG_URL)" "$$data/site/autoload/plug.vim"
config:
	@$(HELPER); link_config "$$DOTFILES_ROOT/nvim" "$${XDG_CONFIG_HOME:-$$HOME/.config}/nvim"
plugins: deps config
	@$(HELPER); use_node; nvim --headless -u NONE -i NONE -n -S "$$DOTFILES_ROOT/setup/nvim/bootstrap.vim"
linters: deps
	uv tool install 'darker[black]' --with 'black==24.10.0'
	uv tool install cmakelint
	uv tool install cpplint
check:
	@$(HELPER); use_node; require_commands nvim rg ctags cc make python3 shellcheck cppcheck; \
	check_link "$$DOTFILES_ROOT/nvim" "$${XDG_CONFIG_HOME:-$$HOME/.config}/nvim"; nvim --version | head -n 1
