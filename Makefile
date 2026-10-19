.DEFAULT_GOAL := help
.NOTPARALLEL:
include setup/config.mk
-include setup.local.mk

.PHONY: help setup deps config check $(addprefix setup-,$(PROJECTS)) $(addprefix deps-,$(PROJECTS)) $(addprefix config-,$(PROJECTS)) $(addprefix check-,$(PROJECTS))
help:
	@printf '%s\n' 'make setup                 Install dependencies and configure selected tools' 'make config                Link configuration only (offline)' 'make check                 Check selected tools (read-only)' 'make setup-nvim            Set up one tool and its dependencies' 'make -C setup/nvim plugins Install editor plugins explicitly' 'make -n setup              Preview without installing' 'PROJECTS=$(PROJECTS)' 'Override defaults in setup.local.mk (ignored by Git).'

setup: $(addprefix setup-,$(PROJECTS))
deps: $(addprefix deps-,$(PROJECTS))
config: $(addprefix config-,$(PROJECTS))
check: $(addprefix check-,$(PROJECTS))

# Static rules keep selected targets phony; pattern rules support optional tools.
$(addprefix setup-,$(PROJECTS)): setup-%:
	$(MAKE) -C "setup/$*" setup
$(addprefix deps-,$(PROJECTS)): deps-%:
	$(MAKE) -C "setup/$*" deps
$(addprefix config-,$(PROJECTS)): config-%:
	$(MAKE) -C "setup/$*" config
$(addprefix check-,$(PROJECTS)): check-%:
	$(MAKE) -C "setup/$*" check
setup-%:
	$(MAKE) -C "setup/$*" setup
deps-%:
	$(MAKE) -C "setup/$*" deps
config-%:
	$(MAKE) -C "setup/$*" config
check-%:
	$(MAKE) -C "setup/$*" check
