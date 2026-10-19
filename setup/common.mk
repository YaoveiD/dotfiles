.DEFAULT_GOAL := help
.NOTPARALLEL:
SHELL := /bin/bash
include ../config.mk
-include ../../setup.local.mk

export DOTFILES_ROOT := $(shell cd ../.. && pwd -P)
export NVM_DIR ?= $(HOME)/.nvm
export SDKMAN_DIR ?= $(HOME)/.sdkman
export ZIM_HOME ?= $(if $(ZDOTDIR),$(ZDOTDIR),$(HOME))/.zim
export NODE_VERSION
HELPER = source "$(DOTFILES_ROOT)/setup/helpers.sh"

.PHONY: help setup deps config check
help:
	@printf '%s\n' 'Targets: setup (deps + config), deps, config (offline), check (read-only).' 'Some tools also provide plugins, candidates or linters; see docs/setup.md.'
setup: deps config
