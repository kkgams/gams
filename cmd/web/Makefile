SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build
ROOT := ../..
OUTPUT := $(ROOT)/build.nosync/web-build
PORT ?= 8093

.PHONY: build serve test clean
build:
	python3 build.py

test:
	node --test *.test.mjs
	PYTHONPYCACHEPREFIX="$(abspath $(OUTPUT))/pycache" python3 -m unittest serve_test

serve:
	$(MAKE) -C $(ROOT) serve-web WEB_PORT=$(PORT)

clean:
	cd $(ROOT) && python3 scripts/package-host.py clean build.nosync/web-build build.nosync/web build.nosync/web-tools
